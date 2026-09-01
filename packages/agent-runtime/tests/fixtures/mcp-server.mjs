import { appendFileSync, writeFileSync } from "node:fs";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const exitFile = process.env.MCP_FIXTURE_EXIT_FILE;
const callFile = process.env.MCP_FIXTURE_CALL_FILE;
let exitRecorded = false;

function recordExit() {
  if (!exitFile || exitRecorded) return;
  exitRecorded = true;
  writeFileSync(exitFile, "closed", "utf8");
}

process.once("exit", recordExit);
process.once("SIGTERM", () => {
  recordExit();
  process.exit(0);
});

const server = new McpServer({ name: "chalk-mcp-fixture", version: "1.0.0" });
server.registerTool(
  "echo_math",
  {
    title: "Deterministic math echo",
    description: "Adds two integers and returns a deterministic explanation.",
    inputSchema: z.object({
      left: z.number().int(),
      right: z.number().int(),
      delayMs: z.number().int().min(0).max(60_000).optional(),
      failAfterRecord: z.boolean().optional(),
    }),
    annotations: { readOnlyHint: true },
  },
  async ({ left, right, delayMs = 0, failAfterRecord = false }, { signal }) => {
    if (delayMs > 0) {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(resolve, delayMs);
        signal.addEventListener("abort", () => {
          clearTimeout(timeout);
          reject(new Error("Fixture tool call aborted"));
        }, { once: true });
      });
    }
    if (failAfterRecord) {
      if (callFile) appendFileSync(callFile, "called\n", "utf8");
      throw new Error("Fixture call has an intentionally uncertain outcome");
    }
    return {
      content: [{ type: "text", text: `${left} + ${right} = ${left + right}` }],
      structuredContent: { sum: left + right },
    };
  },
);

server.registerResource(
  "lesson_notes",
  "chalk://fixture/lesson-notes",
  {
    title: "Lesson notes",
    description: "Deterministic text resource for integration tests.",
    mimeType: "text/plain",
  },
  async (uri) => ({
    contents: [{
      uri: uri.href,
      mimeType: "text/plain",
      text: "第一行资源内容\n第二行资源内容\n第三行资源内容\n",
    }],
  }),
);

await server.connect(new StdioServerTransport());
