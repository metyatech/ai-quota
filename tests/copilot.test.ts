import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCopilotUserInfo, parseCopilotQuotaHeader, getCopilotToken } from "../src/copilot.js";

describe("getCopilotToken", () => {
  const originalEnv = { ...process.env };
  const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
  const tempHomes = new Set<string>();

  function createTempHome(): string {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "ai-quota-copilot-"));
    tempHomes.add(home);
    return home;
  }

  function setPlatform(value: NodeJS.Platform): void {
    Object.defineProperty(process, "platform", { value, configurable: true });
  }

  afterEach(() => {
    process.env = { ...originalEnv };
    if (originalPlatformDescriptor) {
      Object.defineProperty(process, "platform", originalPlatformDescriptor);
    }
    for (const home of tempHomes) {
      fs.rmSync(home, { recursive: true, force: true });
    }
    tempHomes.clear();
    vi.restoreAllMocks();
  });

  it("prefers COPILOT_GITHUB_TOKEN over GH_TOKEN and GITHUB_TOKEN", () => {
    process.env.COPILOT_GITHUB_TOKEN = "copilot-token";
    process.env.GH_TOKEN = "gh-token";
    process.env.GITHUB_TOKEN = "github-token";

    expect(getCopilotToken()).toBe("copilot-token");
  });

  it("returns token from GH_TOKEN when the Copilot-specific env var is absent", () => {
    delete process.env.COPILOT_GITHUB_TOKEN;
    process.env.GH_TOKEN = "gh-token";
    process.env.GITHUB_TOKEN = "github-token";

    expect(getCopilotToken()).toBe("gh-token");
  });

  it("returns plaintext token from Copilot CLI config when available", () => {
    delete process.env.COPILOT_GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    delete process.env.GITHUB_TOKEN;

    const home = createTempHome();
    const configDir = path.join(home, ".copilot");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify({ access_token: "gho_plaintext_token_abcdefghijkl" }),
      "utf8"
    );
    expect(getCopilotToken(false, { homeDir: home })).toBe("gho_plaintext_token_abcdefghijkl");
  });

  it("returns token from Windows Credential Manager when Copilot CLI is signed in", () => {
    delete process.env.COPILOT_GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    delete process.env.GITHUB_TOKEN;
    setPlatform("win32");

    const home = createTempHome();
    const configDir = path.join(home, ".copilot");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify({
        last_logged_in_user: {
          host: "https://github.com",
          login: "metyatech"
        }
      }),
      "utf8"
    );
    const execFileText = (command: string): string => {
      const executable = command.toLowerCase();
      if (executable.endsWith("cmdkey.exe")) {
        return "Currently stored credentials:\r\n    Target: LegacyGeneric:target=copilot-cli/https://github.com:metyatech\r\n";
      }
      if (executable.endsWith("pwsh.exe") || executable.endsWith("powershell.exe")) {
        return Buffer.from("gho_windows_token_abcdefghijklmnop", "utf8").toString("base64");
      }
      throw new Error(`unexpected command: ${command}`);
    };

    expect(
      getCopilotToken(false, {
        homeDir: home,
        platform: "win32",
        execFileText
      })
    ).toBe("gho_windows_token_abcdefghijklmnop");
  });

  it("returns null when no token source is available", () => {
    delete process.env.COPILOT_GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    delete process.env.GITHUB_TOKEN;

    const home = createTempHome();
    const execFileText = (): string => {
      throw new Error("not found");
    };

    expect(getCopilotToken(false, { homeDir: home, platform: "win32", execFileText })).toBeNull();
  });
});

describe("parseCopilotUserInfo", () => {
  it("parses premium interactions snapshot", () => {
    const usage = parseCopilotUserInfo({
      quota_snapshots: {
        premium_interactions: {
          entitlement: 3000,
          percent_remaining: 72,
          overage_count: 1,
          overage_permitted: true
        }
      },
      quota_reset_date: "2026-02-15T00:00:00Z"
    });

    expect(usage).not.toBeNull();
    expect(usage?.percentRemaining).toBe(72);
    expect(usage?.entitlement).toBe(3000);
    expect(usage?.overageUsed).toBe(1);
    expect(usage?.overageEnabled).toBe(true);
    expect(usage?.source).toBe("user");
  });

  it("returns null when quota_snapshots is missing", () => {
    expect(parseCopilotUserInfo({ quota_reset_date: "2026-02-15T00:00:00Z" })).toBeNull();
  });

  it("returns null when premium_interactions is missing", () => {
    expect(
      parseCopilotUserInfo({
        quota_snapshots: { other: {} },
        quota_reset_date: "2026-02-15T00:00:00Z"
      })
    ).toBeNull();
  });

  it("returns null when quota_reset_date is missing", () => {
    expect(
      parseCopilotUserInfo({
        quota_snapshots: {
          premium_interactions: { entitlement: 3000, percent_remaining: 72 }
        }
      })
    ).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(parseCopilotUserInfo(null)).toBeNull();
    expect(parseCopilotUserInfo("string")).toBeNull();
    expect(parseCopilotUserInfo(42)).toBeNull();
  });

  it("clamps percentRemaining to [0, 100]", () => {
    const usage = parseCopilotUserInfo({
      quota_snapshots: {
        premium_interactions: { entitlement: 100, percent_remaining: 150 }
      },
      quota_reset_date: "2026-02-15T00:00:00Z"
    });
    expect(usage?.percentRemaining).toBe(100);
  });
});

describe("parseCopilotQuotaHeader", () => {
  it("parses quota header snapshot", () => {
    const usage = parseCopilotQuotaHeader(
      "ent=3000&rem=64&rst=2026-02-15T00:00:00Z&ov=0&ovPerm=false"
    );

    expect(usage).not.toBeNull();
    expect(usage?.percentRemaining).toBe(64);
    expect(usage?.entitlement).toBe(3000);
    expect(usage?.overageEnabled).toBe(false);
    expect(usage?.overageUsed).toBe(0);
    expect(usage?.source).toBe("header");
  });

  it("returns null for empty string", () => {
    expect(parseCopilotQuotaHeader("")).toBeNull();
    expect(parseCopilotQuotaHeader("   ")).toBeNull();
  });

  it("returns null when ent is missing", () => {
    expect(parseCopilotQuotaHeader("rem=64&rst=2026-02-15T00:00:00Z")).toBeNull();
  });

  it("returns null when rem is missing", () => {
    expect(parseCopilotQuotaHeader("ent=3000&rst=2026-02-15T00:00:00Z")).toBeNull();
  });

  it("infers reset date one month ahead when rst is missing", () => {
    const now = new Date("2026-02-02T00:00:00Z");
    const usage = parseCopilotQuotaHeader("ent=3000&rem=50", now);
    expect(usage).not.toBeNull();
    expect(usage?.resetAt.getMonth()).toBe(2); // March (0-indexed)
  });

  it("parses overage fields correctly", () => {
    const usage = parseCopilotQuotaHeader(
      "ent=1000&rem=30&rst=2026-03-01T00:00:00Z&ov=5&ovPerm=true"
    );
    expect(usage?.overageUsed).toBe(5);
    expect(usage?.overageEnabled).toBe(true);
  });
});
