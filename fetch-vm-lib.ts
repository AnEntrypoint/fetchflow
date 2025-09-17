import { getQuickJS } from "quickjs-emscripten";

export interface FetchRequest {
  id: string;
  url: string;
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };
  timestamp: number;
}

export interface VMState {
  id: string;
  code: string;
  variables: Record<string, any>;
  timestamp: number;
}

export interface ExecutionResult {
  type: 'completed' | 'paused';
  result?: any;
  state?: VMState;
  fetchRequest?: FetchRequest;
}

export interface FetchResponse {
  id: string;
  success: boolean;
  status: number;
  statusText: string;
  data?: any;
  error?: string;
  timestamp: number;
}

export class FetchVM {
  private QuickJS: any;
  private vm: any;
  private allCode = "";
  private fetchCounter = 0;

  async initialize() {
    this.QuickJS = await getQuickJS();
    this.vm = this.QuickJS.newContext();
    this.setupConsole();
    this.setupFetch();
  }

  private setupConsole() {
    const consoleObj = this.vm.newObject();
    this.vm.setProp(consoleObj, "log", this.vm.newFunction("log", (...args: any[]) => {
      const messages = args.map(arg => this.vm.dump(arg));
      console.log(...messages);
      return this.vm.undefined;
    }));
    this.vm.setProp(this.vm.global, "console", consoleObj);
    consoleObj.dispose();
  }

  private setupFetch() {
    this.vm.setProp(this.vm.global, "fetch", this.vm.newFunction("fetch", (url: any, options: any) => {
      const urlStr = this.vm.dump(url);
      const optsObj = options ? this.vm.dump(options) : {};

      const requestId = `fetch_${Date.now()}_${++this.fetchCounter}`;

      // Store fetch details globally so we can access them
      const storeCode = `
        globalThis.__fetchPause = {
          id: "${requestId}",
          url: "${urlStr}",
          options: ${JSON.stringify(optsObj)}
        };
      `;

      const storeResult = this.vm.evalCode(storeCode);
      if (storeResult.error) {
        storeResult.error.dispose();
      } else {
        storeResult.value.dispose();
      }

      // Return a special marker
      return this.vm.newString(`__FETCH_PAUSE__${requestId}`);
    }));
  }

  private getCurrentState(): VMState {
    const globalsResult = this.vm.evalCode(`
      (() => {
        const globals = {};
        for (const key of Object.getOwnPropertyNames(globalThis)) {
          if (!key.startsWith('_') &&
              !['fetch', 'console', 'Object', 'Array', 'Function', 'String', 'Number',
                'Boolean', 'Symbol', 'Math', 'Date', 'JSON', 'Promise', 'globalThis',
                'undefined', 'NaN', 'Infinity'].includes(key)) {
            try {
              const val = globalThis[key];
              JSON.stringify(val); // Test if serializable
              globals[key] = val;
            } catch (e) {
              // Skip non-serializable
            }
          }
        }
        return globals;
      })()
    `);

    let variables = {};
    if (!globalsResult.error) {
      variables = this.vm.dump(globalsResult.value);
      globalsResult.value.dispose();
    } else {
      globalsResult.error.dispose();
    }

    return {
      id: `state_${Date.now()}`,
      code: this.allCode,
      variables,
      timestamp: Date.now()
    };
  }

  private restoreState(state: VMState) {
    this.allCode = state.code;

    // Restore code
    if (state.code) {
      const result = this.vm.evalCode(state.code);
      if (result.error) {
        console.warn("Code restore failed:", this.vm.dump(result.error));
        result.error.dispose();
      } else {
        result.value.dispose();
      }
    }

    // Restore variables
    if (Object.keys(state.variables).length > 0) {
      const restoreCode = `Object.assign(globalThis, ${JSON.stringify(state.variables)})`;
      const result = this.vm.evalCode(restoreCode);
      if (result.error) {
        console.warn("Variables restore failed:", this.vm.dump(result.error));
        result.error.dispose();
      } else {
        result.value.dispose();
      }
    }
  }

  async execute(code: string): Promise<ExecutionResult> {
    this.allCode += "\n" + code;

    try {
      const result = this.vm.evalCode(code);

      if (result.error) {
        const errorMsg = this.vm.dump(result.error);
        result.error.dispose();
        throw new Error(String(errorMsg));
      }

      const value = this.vm.dump(result.value);
      result.value.dispose();

      // Check if result indicates a fetch pause
      if (typeof value === 'string' && value.startsWith('__FETCH_PAUSE__')) {
        const fetchId = value.replace('__FETCH_PAUSE__', '');

        // Get fetch details from global
        const fetchDetailsResult = this.vm.evalCode('globalThis.__fetchPause');
        if (fetchDetailsResult.error) {
          fetchDetailsResult.error.dispose();
          throw new Error('Failed to get fetch details');
        }

        const fetchDetails = this.vm.dump(fetchDetailsResult.value);
        fetchDetailsResult.value.dispose();

        const fetchRequest: FetchRequest = {
          id: fetchDetails.id,
          url: fetchDetails.url,
          options: fetchDetails.options,
          timestamp: Date.now()
        };

        const state = this.getCurrentState();

        return {
          type: 'paused',
          state,
          fetchRequest
        };
      }

      return {
        type: 'completed',
        result: value
      };

    } catch (error) {
      throw error;
    }
  }

  async resume(state: VMState, fetchResponse: FetchResponse): Promise<ExecutionResult> {
    // Restore state first
    this.restoreState(state);

    // Inject fetch response
    const responseObj = {
      ok: fetchResponse.success,
      status: fetchResponse.status,
      statusText: fetchResponse.statusText,
      headers: new Map([['content-type', 'application/json']]),

      json: () => Promise.resolve(fetchResponse.data),
      text: () => Promise.resolve(
        typeof fetchResponse.data === 'string'
          ? fetchResponse.data
          : JSON.stringify(fetchResponse.data)
      ),
      blob: () => Promise.resolve(new Blob([JSON.stringify(fetchResponse.data)])),
      arrayBuffer: () => Promise.resolve(new TextEncoder().encode(JSON.stringify(fetchResponse.data)))
    };

    // Replace the fetch call with the response
    const injectCode = `
      globalThis.__fetchResponse = ${JSON.stringify({
        ok: fetchResponse.success,
        status: fetchResponse.status,
        statusText: fetchResponse.statusText,
        data: fetchResponse.data
      })};

      globalThis.__fetchResponse.json = function() {
        return Promise.resolve(this.data);
      };

      globalThis.__fetchResponse.text = function() {
        return Promise.resolve(typeof this.data === 'string' ? this.data : JSON.stringify(this.data));
      };

      // Signal that fetch completed
      "fetch_response_injected"
    `;

    const injectResult = this.vm.evalCode(injectCode);
    if (injectResult.error) {
      const error = this.vm.dump(injectResult.error);
      injectResult.error.dispose();
      throw new Error(`Failed to inject response: ${error}`);
    }
    injectResult.value.dispose();

    // Continue execution - the next code should use the injected response
    return { type: 'completed', result: fetchResponse.data };
  }

  dispose() {
    if (this.vm) {
      this.vm.dispose();
      this.vm = null;
    }
  }
}

// Convenience functions for library users
export async function executeCode(code: string): Promise<ExecutionResult> {
  const vm = new FetchVM();
  await vm.initialize();

  try {
    return await vm.execute(code);
  } finally {
    vm.dispose();
  }
}

export async function resumeExecution(state: VMState, fetchResponse: FetchResponse): Promise<ExecutionResult> {
  const vm = new FetchVM();
  await vm.initialize();

  try {
    return await vm.resume(state, fetchResponse);
  } finally {
    vm.dispose();
  }
}