import { describe, expect, it, vi, afterEach } from "vitest";
import { formatResetIn } from "../src/utils.js";

describe("formatResetIn", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats minutes correctly", () => {
    const mockNow = new Date("2026-02-19T10:00:00Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(mockNow);

    const resetAt = new Date(mockNow + 5 * 60000); // 5 minutes later
    expect(formatResetIn(resetAt)).toBe("5m");
  });

  it("formats hours and minutes correctly", () => {
    const mockNow = new Date("2026-02-19T10:00:00Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(mockNow);

    const resetAt = new Date(mockNow + 2 * 3600000 + 15 * 60000); // 2h 15m later
    expect(formatResetIn(resetAt)).toBe("2h 15m");
  });

  it("returns 'already reset' for past dates", () => {
    const mockNow = new Date("2026-02-19T10:00:00Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(mockNow);

    const resetAt = new Date(mockNow - 1000);
    expect(formatResetIn(resetAt)).toBe("already reset");
  });

  it("formats whole days only", () => {
    const mockNow = new Date("2026-02-19T10:00:00Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(mockNow);

    const resetAt = new Date(mockNow + 24 * 3600000); // 1 day later
    expect(formatResetIn(resetAt)).toBe("1d");
  });

  it("formats days and hours without minutes", () => {
    const mockNow = new Date("2026-02-19T10:00:00Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(mockNow);

    const resetAt = new Date(mockNow + 25 * 3600000); // 1d 1h later
    expect(formatResetIn(resetAt)).toBe("1d 1h");
  });

  it("formats days, hours, and minutes", () => {
    const mockNow = new Date("2026-02-19T10:00:00Z").getTime();
    vi.useFakeTimers();
    vi.setSystemTime(mockNow);

    const resetAt = new Date(mockNow + 140 * 3600000 + 39 * 60000); // 5d 20h 39m later
    expect(formatResetIn(resetAt)).toBe("5d 20h 39m");
  });
});
