/**
 * Lightweight MCP (Model Context Protocol) Server for ai-quota.
 * 
 * Provides a 'get_quota' tool for AI agents to check their own usage limits.
 */

import { fetchAllRateLimits } from "./index.js";

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
        const request = JSON.parse(line);
        if (request.method === "initialize") {
          process.stdout.write(JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: { tools: {} },
              serverInfo: { name: "ai-quota", version: "0.5.0" }
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
                    agent: { type: "string", enum: ["claude", "gemini", "copilot", "amazon-q", "codex"], description: "Optional specific agent to check" }
                  }
                }
              }]
            }
          }) + "\n");
        } else if (request.method === "tools/call") {
          const { name, arguments: args } = request.params;
          if (name === "get_quota") {
            const all = await fetchAllRateLimits();
            const agent = (args as any)?.agent;
            const result = agent ? (all as any)[agent === "amazon-q" ? "amazonQ" : agent] : all;
            
            // Format result for tool output
            const text = agent 
              ? `${agent}: ${result.display}` 
              : Object.entries(all).map(([k, v]) => `${k}: ${(v as any).display}`).join("\n");

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
        // Ignore invalid JSON
      }
    }
  });
}
