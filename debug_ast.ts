#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env
import * as acorn from "npm:acorn@8.11.3";

const code = `const post1 = fetch("https://jsonplaceholder.typicode.com/posts/1");
console.log("Got post 1:", post1.title);
const post2 = fetch("https://jsonplaceholder.typicode.com/posts/2");`;

console.log("🔍 Debugging AST parsing");
console.log("Original code:");
console.log(code);

try {
  const ast = acorn.parse(code, {
    ecmaVersion: 2022,
    sourceType: "script"
  }) as any;

  console.log("\n📋 AST structure:");
  console.log(JSON.stringify(ast, null, 2));

  console.log("\n📋 Parsed statements:");
  for (let i = 0; i < ast.body.length; i++) {
    const node = ast.body[i];
    const statementCode = code.slice(node.start, node.end);
    console.log(`Statement ${i + 1}:`, statementCode);
  }
} catch (error) {
  console.log("❌ AST parsing error:", error);
}