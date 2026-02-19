/**
 * Lightweight MCP (Model Context Protocol) Server for ai-quota.
 * 
 * Provides a 'get_quota' tool for AI agents to check their own usage limits.
 */

import { fetchAllRateLimits } from "./index.js";
import type { AllRateLimits } from "./types.js";

interface McpRequest {
  jsonrpc: string;
  id: number | string;
  method: string;
  params?: any;
}

interface McpToolCallParams {
  name: string;
  arguments?: {
    agent?: "claude" | "gemini" | "copilot" | "amazon-q" | "codex";
  };
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

  // Basic JSON-RPC handler for MCP
  process.stdin.on("data", async (chunk) => {
    const lines = chunk.toString().split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const request = JSON.parse(line) as McpRequest;
        
        if (request.method === "initialize") {
          sendResponse(request.id, {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "ai-quota", version: "0.5.2" }
          });
        } else if (request.method === "tools/list") {
          sendResponse(request.id, {
            tools: [{
              name: "get_quota",
              description: "Get current quota and rate limit status for AI agents. Returns data in a Markdown table.",
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
            }]
          });
        } else if (request.method === "tools/call") {
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
              markdown = "### Current AI Agent Quotas\n\n| Agent | Status | Usage/Limit |\n| :--- | :--- | :--- |\n";
              markdown += Object.entries(all)
                .map(([k, v]) => `| ${k === "amazonQ" ? "amazon-q" : k} | ${v.status} | ${v.display} |`)
                .join("\n");
            }

            sendResponse(request.id, {
              content: [{ type: "text", text: markdown }]
            });
          } else {
            sendError(request.id, -32601, `Tool not found: ${params.name}`);
          }
        } else {
          // Unsupported method
          if (request.id) sendResponse(request.id, {});
        }
      } catch (e) {
        sendError(null, -32700, "Parse error");
      }
    }
  });
}
