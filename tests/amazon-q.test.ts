import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  fetchAmazonQRateLimits,
  recordAmazonQUsage,
  resolveAmazonQUsageStatePath
} from "../src/amazon-q.js";

describe("fetchAmazonQRateLimits", () => {
  it("returns zero usage when state file does not exist", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-quota-amazonq-"));
    try {
      const statePath = resolveAmazonQUsageStatePath(root);
      const snapshot = fetchAmazonQRateLimits(statePath, 50, new Date("2026-02-02T00:00:00Z"));
      expect(snapshot.used).toBe(0);
      expect(snapshot.limit).toBe(50);
      expect(snapshot.percentRemaining).toBe(100);
      expect(snapshot.periodKey).toBe("2026-02");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reflects recorded usage correctly", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-quota-amazonq-"));
    try {
      const statePath = resolveAmazonQUsageStatePath(root);
      const feb = new Date("2026-02-02T00:00:00Z");
      recordAmazonQUsage(statePath, 10, feb);
      const snapshot = fetchAmazonQRateLimits(statePath, 50, feb);
      expect(snapshot.used).toBe(10);
      expect(snapshot.percentRemaining).toBe(80);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("resets to zero when period changes", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-quota-amazonq-"));
    try {
      const statePath = resolveAmazonQUsageStatePath(root);
      recordAmazonQUsage(statePath, 25, new Date("2026-02-02T00:00:00Z"));
      const snapshot = fetchAmazonQRateLimits(statePath, 50, new Date("2026-03-01T00:00:00Z"));
      expect(snapshot.used).toBe(0);
      expect(snapshot.periodKey).toBe("2026-03");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("clamps percentRemaining to 0 when used exceeds limit", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-quota-amazonq-"));
    try {
      const statePath = resolveAmazonQUsageStatePath(root);
      recordAmazonQUsage(statePath, 60, new Date("2026-02-02T00:00:00Z"));
      const snapshot = fetchAmazonQRateLimits(statePath, 50, new Date("2026-02-02T00:00:00Z"));
      expect(snapshot.percentRemaining).toBe(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("sets resetAt to the first day of the next month (UTC)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-quota-amazonq-"));
    try {
      const statePath = resolveAmazonQUsageStatePath(root);
      const snapshot = fetchAmazonQRateLimits(statePath, 50, new Date("2026-02-15T12:00:00Z"));
      expect(snapshot.resetAt.getUTCFullYear()).toBe(2026);
      expect(snapshot.resetAt.getUTCMonth()).toBe(2); // March
      expect(snapshot.resetAt.getUTCDate()).toBe(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("recordAmazonQUsage", () => {
  it("accumulates across multiple calls within the same period", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-quota-amazonq-"));
    try {
      const statePath = resolveAmazonQUsageStatePath(root);
      const feb = new Date("2026-02-05T00:00:00Z");
      recordAmazonQUsage(statePath, 1, feb);
      recordAmazonQUsage(statePath, 2, feb);
      recordAmazonQUsage(statePath, 3, feb);
      const snapshot = fetchAmazonQRateLimits(statePath, 50, feb);
      expect(snapshot.used).toBe(6);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("ignores negative counts (treats as 0)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-quota-amazonq-"));
    try {
      const statePath = resolveAmazonQUsageStatePath(root);
      const feb = new Date("2026-02-05T00:00:00Z");
      recordAmazonQUsage(statePath, -5, feb);
      const snapshot = fetchAmazonQRateLimits(statePath, 50, feb);
      expect(snapshot.used).toBe(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
