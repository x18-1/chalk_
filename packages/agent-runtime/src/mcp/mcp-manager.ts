import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type {
  CallToolResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { TextContent } from "@earendil-works/pi-ai";
import { Type, type Static, type TSchema } from "typebox";

import {
  DEFAULT_TOOL_RESULT_CHARACTERS,
  DEFAULT_TOOL_TIMEOUT_MS,
  DEFAULT_TOOL_UPDATE_CHARACTERS,
  ToolExecutionError,
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
  /** Optional HTTP headers (for example an owner-scoped bearer token). */
  headers?: Readonly<Record<string, string>>;
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
  /** MCP Resources are deferred from the product-facing v1 surface. */
  enableResources?: boolean;
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

const MAX_STRUCTURED_CONTENT = 32_000;
const MAX_REMOTE_RESULT_TEXT = 32_000;
const MAX_REMOTE_DESCRIPTION = 2_000;
const MAX_REMOTE_SCHEMA = 32_000;
const MAX_DISCOVERY_PAGES = 10;
const MAX_DISCOVERED_TOOLS = 200;
const MAX_DISCOVERED_RESOURCES = 200;

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
  if (url.protocol !== "https:") {
    throw new Error(`MCP server ${config.name} must use HTTPS`);
  }
  if (url.username || url.password) {
    throw new Error(`MCP server ${config.name} URL must not contain credentials`);
  }

  const safeFetch = createSafeMcpFetch();
  if (config.transport === "sse") {
    return new SSEClientTransport(url, {
      fetch: safeFetch,
      ...(config.headers ? { requestInit: { headers: { ...config.headers } } } : {}),
      eventSourceInit: {
        fetch: safeFetch,
        ...(config.headers ? { headers: { ...config.headers } } : {}),
      },
    });
  }
  return new StreamableHTTPClientTransport(url, {
    fetch: safeFetch,
    ...(config.headers ? { requestInit: { headers: { ...config.headers } } } : {}),
  });
}

function resultContent(
  content: CallToolResult["content"],
): TextContent[] {
  const result: TextContent[] = [];
  let remaining = MAX_REMOTE_RESULT_TEXT;
  const append = (text: string) => {
    if (remaining <= 0) return;
    if (text.length <= remaining) {
      result.push({ type: "text", text });
      remaining -= text.length;
      return;
    }
    const marker = "\n[MCP text truncated]".slice(0, remaining);
    const prefixLength = Math.max(0, remaining - marker.length);
    result.push({ type: "text", text: text.slice(0, prefixLength) + marker });
    remaining = 0;
  };
  for (const item of content) {
    if (item.type === "text") {
      append(item.text);
      continue;
    }
    if (item.type === "image") {
      append("[MCP image omitted from the v1 result surface]");
      continue;
    }
    if (item.type === "resource" && "text" in item.resource) {
      append(item.resource.text);
      continue;
    }
    append(`[MCP ${item.type} result omitted from model context]`);
  }
  return result;
}

function boundedStructuredContent(value: unknown) {
  if (value === undefined) return undefined;
  let encoded: string;
  try { encoded = JSON.stringify(value); } catch { return { omitted: true, reason: "unserializable" }; }
  if (encoded.length <= MAX_STRUCTURED_CONTENT) return value;
  return { omitted: true, reason: "result_too_large", originalCharacters: encoded.length };
}

function boundedRemoteText(value: string | undefined) {
  if (value === undefined || value.length <= MAX_REMOTE_DESCRIPTION) return value;
  return `${value.slice(0, MAX_REMOTE_DESCRIPTION)}\n[MCP metadata truncated]`;
}

function assertBoundedSchema(tool: RemoteTool) {
  let encoded: string;
  try {
    encoded = JSON.stringify(tool.inputSchema);
  } catch (error) {
    throw new Error(`MCP tool ${tool.name} returned an invalid input schema`, { cause: error });
  }
  if (!tool.name || tool.name.length > 200 || encoded.length > MAX_REMOTE_SCHEMA) {
    throw new Error(`MCP tool ${tool.name || "<unnamed>"} exceeds the discovery limits`);
  }
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
    executionMode: tool.executionMode ?? "sequential",
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
    label: boundedRemoteText(tool.title) ?? tool.name,
    description: boundedRemoteText(tool.description) ?? `Tool from MCP server ${config.name}`,
    parameters: tool.inputSchema as TSchema,
    source: "mcp",
    // A remote readOnlyHint is display metadata only. It cannot narrow the
    // local capability classification or influence approval/execution rules.
    effects: ["read", "write", "network"],
    approvalPolicy: "required",
    defaultEnabled: true,
    requiresApproval: true,
    executionMode: "sequential",
    async execute(args, _context, signal) {
      const result = await call(config.id, tool.name, args as Record<string, unknown>, signal);
      return {
        content: resultContent(result.content),
        details: {
          serverId: config.id,
          toolName: tool.name,
          structuredContent: boundedStructuredContent(result.structuredContent),
        },
      };
    },
  };
}

function publicRemoteTool(tool: RemoteTool) {
  return {
    name: tool.name,
    title: boundedRemoteText(tool.title),
    description: boundedRemoteText(tool.description),
    readOnly: tool.annotations?.readOnlyHint === true,
  };
}

function publicRemoteResource(config: McpServerConfig, resource: RemoteResource) {
  return {
    type: "resource" as const,
    name: boundedRemoteText(resource.name),
    uri: resource.uri,
    id: `${config.id}/${resource.uri}`,
    description: boundedRemoteText(resource.description),
    mimeType: resource.mimeType,
  };
}

export class McpManager {
  private readonly connections = new Map<string, Connection>();
  private readonly connectTimeoutMs: number;
  private readonly callTimeoutMs: number;
  private readonly enableResources: boolean;

  constructor(
    configs: readonly McpServerConfig[] = [],
    options: McpManagerOptions = {},
  ) {
    this.connectTimeoutMs = options.connectTimeoutMs ?? 10_000;
    this.callTimeoutMs = options.callTimeoutMs ?? 30_000;
    this.enableResources = options.enableResources ?? false;
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
    return this.withResourceReconnect(serverId, signal, async (connection) => {
      if (!connection.client) {
        throw new Error(`MCP server ${connection.config.name} is not connected`);
      }
      if (!connection.remoteResources.some((resource) => resource.uri === uri)) {
        throw new ToolExecutionError(
          "read_access_denied",
          `MCP resource ${uri} was not discovered for server ${connection.config.name}`,
        );
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
      const listedResources = this.enableResources && client.getServerCapabilities()?.resources
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
    let pageCount = 0;
    do {
      pageCount += 1;
      if (pageCount > MAX_DISCOVERY_PAGES) {
        throw new Error(`MCP tools discovery exceeded ${MAX_DISCOVERY_PAGES} pages`);
      }
      const page = await client.listTools(cursor ? { cursor } : undefined, options);
      if (tools.length + page.tools.length > MAX_DISCOVERED_TOOLS) {
        throw new Error(`MCP tools discovery exceeded ${MAX_DISCOVERED_TOOLS} tools`);
      }
      for (const tool of page.tools) assertBoundedSchema(tool);
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
    let pageCount = 0;
    do {
      pageCount += 1;
      if (pageCount > MAX_DISCOVERY_PAGES) {
        throw new Error(`MCP resources discovery exceeded ${MAX_DISCOVERY_PAGES} pages`);
      }
      const page = await client.listResources(cursor ? { cursor } : undefined, options);
      if (resources.length + page.resources.length > MAX_DISCOVERED_RESOURCES) {
        throw new Error(`MCP resources discovery exceeded ${MAX_DISCOVERED_RESOURCES} resources`);
      }
      if (page.resources.some((resource) => !resource.uri || resource.uri.length > 2_048)) {
        throw new Error("MCP resource metadata exceeds the discovery limits");
      }
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
    if (!connection.client) throw new Error(`MCP server ${connection.config.name} is not connected`);
    // A remote readOnlyHint is untrusted and cannot make an uncertain call safe
    // to retry. Each approved MCP Tool call is sent at most once.
    const result = (await connection.client.callTool(
      { name: toolName, arguments: args },
      undefined,
      { timeout: this.callTimeoutMs, ...(signal ? { signal } : {}) },
    )) as CallToolResult;
    if (result.isError) {
      throw new ToolExecutionError(
        "execution_failed",
        `MCP tool ${toolName} reported a failure`,
      );
    }
    return result;
  }

  private async connected(serverId: string, signal?: AbortSignal) {
    await this.connect(serverId, signal);
    const connection = this.connections.get(serverId);
    if (!connection?.client || connection.status.state !== "connected") {
      throw new Error(`MCP server ${serverId} is not connected`);
    }
    return connection;
  }

  private async withResourceReconnect<T>(
    serverId: string,
    signal: AbortSignal | undefined,
    operation: (connection: Connection) => Promise<T>,
  ): Promise<T> {
    const connection = await this.connected(serverId, signal);
    try {
      return await operation(connection);
    } catch (error) {
      if (signal?.aborted || /abort|timeout|timed out/i.test(error instanceof Error ? error.message : String(error))) {
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
        `按需搜索、查看并调用 ${config.name} 提供的 MCP 工具。` +
        "先用 search 查找，再用 describe 查看参数，最后仅在需要时使用 call。",
      parameters: proxyParameters,
      source: "mcp",
      effects: ["read", "write", "network"],
      approvalPolicy: "conditional",
      defaultEnabled: true,
      executionMode: "sequential",
      // Approval predicates must be local and side-effect free. Discovery is
      // covered by the user's enabled server grant; every remote call asks.
      requiresApproval: (args: ProxyParameters) => args.action === "call",
      execute: async (args: ProxyParameters, _context, signal) => {
        if ((args.action === "describe" || args.action === "call") && !args.tool?.trim()) {
          throw new ToolExecutionError("invalid_arguments", `${args.action} requires a tool name`);
        }
        if (args.action === "call" && args.arguments !== undefined &&
          (!args.arguments || typeof args.arguments !== "object" || Array.isArray(args.arguments))) {
          throw new ToolExecutionError("invalid_arguments", "MCP call arguments must be an object");
        }
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
                  inputSchema: boundedStructuredContent(remote.inputSchema),
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
            structuredContent: boundedStructuredContent(result.structuredContent),
          },
        };
      },
    };
  }
}
