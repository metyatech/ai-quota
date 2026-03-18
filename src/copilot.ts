import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { CopilotUsage } from "./types.js";
import { QuotaFetchError } from "./errors.js";

export type { CopilotUsage } from "./types.js";

type CopilotCliAccount = {
  host: string;
  login: string;
  access_token?: string;
};

type CopilotCliConfig = {
  plaintext?: boolean;
  access_token?: string;
  last_logged_in_user?: CopilotCliAccount | null;
  logged_in_users?: CopilotCliAccount[] | null;
};

type CopilotTokenRuntime = {
  execFileText?: (command: string, args: string[]) => string;
  existsSync?: typeof fs.existsSync;
  readFileSync?: typeof fs.readFileSync;
  writeFileSync?: typeof fs.writeFileSync;
  unlinkSync?: typeof fs.unlinkSync;
  homeDir?: string;
  platform?: NodeJS.Platform;
  tmpDir?: string;
};

type ResolvedCopilotTokenRuntime = {
  execFileText: (command: string, args: string[]) => string;
  existsSync: typeof fs.existsSync;
  readFileSync: typeof fs.readFileSync;
  writeFileSync: typeof fs.writeFileSync;
  unlinkSync: typeof fs.unlinkSync;
  homeDir: string;
  platform: NodeJS.Platform;
  tmpDir: string;
};

const WINDOWS_CRED_READ_PS1 = [
  "param([string]$Target)",
  "$ErrorActionPreference = 'Stop'",
  "$code = @'",
  "using System;",
  "using System.Runtime.InteropServices;",
  "",
  "public static class CredMan {",
  "  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]",
  "  public struct CREDENTIAL {",
  "    public int Flags;",
  "    public int Type;",
  "    public string TargetName;",
  "    public string Comment;",
  "    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;",
  "    public int CredentialBlobSize;",
  "    public IntPtr CredentialBlob;",
  "    public int Persist;",
  "    public int AttributeCount;",
  "    public IntPtr Attributes;",
  "    public string TargetAlias;",
  "    public string UserName;",
  "  }",
  "",
  '  [DllImport("Advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]',
  "  public static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);",
  "",
  '  [DllImport("Advapi32.dll", SetLastError = true)]',
  "  public static extern void CredFree([In] IntPtr cred);",
  "",
  "  public static byte[] ReadGenericBytes(string target) {",
  "    IntPtr credPtr;",
  "    if (!CredRead(target, 1, 0, out credPtr)) {",
  "      return null;",
  "    }",
  "",
  "    try {",
  "      var cred = (CREDENTIAL)Marshal.PtrToStructure(credPtr, typeof(CREDENTIAL));",
  "      if (cred.CredentialBlob == IntPtr.Zero || cred.CredentialBlobSize <= 0) {",
  "        return null;",
  "      }",
  "",
  "      byte[] blob = new byte[cred.CredentialBlobSize];",
  "      Marshal.Copy(cred.CredentialBlob, blob, 0, cred.CredentialBlobSize);",
  "      return blob;",
  "    } finally {",
  "      CredFree(credPtr);",
  "    }",
  "  }",
  "}",
  "'@",
  "Add-Type -TypeDefinition $code",
  "$bytes = [CredMan]::ReadGenericBytes($Target)",
  "if ($null -eq $bytes) {",
  "  exit 0",
  "}",
  "[Console]::Out.Write([Convert]::ToBase64String($bytes))"
].join("\n");

function normalizeTokenString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function scoreCopilotTokenCandidate(value: string | null): number {
  if (!value) return 0;
  if (/^(gho_|ghu_|github_pat_)/.test(value)) return 3;
  if (/^[A-Za-z0-9_]{20,}$/.test(value)) return 2;
  if (/^[\x20-\x7e]{12,}$/.test(value)) return 1;
  return 0;
}

function execFileText(command: string, args: string[]): string {
  return childProcess.execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true
  });
}

function resolveHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

function createCopilotTokenRuntime(
  overrides: CopilotTokenRuntime = {}
): ResolvedCopilotTokenRuntime {
  return {
    execFileText: overrides.execFileText ?? execFileText,
    existsSync: overrides.existsSync ?? fs.existsSync,
    readFileSync: overrides.readFileSync ?? fs.readFileSync,
    writeFileSync: overrides.writeFileSync ?? fs.writeFileSync,
    unlinkSync: overrides.unlinkSync ?? fs.unlinkSync,
    homeDir: overrides.homeDir ?? resolveHomeDir(),
    platform: overrides.platform ?? process.platform,
    tmpDir: overrides.tmpDir ?? os.tmpdir()
  };
}

function getCopilotConfigPath(runtime: ResolvedCopilotTokenRuntime): string {
  return path.join(runtime.homeDir, ".copilot", "config.json");
}

function readCopilotCliConfig(
  runtime: ResolvedCopilotTokenRuntime,
  verbose: boolean
): CopilotCliConfig | null {
  const configPath = getCopilotConfigPath(runtime);
  if (!runtime.existsSync(configPath)) return null;
  if (verbose) process.stderr.write(`[verbose] copilot: checking ${configPath}\n`);
  try {
    const parsed = JSON.parse(runtime.readFileSync(configPath, "utf8")) as CopilotCliConfig;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeCopilotHost(host: string): string {
  const trimmed = host.trim();
  if (!trimmed) return "";
  return trimmed.includes("://") ? trimmed : `https://${trimmed}`;
}

function collectCopilotCliAccounts(config: CopilotCliConfig | null): CopilotCliAccount[] {
  if (!config) return [];

  const accounts: CopilotCliAccount[] = [];
  const seen = new Set<string>();
  const rawAccounts = [config.last_logged_in_user, ...(config.logged_in_users ?? [])];

  for (const account of rawAccounts) {
    const host = normalizeTokenString(account?.host);
    const login = normalizeTokenString(account?.login);
    if (!host || !login) continue;
    const normalizedHost = normalizeCopilotHost(host);
    const key = `${normalizedHost}\n${login}`;
    if (seen.has(key)) continue;
    seen.add(key);
    accounts.push({
      host: normalizedHost,
      login,
      access_token: normalizeTokenString(account?.access_token) ?? undefined
    });
  }

  return accounts;
}

function getPlaintextCopilotToken(config: CopilotCliConfig | null): string | null {
  if (!config) return null;
  const candidates = [
    normalizeTokenString(config.access_token),
    normalizeTokenString(config.last_logged_in_user?.access_token),
    ...collectCopilotCliAccounts(config).map((account) =>
      normalizeTokenString(account.access_token)
    )
  ];

  for (const candidate of candidates) {
    if (scoreCopilotTokenCandidate(candidate) > 0) return candidate;
  }

  return null;
}

function parseWindowsCredentialTargets(output: string): string[] {
  return [...output.matchAll(/^\s*Target:\s+(?:LegacyGeneric:target=)?([^\r\n]+)\s*$/gm)]
    .map((match) => normalizeTokenString(match[1]))
    .filter((target): target is string => Boolean(target));
}

function resolvePowerShellExecutable(runtime: ResolvedCopilotTokenRuntime): string {
  const candidates = [
    path.join(process.env.ProgramFiles ?? "", "PowerShell", "7", "pwsh.exe"),
    path.join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe"
    ),
    "pwsh.exe",
    "powershell.exe"
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (!path.isAbsolute(candidate) || runtime.existsSync(candidate)) return candidate;
  }

  return "powershell.exe";
}

function decodeWindowsCredentialBlob(encoded: string): string | null {
  const trimmed = normalizeTokenString(encoded);
  if (!trimmed) return null;

  const bytes = Buffer.from(trimmed, "base64");
  if (bytes.length === 0) return null;

  const utf8 = normalizeTokenString(bytes.toString("utf8").replace(/\0+$/g, ""));
  const utf16 = normalizeTokenString(bytes.toString("utf16le").replace(/\0+$/g, ""));
  const utf8Score = scoreCopilotTokenCandidate(utf8);
  const utf16Score = scoreCopilotTokenCandidate(utf16);

  if (utf8Score === 0 && utf16Score === 0) return null;
  return utf8Score >= utf16Score ? utf8 : utf16;
}

function readWindowsCredentialToken(
  runtime: ResolvedCopilotTokenRuntime,
  target: string
): string | null {
  const scriptPath = path.join(
    runtime.tmpDir,
    `ai-quota-copilot-cred-${process.pid}-${Date.now()}.ps1`
  );
  const shell = resolvePowerShellExecutable(runtime);

  try {
    runtime.writeFileSync(scriptPath, WINDOWS_CRED_READ_PS1, "utf8");
    const encoded = runtime.execFileText(shell, [
      "-NoProfile",
      "-NonInteractive",
      "-File",
      scriptPath,
      target
    ]);
    return decodeWindowsCredentialBlob(encoded);
  } catch {
    return null;
  } finally {
    try {
      runtime.unlinkSync(scriptPath);
    } catch {
      // ignore cleanup errors
    }
  }
}

function getWindowsCopilotCredentialTargets(
  runtime: ResolvedCopilotTokenRuntime,
  config: CopilotCliConfig | null
): string[] {
  const targets: string[] = [];
  const seen = new Set<string>();
  const addTarget = (target: string | null) => {
    const normalized = normalizeTokenString(target);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    targets.push(normalized);
  };

  for (const account of collectCopilotCliAccounts(config)) {
    addTarget(`copilot-cli/${account.host}:${account.login}`);
  }

  try {
    const output = runtime.execFileText("cmdkey.exe", ["/list"]);
    for (const target of parseWindowsCredentialTargets(output)) {
      if (target.startsWith("copilot-cli/")) addTarget(target);
    }
  } catch {
    // ignore
  }

  return targets;
}

/**
 * Resolves a GitHub Copilot token from environment variables,
 * Copilot CLI / GitHub CLI authentication stores, or the 'gh' CLI command.
 *
 * Order of discovery:
 * 1. COPILOT_GITHUB_TOKEN environment variable
 * 2. GH_TOKEN environment variable
 * 3. GITHUB_TOKEN environment variable
 * 4. Copilot CLI stored credentials (~/.copilot/config.json or Windows Credential Manager)
 * 5. GitHub CLI configuration file (~/.config/gh/hosts.yml)
 * 6. `gh auth token` command execution
 *
 * @param verbose - Whether to print debug information to stderr
 * @returns The discovered token or null if no token source is found
 */
export function getCopilotToken(
  verbose: boolean = false,
  runtimeOverrides: CopilotTokenRuntime = {}
): string | null {
  const runtime = createCopilotTokenRuntime(runtimeOverrides);
  const envSources = [
    ["COPILOT_GITHUB_TOKEN", process.env.COPILOT_GITHUB_TOKEN],
    ["GH_TOKEN", process.env.GH_TOKEN],
    ["GITHUB_TOKEN", process.env.GITHUB_TOKEN]
  ] as const;

  for (const [name, value] of envSources) {
    const token = normalizeTokenString(value);
    if (!token) continue;
    if (verbose) process.stderr.write(`[verbose] copilot: using token from ${name} env var\n`);
    return token;
  }

  const copilotConfig = readCopilotCliConfig(runtime, verbose);
  const plaintextToken = getPlaintextCopilotToken(copilotConfig);
  if (plaintextToken) {
    if (verbose)
      process.stderr.write("[verbose] copilot: found plaintext token in ~/.copilot/config.json\n");
    return plaintextToken;
  }

  if (runtime.platform === "win32") {
    for (const target of getWindowsCopilotCredentialTargets(runtime, copilotConfig)) {
      if (verbose)
        process.stderr.write(
          `[verbose] copilot: checking Windows Credential Manager target ${target}\n`
        );
      const token = readWindowsCredentialToken(runtime, target);
      if (token) {
        if (verbose)
          process.stderr.write(
            `[verbose] copilot: found token in Windows Credential Manager (${target})\n`
          );
        return token;
      }
    }
  }

  const candidates = [
    path.join(runtime.homeDir, ".config", "gh", "hosts.yml"),
    path.join(runtime.homeDir, "AppData", "Roaming", "GitHub CLI", "hosts.yml")
  ];
  for (const p of candidates) {
    try {
      if (!runtime.existsSync(p)) continue;
      if (verbose) process.stderr.write(`[verbose] copilot: checking ${p}\n`);
      const content = runtime.readFileSync(p, "utf8");
      // Simple line-by-line search for oauth_token under github.com
      const match = content.match(/oauth_token:\s*(\S+)/);
      if (match?.[1]) {
        if (verbose) process.stderr.write(`[verbose] copilot: found token in ${p}\n`);
        return match[1];
      }
    } catch {
      // ignore
    }
  }

  // Final fallback: try 'gh auth token'
  try {
    if (verbose)
      process.stderr.write("[verbose] copilot: trying 'gh auth token --hostname github.com'\n");
    const token = runtime.execFileText("gh", ["auth", "token", "--hostname", "github.com"]).trim();
    if (token) {
      if (verbose) process.stderr.write("[verbose] copilot: found token via gh CLI\n");
      return token;
    }
  } catch {
    // ignore
  }

  return null;
}

const DEFAULT_API_BASE_URL = "https://api.github.com";
const DEFAULT_API_VERSION = "2025-05-01";

export type FetchCopilotRateLimitsOptions = {
  token: string;
  timeoutSeconds?: number;
  apiBaseUrl?: string;
  apiVersion?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizePercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function normalizeApiBaseUrl(value: string | undefined): string {
  const base = value?.trim() || DEFAULT_API_BASE_URL;
  return base.endsWith("/") ? base.slice(0, -1) : base;
}

/**
 * Parses a GitHub Copilot user info response body into a CopilotUsage snapshot.
 *
 * Returns null when the response does not contain the expected fields.
 */
export function parseCopilotUserInfo(data: unknown, _now: Date = new Date()): CopilotUsage | null {
  if (!isRecord(data)) return null;

  const quotaSnapshots = data.quota_snapshots;
  if (!isRecord(quotaSnapshots)) return null;

  const premium = quotaSnapshots.premium_interactions;
  if (!isRecord(premium)) return null;

  const entitlement = toNumber(premium.entitlement);
  const percentRemaining = toNumber(premium.percent_remaining);
  const resetText = typeof data.quota_reset_date === "string" ? data.quota_reset_date : null;

  if (entitlement === null || percentRemaining === null || !resetText) return null;

  const resetAt = new Date(resetText);
  if (Number.isNaN(resetAt.getTime())) return null;

  const overageUsed = toNumber(premium.overage_count) ?? 0;
  const overageEnabled = premium.overage_permitted === true;

  return {
    percentRemaining: normalizePercent(percentRemaining),
    resetAt,
    entitlement,
    overageUsed,
    overageEnabled,
    source: "user",
    raw: data
  };
}

/**
 * Parses a Copilot quota snapshot from an HTTP response header value.
 *
 * The header is formatted as URL search params, e.g.:
 * `ent=3000&rem=64&rst=2026-02-15T00:00:00Z&ov=0&ovPerm=false`
 */
export function parseCopilotQuotaHeader(
  headerValue: string,
  now: Date = new Date()
): CopilotUsage | null {
  const trimmed = headerValue.trim();
  if (!trimmed) return null;

  const params = new URLSearchParams(trimmed);
  const entitlement = toNumber(params.get("ent"));
  const percentRemaining = toNumber(params.get("rem"));

  if (entitlement === null || percentRemaining === null) return null;

  const resetText = params.get("rst");
  const resetAt = resetText ? new Date(resetText) : new Date(now.getTime());
  if (resetText && Number.isNaN(resetAt.getTime())) return null;
  if (!resetText) {
    resetAt.setMonth(resetAt.getMonth() + 1);
  }

  const overageUsed = toNumber(params.get("ov")) ?? 0;
  const overageEnabled = params.get("ovPerm") === "true";

  return {
    percentRemaining: normalizePercent(percentRemaining),
    resetAt,
    entitlement,
    overageUsed,
    overageEnabled,
    source: "header",
    raw: headerValue
  };
}

/**
 * Fetches Copilot quota usage from the GitHub Copilot internal API.
 *
 * Requires a valid GitHub personal access token with the appropriate `copilot`
 * scope. This function calls the `/copilot_internal/user` endpoint and parses
 * both the JSON body and response headers for quota snapshots.
 *
 * @param options - Options containing the token and optional configuration
 * @param now - Reference date for parsing (default: current system time)
 * @returns A promise resolving to CopilotUsage or null if the request fails
 */
export async function fetchCopilotRateLimits(
  options: FetchCopilotRateLimitsOptions,
  now: Date = new Date()
): Promise<CopilotUsage | null> {
  const baseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
  const url = `${baseUrl}/copilot_internal/user`;
  const controller = new AbortController();
  const timeoutSeconds = options.timeoutSeconds ?? 20;
  const timeout = setTimeout(() => controller.abort(), timeoutSeconds * 1000);
  const apiVersion = options.apiVersion?.trim() || DEFAULT_API_VERSION;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `token ${options.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": apiVersion,
        "User-Agent": "ai-quota"
      },
      signal: controller.signal
    });

    const headerValue =
      response.headers.get("x-quota-snapshot-premium_interactions") ||
      response.headers.get("x-quota-snapshot-premium_models");
    const headerUsage = headerValue ? parseCopilotQuotaHeader(headerValue, now) : null;

    const bodyText = await response.text();
    if (!response.ok) {
      const reason =
        response.status === 401 || response.status === 403
          ? "auth_failed"
          : response.status === 404 || response.status === 410
            ? "endpoint_changed"
            : "api_error";
      throw new QuotaFetchError(
        reason,
        `Copilot user info request failed (${response.status} ${response.statusText}).`,
        { httpStatus: response.status }
      );
    }

    let parsed: unknown = null;
    if (bodyText.trim()) {
      try {
        parsed = JSON.parse(bodyText);
      } catch {
        parsed = null;
      }
    }

    const usage = parseCopilotUserInfo(parsed, now);
    const out = usage ?? headerUsage;
    if (!out) {
      throw new QuotaFetchError("parse_error", "Copilot API response missing quota fields.");
    }
    return out;
  } catch (error) {
    if (error instanceof QuotaFetchError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new QuotaFetchError("timeout", "Copilot user info request timed out.", {
        cause: error
      });
    }
    throw new QuotaFetchError("network_error", "Copilot user info request failed.", {
      cause: error
    });
  } finally {
    clearTimeout(timeout);
  }
}
