#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env
import { SequentialFetchVM } from "./sequential-fetch-vm-lib.ts";

console.log("🔍 Debugging Variable Detection");

const vm = new SequentialFetchVM();
await vm.initialize();

try {
  // Execute: const post = fetch("https://example.com")
  console.log("\n📋 Executing: const post = fetch(\"https://example.com\")");
  const result = vm.vm.evalCode('const post = fetch("https://example.com")');

  if (result.error) {
    console.log("Error:", vm.vm.dump(result.error));
    result.error.dispose();
  } else {
    const value = vm.vm.dump(result.value);
    console.log("Statement result:", value);
    result.value.dispose();
  }

  // Check what variables exist
  console.log("\n📋 Checking all variables:");
  const checkResult = vm.vm.evalCode(`
    (() => {
      const vars = {};
      for (const key of Object.getOwnPropertyNames(globalThis)) {
        if (!key.startsWith('_') && !['fetch', 'console', 'Object', 'Array', 'Function', 'String', 'Number', 'Boolean', 'Symbol', 'Math', 'Date', 'JSON', 'Promise', 'globalThis', 'undefined', 'NaN', 'Infinity'].includes(key)) {
          vars[key] = globalThis[key];
        }
      }
      return vars;
    })()
  `);

  if (checkResult.error) {
    console.log("Error:", vm.vm.dump(checkResult.error));
    checkResult.error.dispose();
  } else {
    const vars = vm.vm.dump(checkResult.value);
    console.log("Variables:", vars);
    checkResult.value.dispose();
  }

  // Check specifically for post variable
  console.log("\n📋 Checking post variable:");
  const postResult = vm.vm.evalCode('post');
  if (postResult.error) {
    console.log("Error:", vm.vm.dump(postResult.error));
    postResult.error.dispose();
  } else {
    const postValue = vm.vm.dump(postResult.value);
    console.log("post value:", postValue);
    console.log("is string:", typeof postValue === 'string');
    console.log("starts with pause:", typeof postValue === 'string' && postValue.startsWith('__FETCH_PAUSE__'));
    postResult.value.dispose();
  }

} finally {
  vm.dispose();
}