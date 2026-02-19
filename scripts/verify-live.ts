/**
 * Live verification script for @metyatech/ai-quota high-level API.
 *
 * Run with: npx ts-node --esm scripts/verify-live.ts
 * Or after build: node dist/scripts/verify-live.js
 */

import { fetchAllRateLimits } from "../src/index.js";

async function main(): Promise<void> {
  console.log("=".repeat(62));
  console.log("  @metyatech/ai-quota — SDK Live Verification");
  console.log("  Date:", new Date().toISOString());
  console.log("=".repeat(62));

  try {
    console.log("\nFetching all rate limits via SDK...");
    const all = await fetchAllRateLimits({ verbose: true });

    const agents = ["claude", "gemini", "copilot", "amazonQ", "codex"] as const;

    for (const agent of agents) {
      const res = all[agent];
      console.log(`\n[${agent.toUpperCase()}]`);
      console.log(`  Status:  ${res.status}`);
      console.log(`  Display: ${res.display}`);
      if (res.error) {
        console.log(`  Error:   ${res.error}`);
      }
      if (res.data) {
        console.log(`  Data:    ${JSON.stringify(res.data).substring(0, 100)}...`);
      }
    }

  } catch (err) {
    console.error("\nFatal SDK Error:", err);
  }

  console.log("\n" + "=".repeat(62));
  console.log("  Done. Review each result above manually.");
  console.log("=".repeat(62));
}

main().catch((err: unknown) => {
  console.error("Fatal:", err);
  process.exit(1);
});
