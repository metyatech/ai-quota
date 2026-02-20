import { describe, expect, it, vi } from "vitest";
import { handleMcpMessage } from "../src/mcp.js";
import * as index from "../src/index.js";

describe("handleMcpMessage", () => {
  it("handles initialize request", async () => {
    const response = await handleMcpMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize"
    });
    expect(response?.result.serverInfo.name).toBe("ai-quota");
  });

  it("handles tools/list request", async () => {
    const response = await handleMcpMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list"
    });
    expect(response?.result.tools).toHaveLength(1);
    expect(response?.result.tools[0].name).toBe("get_quota");
  });

  it("handles tools/call request for get_quota", async () => {
    // Mock fetchAllRateLimits to avoid real network/file calls
    vi.spyOn(index, "fetchAllRateLimits").mockResolvedValue({
      summary: { status: "healthy", message: "ok" },
      claude: { status: "ok", display: "10%", data: null, error: null },
      gemini: { status: "ok", display: "20%", data: null, error: null },
      copilot: { status: "ok", display: "30%", data: null, error: null },
      codex: { status: "no-data", display: "none", data: null, error: null }
    } as any);

    const response = await handleMcpMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "get_quota",
        arguments: {}
      }
    });

    expect(response?.result.content[0].text).toContain("| claude | ok | 10% |");
    expect(response?.result.content[0].text).toContain("| gemini | ok | 20% |");
  });

  it("returns error for unknown tool", async () => {
    const response = await handleMcpMessage({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "unknown_tool"
      }
    });
    expect(response?.error?.code).toBe(-32601);
  });
});
