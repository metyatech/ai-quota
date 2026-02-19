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
  // Basic JSON-RPC handler for MCP
  process.stdin.on("data", async (chunk) => {
    const lines = chunk.toString().split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const request = JSON.parse(line) as McpRequest;
        if (request.method === "initialize") {
          process.stdout.write(JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: { tools: {} },
              serverInfo: { name: "ai-quota", version: "0.5.1" }
            }
          }) + "\n");
        } else if (request.method === "tools/list") {
          process.stdout.write(JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: {
              tools: [{
                name: "get_quota",
                description: "Get current quota and rate limit status for all AI agents (Claude, Gemini, Copilot, etc.)",
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
            }
          }) + "\n");
        } else if (request.method === "tools/call") {
          const params = request.params as McpToolCallParams;
          if (params.name === "get_quota") {
            const all = await fetchAllRateLimits();
            const agent = params.arguments?.agent;
            
            let text: string;
            if (agent) {
              const sdkKey = agent === "amazon-q" ? "amazonQ" : (agent as keyof AllRateLimits);
              text = `${agent}: ${all[sdkKey].display}`;
            } else {
              text = Object.entries(all)
                .map(([k, v]) => `${k === "amazonQ" ? "amazon-q" : k}: ${v.display}`)
                .join("\n");
            }

            process.stdout.write(JSON.stringify({
              jsonrpc: "2.0",
              id: request.id,
              result: {
                content: [{ type: "text", text }]
              }
            }) + "\n");
          }
        }
      } catch (e) {
        // Ignore invalid JSON or processing errors in server mode
      }
    }
  });
}
