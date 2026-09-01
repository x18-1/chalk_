import {
  type McpManager,
  type RuntimeTool,
} from '@chalk/agent-runtime';
import type { ResourceReader } from '../read/read-resource';
import { createReadMcpResourceTool } from './read-resource/tool';

export type McpToolDependencies = {
  manager: McpManager;
  resourceReader?: ResourceReader;
  cursorSecret?: string;
  /** Deferred from the product-facing v1 surface; kept for isolated fixtures. */
  enableResources?: boolean;
};

/** Compose all MCP-domain tools. Remote tools remain proxy-only in this phase. */
export function createMcpTools(dependencies: McpToolDependencies): RuntimeTool[] {
  const tools: RuntimeTool[] = [...dependencies.manager.proxyTools()];
  if (dependencies.enableResources && dependencies.resourceReader && dependencies.cursorSecret) {
    tools.push(createReadMcpResourceTool(dependencies.resourceReader, dependencies.cursorSecret));
  }
  return tools;
}
