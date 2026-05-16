import { fetchUrlTool } from "./fetchUrl.js";
import { webSearchTool } from "./webSearch.js";

const tools = [
  fetchUrlTool,
  webSearchTool
];

const toolsByName = new Map(tools.map(tool => [tool.name, tool]));

export function listTools() {
  return tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema
  }));
}

export function getTool(name) {
  return toolsByName.get(name) || null;
}

export async function runTool(name, args = {}, env = {}) {
  const tool = getTool(name);

  if (!tool) {
    throw new Error("Unknown tool: " + name);
  }

  const result = await tool.handler(args, env);

  return {
    name: tool.name,
    args,
    result
  };
}
