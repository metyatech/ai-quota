/**
 * Internal utilities for @metyatech/ai-quota
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Formats a date into a human-readable "remaining time" string.
 */
export function formatResetIn(resetAt: Date): string {
  const diffMs = resetAt.getTime() - Date.now();
  if (diffMs <= 0) return "already reset";
  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
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
