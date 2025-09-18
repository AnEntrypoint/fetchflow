import { getQuickJS } from "npm:quickjs-emscripten@0.23.0";
import * as acorn from "npm:acorn@8.11.3";

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
  currentStatementIndex: number;
  statements: string[];
}

export interface ExecutionResult {
  type: 'paused' | 'completed';
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

export class SequentialFetchVM {
  private QuickJS: any;
  private vm: any;
  private allCode = "";
  private fetchCounter = 0;
  private statements: string[] = [];
  private currentStatementIndex = 0;

  async initialize() {
    this.QuickJS = await getQuickJS();
    this.vm = this.QuickJS.newContext();
    this.setupConsole();
    this.setupFetch();
  }

  private setupConsole() {
    const consoleObj = this.vm.newObject();
    const logFunc = this.vm.newFunction("log", (...args: any[]) => {
      const messages = args.map(arg => this.vm.dump(arg));
      console.log(...messages);
      return this.vm.undefined;
    });

    this.vm.setProp(consoleObj, "log", logFunc);
    this.vm.setProp(this.vm.global, "console", consoleObj);

    logFunc.dispose();
    consoleObj.dispose();
  }

  private setupFetch() {
    const fetchFunc = this.vm.newFunction("fetch", (url: any, options: any) => {
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
      const markerString = this.vm.newString(`__FETCH_PAUSE__${requestId}`);
      return markerString;
    });

    this.vm.setProp(this.vm.global, "fetch", fetchFunc);
    fetchFunc.dispose();
  }

  private extractVariableNames(statement: string): string[] {
    try {
      const ast = acorn.parse(statement, {
        ecmaVersion: 2022,
        sourceType: "script"
      }) as any;

      const variableNames: string[] = [];

      // Extract variable names from the AST
      for (const node of ast.body) {
        if (node.type === 'VariableDeclaration') {
          for (const declarator of node.declarations) {
            if (declarator.id.type === 'Identifier') {
              variableNames.push(declarator.id.name);
            }
          }
        }
      }

      return variableNames;
    } catch (error) {
      console.warn("Failed to extract variable names:", error);
      return [];
    }
  }

  private parseCodeIntoStatements(code: string): string[] {
    try {
      const ast = acorn.parse(code, {
        ecmaVersion: 2022,
        sourceType: "script"
      }) as any;

      const statements: string[] = [];

      // Extract individual statements from AST
      for (const node of ast.body) {
        const statementCode = code.slice(node.start, node.end);
        statements.push(statementCode);
      }

      return statements;
    } catch (error) {
      // If parsing fails, treat as single statement
      console.warn("Failed to parse code, treating as single statement:", error);
      return [code];
    }
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
      timestamp: Date.now(),
      currentStatementIndex: this.currentStatementIndex,
      statements: this.statements
    };
  }

  private restoreState(state: VMState) {
    this.allCode = state.code;
    this.statements = state.statements || [];
    this.currentStatementIndex = state.currentStatementIndex || 0;

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
    this.statements = this.parseCodeIntoStatements(code);
    this.currentStatementIndex = 0;

    return this.executeNextStatement();
  }

  private async executeNextStatement(): Promise<ExecutionResult> {
    // Check if we have more statements to execute
    if (this.currentStatementIndex >= this.statements.length) {
      return {
        type: 'completed',
        result: undefined
      };
    }

    let statement = this.statements[this.currentStatementIndex];
    console.log(`Executing statement ${this.currentStatementIndex + 1}: ${statement}`);

    // Transform variable declarations to be global for persistence across statements
    const variableNames = this.extractVariableNames(statement);
    for (const varName of variableNames) {
      const varRegex = new RegExp(`\\b(const|let|var)\\s+${varName}\\s*=`, 'g');
      statement = statement.replace(varRegex, `globalThis.${varName} =`);
    }

    if (statement !== this.statements[this.currentStatementIndex]) {
      console.log(`Transformed to: ${statement}`);
    }

    try {
      const result = this.vm.evalCode(statement);

      if (result.error) {
        const errorMsg = this.vm.dump(result.error);
        result.error.dispose();
        throw new Error(JSON.stringify(errorMsg, null, 2));
      }

      const value = this.vm.dump(result.value);
      result.value.dispose();

      console.log(`Statement result:`, value);

      // For variable declarations, the statement result is undefined but we need to check
      // if any variables were assigned pause markers
      let foundPauseMarker = null;

      // Check if result indicates a fetch pause
      if (typeof value === 'string' && value.startsWith('__FETCH_PAUSE__')) {
        foundPauseMarker = value;
      } else {
        // Parse the statement to extract variable names declared in this statement
        const variableNames = this.extractVariableNames(statement);

        for (const varName of variableNames) {
          const checkResult = this.vm.evalCode(varName);
          if (!checkResult.error) {
            const varValue = this.vm.dump(checkResult.value);
            checkResult.value.dispose();
            if (typeof varValue === 'string' && varValue.startsWith('__FETCH_PAUSE__')) {
              foundPauseMarker = varValue;
              break;
            }
          } else {
            checkResult.error.dispose();
          }
        }
      }

      if (foundPauseMarker) {
        console.log(`Found pause marker: ${foundPauseMarker}`);
        const fetchId = foundPauseMarker.replace('__FETCH_PAUSE__', '');

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

      // Move to next statement
      this.currentStatementIndex++;

      // If this was the last statement, return the result
      if (this.currentStatementIndex >= this.statements.length) {
        return {
          type: 'completed',
          result: value
        };
      }

      // Continue with next statement
      return this.executeNextStatement();

    } catch (error) {
      throw error;
    }
  }

  async resume(state: VMState, fetchResponse: FetchResponse): Promise<ExecutionResult> {
    // Restore state first
    this.restoreState(state);

    // Inject the fetch response data directly into a variable that matches the current statement
    const injectCode = `
      globalThis.__currentFetchData = ${JSON.stringify(fetchResponse.data)};
    `;

    const injectResult = this.vm.evalCode(injectCode);
    if (injectResult.error) {
      const error = this.vm.dump(injectResult.error);
      injectResult.error.dispose();
      throw new Error(`Failed to inject response: ${error}`);
    }
    injectResult.value.dispose();

    // Get the current statement and transform it to use the injected data
    const currentStatement = this.statements[this.currentStatementIndex];

    // Transform the statement to replace fetch() with the actual data
    // Also ensure variables are assigned to globalThis for persistence across statements
    let transformedStatement = currentStatement.replace(
      /fetch\([^)]+\)/g,
      'globalThis.__currentFetchData'
    );

    // Extract variable names and make them global
    const variableNames = this.extractVariableNames(currentStatement);
    for (const varName of variableNames) {
      // Transform const/let/var declarations to globalThis assignments
      const varRegex = new RegExp(`\\b(const|let|var)\\s+${varName}\\s*=`, 'g');
      transformedStatement = transformedStatement.replace(varRegex, `globalThis.${varName} =`);
    }

    console.log(`Executing transformed statement: ${transformedStatement}`);

    try {
      const result = this.vm.evalCode(transformedStatement);

      if (result.error) {
        const errorMsg = this.vm.dump(result.error);
        result.error.dispose();
        throw new Error(JSON.stringify(errorMsg, null, 2));
      }

      const value = this.vm.dump(result.value);
      result.value.dispose();

      // Move to next statement
      this.currentStatementIndex++;

      // Clear the fetch data
      const clearResult = this.vm.evalCode('delete globalThis.__currentFetchData; delete globalThis.__fetchPause;');
      if (clearResult.error) {
        clearResult.error.dispose();
      } else {
        clearResult.value.dispose();
      }

      // Continue with next statement if available
      if (this.currentStatementIndex < this.statements.length) {
        return this.executeNextStatement();
      }

      return {
        type: 'completed',
        result: value
      };

    } catch (error) {
      throw error;
    }
  }

  dispose() {
    if (this.vm) {
      try {
        // Force garbage collection multiple times
        for (let i = 0; i < 3; i++) {
          try {
            this.vm.runtime.executePendingJobs();
          } catch (e) {
            // Ignore pending job errors
          }
        }

        // Clear any remaining global references
        try {
          this.vm.evalCode(`
            delete globalThis.__fetchPause;
            delete globalThis.__fetchResult;
          `);
        } catch (e) {
          // Ignore cleanup errors
        }

      } catch (e) {
        // Ignore all cleanup errors
      }

      // Dispose VM last
      try {
        this.vm.dispose();
      } catch (e) {
        // Even ignore disposal errors
      }
      this.vm = null;
    }
  }
}

// Convenience functions for library users
export async function executeCode(code: string): Promise<ExecutionResult> {
  const vm = new SequentialFetchVM();
  await vm.initialize();

  try {
    return await vm.execute(code);
  } finally {
    vm.dispose();
  }
}

export async function resumeExecution(state: VMState, fetchResponse: FetchResponse): Promise<ExecutionResult> {
  const vm = new SequentialFetchVM();
  await vm.initialize();

  try {
    return await vm.resume(state, fetchResponse);
  } finally {
    vm.dispose();
  }
}