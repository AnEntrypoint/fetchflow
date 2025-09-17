# FetchFlow

[![npm version](https://badge.fury.io/js/fetchflow.svg)](https://badge.fury.io/js/fetchflow)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A JavaScript execution environment that automatically pauses on `fetch()` calls, allows external HTTP processing, and resumes with injected responses.

## Features

- ✅ **Automatic Fetch Interception** - Any `fetch()` call automatically pauses execution
- ✅ **State Persistence** - Complete VM state serialization and restoration
- ✅ **External Processing** - HTTP requests handled by separate processes
- ✅ **Seamless Resumption** - Continue execution with injected fetch responses
- ✅ **Recursive Resumability** - Resumed VMs can pause again on new fetch calls

## Installation

```bash
npm install fetchflow
```

For Deno users:
```typescript
import { executeCode, resumeExecution } from "npm:fetchflow";
```

## API Reference

### Types

```typescript
interface ExecutionResult {
  type: 'completed' | 'paused';
  result?: any;              // Final result if completed
  state?: VMState;           // VM state if paused
  fetchRequest?: FetchRequest; // Fetch details if paused
}

interface VMState {
  id: string;
  code: string;
  variables: Record<string, any>;
  timestamp: number;
}

interface FetchRequest {
  id: string;
  url: string;
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };
  timestamp: number;
}

interface FetchResponse {
  id: string;
  success: boolean;
  status: number;
  statusText: string;
  data?: any;
  error?: string;
  timestamp: number;
}
```

### Functions

#### `executeCode(code: string): Promise<ExecutionResult>`

Execute JavaScript code. If a `fetch()` call is encountered:
- Execution pauses immediately
- Returns `{ type: 'paused', state, fetchRequest }`

If no fetch calls or execution completes:
- Returns `{ type: 'completed', result }`

#### `resumeExecution(state: VMState, fetchResponse: FetchResponse): Promise<ExecutionResult>`

Resume execution with a fetch response:
- Restores VM state
- Injects fetch response as if the original fetch completed
- Continues execution from where it paused
- Can pause again if more fetch calls are encountered

### Class Usage

```typescript
import { FetchVM } from 'fetchflow';

const vm = new FetchVM();
await vm.initialize();

const result1 = await vm.execute(code);
if (result1.type === 'paused') {
  // Process fetch request externally
  const response = await processHttpRequest(result1.fetchRequest);

  const result2 = await vm.resume(result1.state!, response);
  // Continue as needed...
}

vm.dispose();
```

## Example Usage

### Basic Fetch Pause/Resume

```typescript
import { executeCode, resumeExecution } from 'fetchflow';

// Execute code that makes a fetch call
const result = await executeCode(`
  let data = null;

  console.log("About to fetch...");
  const response = await fetch("https://api.example.com/data");
  data = await response.json();

  console.log("Fetch completed:", data);
  data;
`);

if (result.type === 'paused') {
  console.log("VM paused for fetch:", result.fetchRequest?.url);

  // Process the HTTP request externally
  const httpResponse = await fetch(result.fetchRequest!.url);
  const responseData = await httpResponse.json();

  const fetchResponse = {
    id: result.fetchRequest!.id,
    success: httpResponse.ok,
    status: httpResponse.status,
    statusText: httpResponse.statusText,
    data: responseData,
    timestamp: Date.now()
  };

  // Resume execution with the response
  const finalResult = await resumeExecution(result.state!, fetchResponse);
  console.log("Final result:", finalResult.result);
}
```

### Multiple Fetch Calls

```typescript
const result1 = await executeCode(`
  let posts = [];

  for (let i = 1; i <= 3; i++) {
    console.log("Fetching post", i);
    const response = await fetch(\`https://jsonplaceholder.typicode.com/posts/\${i}\`);
    const post = await response.json();
    posts.push(post);
  }

  posts;
`);

// This will pause at the first fetch
// Process it, resume, it will pause at second fetch
// Continue until all fetches are completed
```

### With State Management

```typescript
const vm = new FetchVM();
await vm.initialize();

let currentState = null;
let fetchQueue = [];

async function processStep(code: string) {
  const result = await vm.execute(code);

  if (result.type === 'paused') {
    currentState = result.state;
    fetchQueue.push(result.fetchRequest);
    return 'paused';
  }

  return result.result;
}

// Execute multiple steps
await processStep('let counter = 0;');
await processStep('counter++;');
const result = await processStep('fetch("https://api.example.com/data")');

if (result === 'paused') {
  // Process queued fetches...
}
```

## Use Cases

- **Serverless Functions** - Pause expensive operations across invocations
- **Web Scraping** - Handle rate limiting by pausing between requests
- **Distributed Computing** - Split long-running tasks across multiple workers
- **Debugging** - Inspect state at any fetch call
- **Testing** - Mock HTTP responses without changing application code
- **Workflow Orchestration** - Coordinate complex multi-step processes

## How It Works

1. **Fetch Interception**: The library replaces the global `fetch` function with a custom implementation that throws a special error when called
2. **State Serialization**: When a fetch is encountered, the entire VM state (variables, functions, execution context) is serialized
3. **External Processing**: The HTTP request details are returned to the caller for external processing
4. **Response Injection**: When resumed, the fetch response is injected as if the original fetch call completed normally
5. **Recursive Capability**: Resumed VMs maintain fetch interception, enabling infinite pause/resume cycles

## Requirements

- Deno with `--allow-read`, `--allow-write`, `--allow-net` permissions
- QuickJS Emscripten package

## License

MIT