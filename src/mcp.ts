/**
 * Lightweight MCP (Model Context Protocol) Server for ai-quota.
 * 
 * Provides tools and resources for AI agents to stay aware of usage limits.
 */

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { fetchAllRateLimits, SUPPORTED_AGENTS, SupportedAgent, agentToSdkKey } from "./index.js";
import type { AllRateLimits } from "./types.js";
import { getVersion } from "./utils.js";

function getPackageVersion(): string {
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
    agent?: string;
  };
}

async function getQuotaMarkdown(agent?: string): Promise<string> {
  const all = await fetchAllRateLimits({
    agents: agent ? [agent as SupportedAgent] : undefined
  });
  
  let markdown: string;
  if (agent && (SUPPORTED_AGENTS as readonly string[]).includes(agent)) {
    const sdkKey = agentToSdkKey(agent as SupportedAgent);
    const res = all[sdkKey];
    markdown = `### Quota for ${agent}\n\n| Agent | Status | Usage/Limit |\n| :--- | :--- | :--- |\n| ${agent} | ${res.status} | ${res.display} |`;
  } else {
    markdown = `### Current AI Agent Quotas\n**Status: ${all.summary.status.toUpperCase()}** - ${all.summary.message}\n\n| Agent | Status | Usage/Limit |\n| :--- | :--- | :--- |\n`;
    markdown += (Object.entries(all) as [keyof AllRateLimits, AllRateLimits[keyof AllRateLimits]][])
      .filter(([k]) => k !== "summary")
      .map(([k, v]) => `| ${k === "amazonQ" ? "amazon-q" : k} | ${(v as any).status} | ${(v as any).display} |`)
      .join("\n");
  }
  return markdown;
}

/**
 * Runs the ai-quota MCP server on stdin/stdout.
 */
export async function runMcpServer(): Promise<void> {
  const sendResponse = (id: number | string, result: any) => {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
  };

  const sendError = (id: number | string | null, code: number, message: string) => {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
  };

  process.stdin.on("data", async (chunk) => {
    const lines = chunk.toString().split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const request = JSON.parse(line) as McpRequest;
        
        if (request.method === "initialize") {
          sendResponse(request.id, {
            protocolVersion: "2024-11-05",
            capabilities: { 
              tools: {},
              resources: {}
            },
            serverInfo: { name: "ai-quota", version: getPackageVersion() }
          });
        } else if (request.method === "tools/list") {
          sendResponse(request.id, {
            tools: [{
              name: "get_quota",
              description: "Get current quota and rate limit status for AI agents in Markdown format.",
              inputSchema: {
                type: "object",
                properties: {
                  agent: { 
                    type: "string", 
                    enum: [...SUPPORTED_AGENTS], 
                    description: "Optional specific agent to check" 
                  }
                }
              }
            }]
          });
        } else if (request.method === "resources/list") {
          sendResponse(request.id, {
            resources: [{
              uri: "quota://current",
              name: "Current AI Quota Status",
              description: "Live view of all AI agent usage limits and remaining quota.",
              mimeType: "text/markdown"
            }]
          });
        } else if (request.method === "resources/read") {
          if (request.params.uri === "quota://current") {
            const markdown = await getQuotaMarkdown();
            sendResponse(request.id, {
              contents: [{
                uri: "quota://current",
                mimeType: "text/markdown",
                text: markdown
              }]
            });
          } else {
            sendError(request.id, -32602, `Invalid resource URI: ${request.params.uri}`);
          }
        } else if (request.method === "tools/call") {
          const params = request.params as McpToolCallParams;
          if (params.name === "get_quota") {
            const markdown = await getQuotaMarkdown(params.arguments?.agent);
            sendResponse(request.id, {
              content: [{ type: "text", text: markdown }]
            });
          } else {
            sendError(request.id, -32601, `Tool not found: ${params.name}`);
          }
        } else {
          if (request.id) sendResponse(request.id, {});
        }
      } catch (e) {
        sendError(null, -32700, "Parse error");
      }
    }
  });
}
