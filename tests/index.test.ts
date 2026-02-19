import { describe, expect, it, vi } from "vitest";
import { fetchAllRateLimits } from "../src/index.js";

describe("fetchAllRateLimits", () => {
  it("returns a structured object with all agents", async () => {
    // Basic test to ensure the orchestration function runs and returns expected keys
    const result = await fetchAllRateLimits({ timeoutSeconds: 1 });
    
    expect(result).toHaveProperty("claude");
    expect(result).toHaveProperty("gemini");
    expect(result).toHaveProperty("copilot");
    expect(result).toHaveProperty("amazonQ");
    expect(result).toHaveProperty("codex");
    
    // Check structure of one agent
    expect(result.claude).toHaveProperty("status");
    expect(result.claude).toHaveProperty("display");
  });
});
