/**
 * Internal utilities for @metyatech/ai-quota
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Formats a date into a human-readable "remaining time" string.
 */
export function formatResetIn(resetAt: Date, now: Date = new Date()): string {
  const diffMs = resetAt.getTime() - now.getTime();
  if (diffMs <= 0) return "already reset";
  const totalMinutes = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const remainingMinutes = totalMinutes - days * 60 * 24;
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);

  return parts.join(" ");
}

/**
 * Dynamically resolves the package version from package.json.
 */
export function getVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const dir = path.dirname(fileURLToPath(import.meta.url));
    // Since this file is in src/, package.json is one level up
    const pkgPath = path.resolve(dir, "..", "package.json");
    const pkg = require(pkgPath) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
