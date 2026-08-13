#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { solveGeometryProblem } from "./agent";
import { createRunArtifactStore } from "./artifact-store";
import { loadProblemImages } from "./image-input";
import { createGeometryModelClientFromEnv } from "./model";

type CliOptions = {
  problem?: string;
  problemFile?: string;
  images: string[];
  outputDirectory: string;
};

function usage() {
  return `Usage: pnpm cli -- [options]

Options:
  --problem <text>       Geometry problem text
  --problem-file <path>  Read problem text from a UTF-8 file
  --image <path>         Attach an image; repeat for multiple images
  --output <path>        Run artifact root (default: ./runs)
  --help                 Show this message

Environment:
  GEOMETRY_AGENT_API_KEY   Required API key
  GEOMETRY_AGENT_BASE_URL  Default: https://premium.hezubus.cc/v1
  GEOMETRY_AGENT_MODEL     Default: gpt-5.6-sol
`;
}

function takeValue(args: string[], index: number, flag: string) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function parseArgs(args: string[]): CliOptions | { help: true } {
  const options: CliOptions = { images: [], outputDirectory: resolve("runs") };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--") continue;
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument === "--problem") options.problem = takeValue(args, index++, argument);
    else if (argument === "--problem-file") options.problemFile = takeValue(args, index++, argument);
    else if (argument === "--image") options.images.push(takeValue(args, index++, argument));
    else if (argument === "--output") options.outputDirectory = resolve(takeValue(args, index++, argument));
    else throw new Error(`Unknown option: ${argument}`);
  }
  if (options.problem && options.problemFile) throw new Error("Use either --problem or --problem-file, not both");
  return options;
}

export async function runCli(
  args: string[],
  env: Record<string, string | undefined> = process.env,
) {
  const options = parseArgs(args);
  if ("help" in options) {
    process.stdout.write(usage());
    return 0;
  }

  const problem = options.problemFile
    ? await readFile(resolve(options.problemFile), "utf8")
    : options.problem ?? "";
  if (!problem.trim() && options.images.length === 0) {
    throw new Error("Provide --problem, --problem-file, or at least one --image");
  }

  const loadedImages = await loadProblemImages(options.images);
  const store = await createRunArtifactStore(options.outputDirectory);
  await store.writeInput({ problem, images: loadedImages.map((image) => image.metadata) });

  try {
    const modelClient = createGeometryModelClientFromEnv(env);
    const result = await solveGeometryProblem({
      problem,
      images: loadedImages.map((image) => image.content),
      modelClient,
      sessionId: store.runDirectory.split("/").at(-1),
      onEvent: (event) => store.appendEvent(event),
    });
    await store.writeArtifact(result.artifact);
    process.stdout.write(`${JSON.stringify({ status: "completed", runDirectory: store.runDirectory })}\n`);
    return 0;
  } catch (error) {
    await store.writeFailure(error);
    throw error;
  }
}

const isEntrypoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
