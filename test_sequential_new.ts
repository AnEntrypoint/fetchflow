#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env
import { executeCode, resumeExecution } from "./sequential-fetch-vm-lib.ts";

console.log("🧪 Testing Sequential FetchVM with AST");
console.log("=" .repeat(50));

// Test 1: Single fetch
console.log("\n📋 Test 1: Single fetch");
try {
  const result = await executeCode('const post = fetch("https://jsonplaceholder.typicode.com/posts/1"); post.title;');
  console.log("Result:", result);

  if (result.type === 'paused') {
    console.log("✅ Paused correctly");

    // Process the fetch
    const response = await fetch(result.fetchRequest.url);
    const data = await response.json();

    const resumeResult = await resumeExecution(result.state, {
      id: result.fetchRequest.id,
      success: true,
      status: 200,
      statusText: "OK",
      data: data,
      timestamp: Date.now()
    });

    console.log("Resume result:", resumeResult);
  }
} catch (error) {
  console.log("❌ Error:", error.message);
}

// Test 2: Sequential fetches
console.log("\n📋 Test 2: Sequential fetches");
try {
  const code = `
    console.log("Starting sequential fetches...");
    const post1 = fetch("https://jsonplaceholder.typicode.com/posts/1");
    console.log("Got post 1:", post1.title);
    const post2 = fetch("https://jsonplaceholder.typicode.com/posts/2");
    console.log("Got post 2:", post2.title);
    [post1.title, post2.title];
  `;

  let currentResult = await executeCode(code);
  let pauseCount = 0;

  while (currentResult.type === 'paused') {
    pauseCount++;
    console.log(`✅ Pause ${pauseCount}:`, currentResult.fetchRequest.url);

    // Process fetch externally
    const response = await fetch(currentResult.fetchRequest.url);
    const data = await response.json();

    // Resume execution
    currentResult = await resumeExecution(currentResult.state, {
      id: currentResult.fetchRequest.id,
      success: response.ok,
      status: response.status,
      statusText: response.statusText,
      data: data,
      timestamp: Date.now()
    });
  }

  console.log(`✅ Completed after ${pauseCount} pauses:`, currentResult.result);
} catch (error) {
  console.log("❌ Error:", error.message);
}

console.log("\n🎉 Sequential AST testing completed!");