import type { ErrorReason } from "./types.js";

export class QuotaFetchError extends Error {
  readonly reason: ErrorReason;
  readonly httpStatus?: number;

  constructor(
    reason: ErrorReason,
    message: string,
    options?: { httpStatus?: number; cause?: unknown }
  ) {
    // Node 18 supports ErrorOptions, but keep this compatible even if it's ignored.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    super(message, options as any);
    this.name = "QuotaFetchError";
    this.reason = reason;
    this.httpStatus = options?.httpStatus;
  }
}

export function isQuotaFetchError(e: unknown): e is QuotaFetchError {
  if (e instanceof QuotaFetchError) return true;
  if (!e || typeof e !== "object") return false;
  const r = e as { name?: unknown; reason?: unknown };
  return r.name === "QuotaFetchError" && typeof r.reason === "string";
}

