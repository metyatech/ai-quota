import { describe, expect, it } from "vitest";
import { formatResetIn } from "../src/utils.js";

describe("formatResetIn", () => {
  it("formats minutes correctly", () => {
    const now = Date.now();
    const resetAt = new Date(now + 5 * 60000); // 5 minutes later
    expect(formatResetIn(resetAt)).toBe("5m");
  });

  it("formats hours and minutes correctly", () => {
    const now = Date.now();
    const resetAt = new Date(now + 2 * 3600000 + 15 * 60000); // 2h 15m later
    expect(formatResetIn(resetAt)).toBe("2h 15m");
  });

  it("returns 'already reset' for past dates", () => {
    const now = Date.now();
    const resetAt = new Date(now - 1000);
    expect(formatResetIn(resetAt)).toBe("already reset");
  });
});
