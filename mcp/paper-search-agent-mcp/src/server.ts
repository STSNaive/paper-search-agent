#!/usr/bin/env node
/**
 * paper-search-agent MCP server entry point.
 *
 * Reads config.toml, registers tools based on enabled sources,
 * and starts the MCP server over stdio transport.
 */

import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadConfig, enabledDiscoverySources, enabledRetrievalRoutes } from "./config.js";
import { getToolDefinitions, handleToolCall } from "./tools/index.js";

async function main() {
  const config = loadConfig();

  const server = new Server(
    { name: "paper-search-agent-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  const enabledSources = enabledDiscoverySources(config);
  const enabledRoutes = enabledRetrievalRoutes(config);

  // List available tools based on config
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = getToolDefinitions(config);
    return { tools };
  });

  // Dispatch tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return handleToolCall(name, args ?? {}, config);
  });

  // Start server on stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error(
    `paper-search-agent-mcp started | ` +
    `discovery: [${enabledSources.join(", ")}] | ` +
    `retrieval: [${enabledRoutes.join(", ")}]`
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
