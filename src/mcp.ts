/**
 * Lightweight MCP (Model Context Protocol) Server for ai-quota.
 * 
 * Provides tools and resources for AI agents to stay aware of usage limits.
 */

import { fetchAllRateLimits, SUPPORTED_AGENTS, SupportedAgent, agentToSdkKey } from "./index.js";
import type { AllRateLimits } from "./types.js";
import { getVersion } from "./utils.js";

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
  process.stdin.on("data", async (chunk) => {
    const lines = chunk.toString().split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const request = JSON.parse(line) as McpRequest;
        const response = await handleMcpMessage(request);
        if (response) process.stdout.write(JSON.stringify(response) + "\n");
      } catch (e) {
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }) + "\n");
      }
    }
  });
}

export async function handleMcpMessage(request: McpRequest): Promise<McpResponse | null> {
  if (request.id === undefined || request.id === null) return null;

  const ok = (result: unknown): McpResponse => ({ jsonrpc: "2.0", id: request.id, result });
  const err = (code: number, message: string): McpResponse => ({
    jsonrpc: "2.0",
    id: request.id,
    error: { code, message }
  });

  if (request.method === "initialize") {
    return ok({
      protocolVersion: "2024-11-05",
      capabilities: {
        tools: {},
        resources: {}
      },
      serverInfo: { name: "ai-quota", version: getVersion() }
    });
  }

  if (request.method === "tools/list") {
    return ok({
      tools: [
        {
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
        }
      ]
    });
  }

  if (request.method === "resources/list") {
    return ok({
      resources: [
        {
          uri: "quota://current",
          name: "Current AI Quota Status",
          description: "Live view of all AI agent usage limits and remaining quota.",
          mimeType: "text/markdown"
        }
      ]
    });
  }

  if (request.method === "resources/read") {
    const uri = request.params?.uri;
    if (uri === "quota://current") {
      const markdown = await getQuotaMarkdown();
      return ok({
        contents: [
          {
            uri: "quota://current",
            mimeType: "text/markdown",
            text: markdown
          }
        ]
      });
    }
    return err(-32602, `Invalid resource URI: ${uri}`);
  }

  if (request.method === "tools/call") {
    const params = request.params as McpToolCallParams;
    if (params?.name === "get_quota") {
      const markdown = await getQuotaMarkdown(params.arguments?.agent);
      return ok({
        content: [{ type: "text", text: markdown }]
      });
    }
    return err(-32601, `Tool not found: ${params?.name}`);
  }

  return ok({});
}
