import { Type, type Static } from 'typebox';
import type { RuntimeTool } from '@chalk/agent-runtime';
import { createReadResourceTool, type ResourceReader } from '../../read/read-resource/tool';
import { READ_MCP_RESOURCE_PROMPT } from './prompts';

const parameters = Type.Object({
  resourceId: Type.String({ minLength: 3, maxLength: 2_048 }),
  cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 2_048 })),
  maxLines: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
  maxBytes: Type.Optional(Type.Integer({ minimum: 1_024, maximum: 32_768 })),
});
type Arguments = Static<typeof parameters>;

export function createReadMcpResourceTool(reader: ResourceReader, cursorSecret: string): RuntimeTool<typeof parameters> {
  const delegate = createReadResourceTool(reader, cursorSecret);
  return {
    name: 'read_mcp_resource',
    label: '读取 MCP 资源',
    description: READ_MCP_RESOURCE_PROMPT,
    parameters,
    source: 'mcp',
    effects: ['read', 'network'],
    // Reading a remote resource is still network access; remote metadata does
    // not grant an approval exemption.
    approvalPolicy: 'required',
    defaultEnabled: true,
    executionMode: 'sequential',
    limits: { maxResultCharacters: 12_000, maxUpdateCharacters: 2_000 },
    async execute(args: Arguments, context, signal, onUpdate) {
      return delegate.execute({
        resource: { kind: 'mcp_resource', id: args.resourceId },
        ...(args.cursor ? { cursor: args.cursor } : {}),
        ...(args.maxLines ? { maxLines: args.maxLines } : {}),
        ...(args.maxBytes ? { maxBytes: args.maxBytes } : {}),
      } as never, context, signal, onUpdate);
    },
  };
}
