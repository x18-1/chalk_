import { writeFileSync } from "node:fs";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const exitFile = process.env.MCP_FIXTURE_EXIT_FILE;
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
    }),
    annotations: { readOnlyHint: true },
  },
  async ({ left, right, delayMs = 0 }, { signal }) => {
    if (delayMs > 0) {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(resolve, delayMs);
        signal.addEventListener("abort", () => {
          clearTimeout(timeout);
          reject(new Error("Fixture tool call aborted"));
        }, { once: true });
      });
    }
    return {
      content: [{ type: "text", text: `${left} + ${right} = ${left + right}` }],
      structuredContent: { sum: left + right },
    };
  },
);

await server.connect(new StdioServerTransport());
