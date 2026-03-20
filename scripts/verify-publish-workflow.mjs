import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const workflowPath = resolve(".github/workflows/publish.yml");
const workflow = readFileSync(workflowPath, "utf8");

const requiredSnippets = [
  "release:",
  "types: [published]",
  "id-token: write",
  'node-version: "24"',
  "npm run verify",
  "npm publish --access public --provenance"
];

const missing = requiredSnippets.filter((snippet) => !workflow.includes(snippet));

if (missing.length > 0) {
  console.error("publish workflow validation failed.");
  for (const snippet of missing) {
    console.error(`missing snippet: ${snippet}`);
  }
  process.exit(1);
}

console.log("publish workflow validation passed.");
