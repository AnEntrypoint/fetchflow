#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env
import { SequentialFetchVM } from "./sequential-fetch-vm-lib.ts";

console.log("🔍 Debugging Fetch Function");

const vm = new SequentialFetchVM();
await vm.initialize();

try {
  // Test 1: Direct fetch call
  console.log("\n📋 Test 1: Direct fetch call");
  const result1 = vm.vm.evalCode('fetch("https://example.com")');
  if (result1.error) {
    console.log("Error:", vm.vm.dump(result1.error));
    result1.error.dispose();
  } else {
    const value = vm.vm.dump(result1.value);
    console.log("Direct fetch result:", value);
    result1.value.dispose();
  }

  // Test 2: Variable assignment
  console.log("\n📋 Test 2: Variable assignment");
  const result2 = vm.vm.evalCode('const test = fetch("https://example.com"); test;');
  if (result2.error) {
    console.log("Error:", vm.vm.dump(result2.error));
    result2.error.dispose();
  } else {
    const value = vm.vm.dump(result2.value);
    console.log("Variable assignment result:", value);
    result2.value.dispose();
  }

  // Test 3: Check if variable has pause marker
  console.log("\n📋 Test 3: Check variable value");
  const result3 = vm.vm.evalCode('test');
  if (result3.error) {
    console.log("Error:", vm.vm.dump(result3.error));
    result3.error.dispose();
  } else {
    const value = vm.vm.dump(result3.value);
    console.log("Variable value:", value);
    result3.value.dispose();
  }

} finally {
  vm.dispose();
}