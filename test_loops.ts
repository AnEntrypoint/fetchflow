#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env
import { executeCode, resumeExecution } from "./sequential-fetch-vm-lib.ts";

console.log("🧪 Testing Loop Fetch Operations");
console.log("=" .repeat(50));

// Test: For loop with fetch operations
console.log("\n📋 Testing for loop with fetches");
try {
  const code = `
    let results = [];
    for(let i = 1; i <= 3; i++) {
      console.log("Fetching post", i);
      const post = fetch("https://jsonplaceholder.typicode.com/posts/" + i);
      console.log("Got title:", post.title);
      results.push(post.title);
    }
    results;
  `;

  let currentResult = await executeCode(code);
  let pauseCount = 0;

  console.log(`Initial result type: ${currentResult.type}`);

  while (currentResult.type === 'paused') {
    pauseCount++;
    console.log(`\n✅ Pause ${pauseCount}:`);
    console.log(`   URL: ${currentResult.fetchRequest.url}`);

    // Process fetch externally
    console.log("🌐 Processing fetch externally...");
    const response = await fetch(currentResult.fetchRequest.url);
    const data = await response.json();
    console.log(`   Response title: ${data.title}`);

    // Resume execution
    console.log("🔄 Resuming execution...");
    currentResult = await resumeExecution(currentResult.state, {
      id: currentResult.fetchRequest.id,
      success: response.ok,
      status: response.status,
      statusText: response.statusText,
      data: data,
      timestamp: Date.now()
    });

    console.log(`   Resume result type: ${currentResult.type}`);
  }

  console.log(`\n🎉 Completed after ${pauseCount} pauses!`);
  console.log("Final result:", currentResult.result);

} catch (error) {
  console.log("❌ Error:", error.message);
}

console.log("\n✅ Loop fetch testing completed!");