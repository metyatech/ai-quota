/**
 * Lightweight MCP (Model Context Protocol) Server for ai-quota.
 *
 * Provides a 'get_quota' tool for AI agents to check their own usage limits.
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { fetchAllRateLimits } from "./index.js";
import type { AllRateLimits } from "./types.js";

function getVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(dir, "..", "package.json");
    const pkg = require(pkgPath) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export interface McpRequest {
  jsonrpc: string;
  id: number | string;
  method: string;
  params?: any;
}

export interface McpResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: any;
  error?: {
    code: number;
    message: string;
  };
}

interface McpToolCallParams {
  name: string;
  arguments?: {
    agent?: "claude" | "gemini" | "copilot" | "amazon-q" | "codex";
  };
}

/**
 * Core logic to handle an MCP request and return an MCP response.
 * Separated from I/O for testability.
 */
export async function handleMcpMessage(request: McpRequest): Promise<McpResponse | null> {
  try {
    if (request.method === "initialize") {
      return {
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "ai-quota", version: getVersion() }
        }
      };
    }

    if (request.method === "tools/list") {
      return {
        jsonrpc: "2.0",
        id: request.id,
        result: {
          tools: [
            {
              name: "get_quota",
              description:
                "Get current quota and rate limit status for AI agents. Returns data in a Markdown table.",
              inputSchema: {
                type: "object",
                properties: {
                  agent: {
                    type: "string",
                    enum: ["claude", "gemini", "copilot", "amazon-q", "codex"],
                    description: "Optional specific agent to check"
                  }
                }
              }
            }
          ]
        }
      };
    }

    if (request.method === "tools/call") {
      const params = request.params as McpToolCallParams;
      if (params.name === "get_quota") {
        const all = await fetchAllRateLimits();
        const agent = params.arguments?.agent;

        let markdown: string;
        if (agent) {
          const sdkKey = agent === "amazon-q" ? "amazonQ" : (agent as keyof AllRateLimits);
          const res = all[sdkKey];
          markdown = `### Quota for ${agent}\n\n| Agent | Status | Usage/Limit |\n| :--- | :--- | :--- |\n| ${agent} | ${res.status} | ${res.display} |`;
        } else {
          markdown =
            "### Current AI Agent Quotas\n\n| Agent | Status | Usage/Limit |\n| :--- | :--- | :--- |\n";
          markdown += Object.entries(all)
            .map(
              ([k, v]) =>
                `| ${k === "amazonQ" ? "amazon-q" : k} | ${(v as any).status} | ${(v as any).display} |`
            )
            .join("\n");
        }

        return {
          jsonrpc: "2.0",
          id: request.id,
          result: {
            content: [{ type: "text", text: markdown }]
          }
        };
      }
      return {
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32601, message: `Tool not found: ${params.name}` }
      };
    }

    // Default response for other methods
    return request.id ? { jsonrpc: "2.0", id: request.id, result: {} } : null;
  } catch (e) {
    return {
      jsonrpc: "2.0",
      id: request.id ?? null,
      error: { code: -32603, message: `Internal error: ${e}` }
    };
  }
}

/**
 * Runs the ai-quota MCP server on stdin/stdout.
 */
export async function runMcpServer(): Promise<void> {
  process.stdin.on("data", async (chunk) => {
    const lines = chunk.toString().split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const request = JSON.parse(line) as McpRequest;
        const response = await handleMcpMessage(request);
        if (response) {
          process.stdout.write(JSON.stringify(response) + "\n");
        }
      } catch (e) {
        process.stdout.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: "Parse error" }
          }) + "\n"
        );
      }
    }
  });
}
