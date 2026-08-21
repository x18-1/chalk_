import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { Type, type Static, type TSchema } from "typebox";

import type { RuntimeTool, ToolSummary } from "../tools/tool-registry";

export type McpServerConfig = {
  id: string;
  name: string;
  transport: "stdio" | "sse" | "http";
  command?: string;
  args?: readonly string[];
  url?: string;
  env?: Readonly<Record<string, string>>;
  enabled: boolean;
};

export type McpServerStatus = {
  id: string;
  name: string;
  state: "disconnected" | "connecting" | "connected" | "error";
  toolCount: number;
  error?: string;
  connectedAt?: number;
};

export type McpManagerOptions = {
  connectTimeoutMs?: number;
  callTimeoutMs?: number;
};

type RemoteTool = Awaited<ReturnType<Client["listTools"]>>["tools"][number];

type Connection = {
  config: McpServerConfig;
  client?: Client;
  connectPromise?: Promise<ToolSummary[]>;
  status: McpServerStatus;
  tools: RuntimeTool[];
  remoteTools: RemoteTool[];
};

const proxyParameters = Type.Object({
  action: Type.Union([
    Type.Literal("search"),
    Type.Literal("describe"),
    Type.Literal("call"),
  ]),
  query: Type.Optional(Type.String({ maxLength: 200 })),
  tool: Type.Optional(Type.String({ maxLength: 200 })),
  arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

type ProxyParameters = Static<typeof proxyParameters>;

function safeName(value: string, length = 48) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, length);
}

function transportFor(config: McpServerConfig) {
  if (config.transport === "stdio") {
    if (!config.command) {
      throw new Error(`MCP server ${config.name} requires a command`);
    }
    return new StdioClientTransport({
      command: config.command,
      args: [...(config.args ?? [])],
      ...(config.env ? { env: { ...config.env } } : {}),
      stderr: "pipe",
    });
  }

  if (!config.url) throw new Error(`MCP server ${config.name} requires a URL`);
  const url = new URL(config.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`MCP server ${config.name} must use HTTP or HTTPS`);
  }
  if (url.username || url.password) {
    throw new Error(`MCP server ${config.name} URL must not contain credentials`);
  }

  return config.transport === "sse"
    ? new SSEClientTransport(url)
    : new StreamableHTTPClientTransport(url);
}

function resultContent(
  content: CallToolResult["content"],
): Array<TextContent | ImageContent> {
  const result: Array<TextContent | ImageContent> = [];
  for (const item of content) {
    if (item.type === "text") {
      result.push({ type: "text", text: item.text });
      continue;
    }
    if (item.type === "image") {
      result.push({ type: "image", data: item.data, mimeType: item.mimeType });
      continue;
    }
    if (item.type === "resource" && "text" in item.resource) {
      result.push({ type: "text", text: item.resource.text });
      continue;
    }
    result.push({
      type: "text",
      text: `[MCP ${item.type} result omitted from model context]`,
    });
  }
  return result;
}

function toolSummary(tool: RuntimeTool): ToolSummary {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    source: tool.source,
    requiresApproval:
      typeof tool.requiresApproval === "function" ||
      tool.requiresApproval === true,
  };
}

function toRuntimeTool(
  config: McpServerConfig,
  client: Client,
  tool: RemoteTool,
  callTimeoutMs: number,
): RuntimeTool {
  const name = `mcp__${safeName(config.name)}__${safeName(tool.name)}`;
  return {
    name,
    label: tool.title ?? tool.name,
    description: tool.description ?? `Tool from MCP server ${config.name}`,
    parameters: tool.inputSchema as TSchema,
    source: "mcp",
    requiresApproval: tool.annotations?.readOnlyHint !== true,
    executionMode: "sequential",
    async execute(args, _context, signal) {
      const result = (await client.callTool(
        { name: tool.name, arguments: args as Record<string, unknown> },
        undefined,
        {
          timeout: callTimeoutMs,
          ...(signal ? { signal } : {}),
        },
      )) as CallToolResult;
      return {
        content: resultContent(result.content),
        details: {
          serverId: config.id,
          toolName: tool.name,
          structuredContent: result.structuredContent,
        },
      };
    },
  };
}

function publicRemoteTool(tool: RemoteTool) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    readOnly: tool.annotations?.readOnlyHint === true,
  };
}

export class McpManager {
  private readonly connections = new Map<string, Connection>();
  private readonly connectTimeoutMs: number;
  private readonly callTimeoutMs: number;

  constructor(
    configs: readonly McpServerConfig[] = [],
    options: McpManagerOptions = {},
  ) {
    this.connectTimeoutMs = options.connectTimeoutMs ?? 10_000;
    this.callTimeoutMs = options.callTimeoutMs ?? 30_000;
    for (const config of configs) this.register(config);
  }

  register(config: McpServerConfig) {
    if (this.connections.has(config.id)) {
      throw new Error(`MCP server ${config.id} is already registered`);
    }
    this.connections.set(config.id, {
      config,
      tools: [],
      remoteTools: [],
      status: {
        id: config.id,
        name: config.name,
        state: "disconnected",
        toolCount: 0,
      },
    });
  }

  async connect(
    configOrId: McpServerConfig | string,
    signal?: AbortSignal,
  ): Promise<ToolSummary[]> {
    if (typeof configOrId !== "string" && !this.connections.has(configOrId.id)) {
      this.register(configOrId);
    }
    const serverId =
      typeof configOrId === "string" ? configOrId : configOrId.id;
    const connection = this.connections.get(serverId);
    if (!connection) throw new Error(`MCP server ${serverId} is not registered`);
    if (!connection.config.enabled) return [];
    if (connection.status.state === "connected") {
      return connection.tools.map(toolSummary);
    }
    if (connection.connectPromise) return connection.connectPromise;

    connection.connectPromise = this.openConnection(connection, signal);
    try {
      return await connection.connectPromise;
    } finally {
      connection.connectPromise = undefined;
    }
  }

  proxyTools(): RuntimeTool[] {
    return Array.from(this.connections.values())
      .filter((connection) => connection.config.enabled)
      .map((connection) => this.createProxyTool(connection));
  }

  tools(serverIds?: ReadonlySet<string>) {
    return Array.from(this.connections.values())
      .filter(
        (connection) => !serverIds || serverIds.has(connection.config.id),
      )
      .flatMap((connection) => connection.tools);
  }

  statuses(): McpServerStatus[] {
    return Array.from(this.connections.values(), (connection) => ({
      ...connection.status,
    }));
  }

  async disconnect(serverId: string) {
    const connection = this.connections.get(serverId);
    if (!connection) return;
    const client = connection.client;
    connection.client = undefined;
    connection.tools = [];
    connection.remoteTools = [];
    connection.status = {
      id: connection.config.id,
      name: connection.config.name,
      state: "disconnected",
      toolCount: 0,
    };
    await client?.close();
  }

  async close() {
    const connections = Array.from(this.connections.values());
    this.connections.clear();
    await Promise.allSettled(
      connections.map((connection) => connection.client?.close()),
    );
  }

  private async openConnection(connection: Connection, signal?: AbortSignal) {
    connection.status = {
      id: connection.config.id,
      name: connection.config.name,
      state: "connecting",
      toolCount: 0,
    };
    const client = new Client({ name: "chalk", version: "0.0.1" });

    try {
      const requestOptions = {
        timeout: this.connectTimeoutMs,
        ...(signal ? { signal } : {}),
      };
      await client.connect(transportFor(connection.config), requestOptions);
      const listed = await client.listTools(undefined, requestOptions);
      connection.client = client;
      connection.remoteTools = listed.tools;
      connection.tools = listed.tools.map((tool) =>
        toRuntimeTool(connection.config, client, tool, this.callTimeoutMs),
      );
      connection.status = {
        id: connection.config.id,
        name: connection.config.name,
        state: "connected",
        toolCount: connection.tools.length,
        connectedAt: Date.now(),
      };
      return connection.tools.map(toolSummary);
    } catch (error) {
      connection.client = undefined;
      connection.tools = [];
      connection.remoteTools = [];
      connection.status = {
        id: connection.config.id,
        name: connection.config.name,
        state: "error",
        toolCount: 0,
        error: error instanceof Error ? error.message : String(error),
      };
      await client.close().catch(() => undefined);
      throw error;
    }
  }

  private createProxyTool(connection: Connection): RuntimeTool<typeof proxyParameters> {
    const config = connection.config;
    return {
      name: `mcp__${safeName(config.name, 32)}__${safeName(config.id, 8)}`,
      label: `MCP · ${config.name}`,
      description:
        `按需搜索、查看并调用 ${config.name} 提供的 MCP 工具。` +
        "先用 search 查找工具，再用 describe 查看参数，最后用 call 调用。",
      parameters: proxyParameters,
      source: "mcp",
      executionMode: "sequential",
      requiresApproval: async (args: ProxyParameters, _context, signal) => {
        if (args.action !== "call") return false;
        await this.connect(config.id, signal);
        const remote = connection.remoteTools.find(
          (tool) => tool.name === args.tool,
        );
        if (!remote) throw new Error(`MCP tool ${args.tool ?? ""} was not found`);
        return remote.annotations?.readOnlyHint !== true;
      },
      execute: async (args: ProxyParameters, _context, signal) => {
        await this.connect(config.id, signal);

        if (args.action === "search") {
          const query = args.query?.trim().toLowerCase() ?? "";
          const matches = connection.remoteTools
            .filter((tool) => {
              if (!query) return true;
              return [tool.name, tool.title, tool.description]
                .filter(Boolean)
                .some((value) => value!.toLowerCase().includes(query));
            })
            .slice(0, 20)
            .map(publicRemoteTool);
          return {
            content: [{ type: "text", text: JSON.stringify(matches) }],
            details: { serverId: config.id, action: "search", count: matches.length },
          };
        }

        const remote = connection.remoteTools.find(
          (tool) => tool.name === args.tool,
        );
        if (!remote) throw new Error(`MCP tool ${args.tool ?? ""} was not found`);

        if (args.action === "describe") {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ...publicRemoteTool(remote),
                  inputSchema: remote.inputSchema,
                }),
              },
            ],
            details: { serverId: config.id, action: "describe", toolName: remote.name },
          };
        }

        if (!connection.client) throw new Error(`MCP server ${config.name} is not connected`);
        const result = (await connection.client.callTool(
          { name: remote.name, arguments: args.arguments ?? {} },
          undefined,
          {
            timeout: this.callTimeoutMs,
            ...(signal ? { signal } : {}),
          },
        )) as CallToolResult;
        return {
          content: resultContent(result.content),
          details: {
            serverId: config.id,
            action: "call",
            toolName: remote.name,
            structuredContent: result.structuredContent,
          },
        };
      },
    };
  }
}
