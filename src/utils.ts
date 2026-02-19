/**
 * Internal utilities for @metyatech/ai-quota
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
