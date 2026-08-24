import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  CallToolResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { Type, type Static, type TSchema } from "typebox";

import {
  DEFAULT_TOOL_RESULT_CHARACTERS,
  DEFAULT_TOOL_TIMEOUT_MS,
  DEFAULT_TOOL_UPDATE_CHARACTERS,
  type RuntimeTool,
  type ToolSummary,
} from "../tools/tool-registry";
import { assertSafeMcpHttpUrl, createSafeMcpFetch } from "./mcp-network-policy";

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
type RemoteResource = Awaited<ReturnType<Client["listResources"]>>["resources"][number];

type Connection = {
  config: McpServerConfig;
  client?: Client;
  connectPromise?: Promise<ToolSummary[]>;
  generation: number;
  status: McpServerStatus;
  tools: RuntimeTool[];
  remoteTools: RemoteTool[];
  remoteResources: RemoteResource[];
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

  const safeFetch = createSafeMcpFetch();
  if (config.transport === "sse") {
    return new SSEClientTransport(url, {
      fetch: safeFetch,
      eventSourceInit: { fetch: safeFetch },
    });
  }
  return new StreamableHTTPClientTransport(url, { fetch: safeFetch });
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
  const readOnly = tool.approvalPolicy === "none" && tool.effects.includes("read");
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    source: tool.source,
    effects: tool.effects,
    approvalPolicy: tool.approvalPolicy,
    limits: {
      timeoutMs: tool.limits?.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS,
      maxResultCharacters: tool.limits?.maxResultCharacters ?? DEFAULT_TOOL_RESULT_CHARACTERS,
      maxUpdateCharacters: tool.limits?.maxUpdateCharacters ?? DEFAULT_TOOL_UPDATE_CHARACTERS,
    },
    defaultEnabled: tool.defaultEnabled,
    executionMode: tool.executionMode ?? "parallel",
    requiresApproval: !readOnly,
  };
}

function toRuntimeTool(
  config: McpServerConfig,
  tool: RemoteTool,
  call: (
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<CallToolResult>,
): RuntimeTool {
  const name = `mcp__${safeName(config.name)}__${safeName(tool.name)}`;
  return {
    name,
    label: tool.title ?? tool.name,
    description: tool.description ?? `Tool from MCP server ${config.name}`,
    parameters: tool.inputSchema as TSchema,
    source: "mcp",
    effects: tool.annotations?.readOnlyHint === true ? ["read", "network"] : ["write", "network"],
    approvalPolicy: tool.annotations?.readOnlyHint === true ? "none" : "required",
    defaultEnabled: true,
    requiresApproval: tool.annotations?.readOnlyHint !== true,
    executionMode: tool.annotations?.readOnlyHint === true ? "parallel" : "sequential",
    async execute(args, _context, signal) {
      const result = await call(config.id, tool.name, args as Record<string, unknown>, signal);
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

function publicRemoteResource(config: McpServerConfig, resource: RemoteResource) {
  return {
    type: "resource" as const,
    name: resource.name,
    uri: resource.uri,
    id: `${config.id}/${resource.uri}`,
    description: resource.description,
    mimeType: resource.mimeType,
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
      remoteResources: [],
      generation: 0,
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

    const connectPromise = this.openConnection(connection, signal);
    connection.connectPromise = connectPromise;
    try {
      return await connectPromise;
    } finally {
      if (connection.connectPromise === connectPromise) {
        connection.connectPromise = undefined;
      }
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
    connection.generation += 1;
    connection.connectPromise = undefined;
    connection.client = undefined;
    connection.tools = [];
    connection.remoteTools = [];
    connection.remoteResources = [];
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
    for (const connection of connections) {
      connection.generation += 1;
      connection.connectPromise = undefined;
    }
    await Promise.allSettled(
      connections.map((connection) => connection.client?.close()),
    );
  }

  async readResource(
    serverId: string,
    uri: string,
    signal?: AbortSignal,
  ): Promise<ReadResourceResult> {
    return this.withReadOnlyReconnect(serverId, signal, async (connection) => {
      if (!connection.client) {
        throw new Error(`MCP server ${connection.config.name} is not connected`);
      }
      return connection.client.readResource(
        { uri },
        {
          timeout: this.callTimeoutMs,
          ...(signal ? { signal } : {}),
        },
      );
    });
  }

  private async openConnection(connection: Connection, signal?: AbortSignal) {
    const generation = connection.generation;
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
      const transport = transportFor(connection.config);
      if (connection.config.transport !== "stdio") {
        await assertSafeMcpHttpUrl(new URL(connection.config.url!));
      }
      await client.connect(transport, requestOptions);
      const listed = client.getServerCapabilities()?.tools
        ? await this.listAllTools(client, requestOptions)
        : [];
      const listedResources = client.getServerCapabilities()?.resources
        ? await this.listAllResources(client, requestOptions)
        : [];
      if (generation !== connection.generation) {
        await client.close().catch(() => undefined);
        throw new Error(`MCP server ${connection.config.name} was closed while connecting`);
      }
      connection.client = client;
      client.onclose = () => {
        if (connection.client !== client || connection.status.state !== "connected") return;
        connection.client = undefined;
        connection.status = {
          id: connection.config.id,
          name: connection.config.name,
          state: "error",
          toolCount: connection.tools.length,
          error: "MCP connection closed unexpectedly",
        };
      };
      connection.remoteTools = listed;
      connection.remoteResources = listedResources;
      connection.tools = listed.map((tool) =>
        toRuntimeTool(connection.config, tool, (serverId, toolName, args, toolSignal) =>
          this.callTool(serverId, toolName, args, toolSignal)),
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
      connection.remoteResources = [];
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

  private async listAllTools(
    client: Client,
    options: { timeout: number; signal?: AbortSignal },
  ) {
    const tools: RemoteTool[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined, options);
      tools.push(...page.tools);
      cursor = page.nextCursor;
      if (cursor && cursors.has(cursor)) {
        throw new Error(`MCP server ${client.getServerVersion()?.name ?? 'unknown'} returned a repeated tools cursor`);
      }
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return tools;
  }

  private async listAllResources(
    client: Client,
    options: { timeout: number; signal?: AbortSignal },
  ) {
    const resources: RemoteResource[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await client.listResources(cursor ? { cursor } : undefined, options);
      resources.push(...page.resources);
      cursor = page.nextCursor;
      if (cursor && cursors.has(cursor)) {
        throw new Error(`MCP server ${client.getServerVersion()?.name ?? 'unknown'} returned a repeated resources cursor`);
      }
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return resources;
  }

  private async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<CallToolResult> {
    const connection = await this.connected(serverId, signal);
    const remote = connection.remoteTools.find((tool) => tool.name === toolName);
    if (!remote) throw new Error(`MCP tool ${toolName} was not found`);
    return this.withReadOnlyReconnect(serverId, signal, async (current) => {
      if (!current.client) throw new Error(`MCP server ${current.config.name} is not connected`);
      return (await current.client.callTool(
        { name: toolName, arguments: args },
        undefined,
        { timeout: this.callTimeoutMs, ...(signal ? { signal } : {}) },
      )) as CallToolResult;
    }, remote.annotations?.readOnlyHint === true);
  }

  private async connected(serverId: string, signal?: AbortSignal) {
    await this.connect(serverId, signal);
    const connection = this.connections.get(serverId);
    if (!connection?.client || connection.status.state !== "connected") {
      throw new Error(`MCP server ${serverId} is not connected`);
    }
    return connection;
  }

  private async withReadOnlyReconnect<T>(
    serverId: string,
    signal: AbortSignal | undefined,
    operation: (connection: Connection) => Promise<T>,
    retryReadOnly = true,
  ): Promise<T> {
    const connection = await this.connected(serverId, signal);
    try {
      return await operation(connection);
    } catch (error) {
      if (!retryReadOnly || signal?.aborted || /abort|timeout|timed out/i.test(error instanceof Error ? error.message : String(error))) {
        throw error;
      }
      await this.disconnect(serverId);
      const recovered = await this.connected(serverId, signal);
      return operation(recovered);
    }
  }

  private createProxyTool(connection: Connection): RuntimeTool<typeof proxyParameters> {
    const config = connection.config;
    return {
      name: `mcp__${safeName(config.name, 32)}__${safeName(config.id, 8)}`,
      label: `MCP · ${config.name}`,
      description:
        `按需搜索、查看并调用 ${config.name} 提供的 MCP 工具，或发现它提供的 Resource。` +
        "先用 search 查找；工具再用 describe 和 call，Resource 使用返回的 id 调用 read_resource。",
      parameters: proxyParameters,
      source: "mcp",
      effects: ["network"],
      approvalPolicy: "conditional",
      defaultEnabled: true,
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
          const resourceMatches = connection.remoteResources
            .filter((resource) => {
              if (!query) return true;
              return [resource.name, resource.uri, resource.description]
                .filter(Boolean)
                .some((value) => value!.toLowerCase().includes(query));
            })
            .slice(0, 20)
            .map((resource) => publicRemoteResource(config, resource));
          return {
            content: [{ type: "text", text: JSON.stringify([...matches, ...resourceMatches]) }],
            details: {
              serverId: config.id,
              action: "search",
              count: matches.length + resourceMatches.length,
              toolCount: matches.length,
              resourceCount: resourceMatches.length,
            },
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

        const result = await this.callTool(
          config.id,
          remote.name,
          args.arguments ?? {},
          signal,
        );
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
