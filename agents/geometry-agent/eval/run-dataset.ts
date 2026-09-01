import { readFile, writeFile, unlink } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

import { solveGeometryProblem } from "../src/agent";
import { loadProblemImages } from "../src/image-input";
import { createGeometryModelClientFromEnv } from "../src/model";
import { createRunArtifactStore } from "../src/artifact-store";

type DatasetItem = { text: string; img_path?: string[] };
type EvaluationCase = {
  id: string;
  index: number;
  text: string;
  imageFile?: string;
  status: "completed" | "failed";
  stage1?: unknown;
  artifact?: unknown;
  error?: string;
};

const packageRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");
const datasetPath = resolve(packageRoot, "fixtures/evaluation/dataset.json");
const outputPath = resolve(packageRoot, "showcase/evaluation-results.json");
const runsRoot = resolve(packageRoot, "runs");
const dataset = JSON.parse(await readFile(datasetPath, "utf8")) as DatasetItem[];
const requestedLimit = Number.parseInt(process.env.GEOMETRY_AGENT_EVAL_LIMIT ?? "", 10);
const requestedImages = new Set((process.env.GEOMETRY_AGENT_EVAL_IMAGES ?? "").split(",").map((value) => value.trim()).filter(Boolean).map((value) => basename(value)));
const selectedDataset = requestedImages.size > 0
  ? dataset.filter((item) => (item.img_path ?? []).some((image) => requestedImages.has(basename(image.replaceAll("\\", "/")))))
  : dataset;
const items = Number.isFinite(requestedLimit) && requestedLimit > 0 ? selectedDataset.slice(0, requestedLimit) : selectedDataset;

function imagePath(relativePath: string): string {
  return resolve(packageRoot, "fixtures/evaluation", relativePath.replaceAll("\\", "/"));
}

function modelEnv(): Record<string, string | undefined> {
  return {
    ...process.env,
    GEOMETRY_AGENT_API_KEY: process.env.GEOMETRY_AGENT_API_KEY ?? process.env.OPENAI_API_KEY,
    GEOMETRY_AGENT_BASE_URL: process.env.GEOMETRY_AGENT_BASE_URL ?? process.env.OPENAI_BASE_URL,
    GEOMETRY_AGENT_MODEL: process.env.GEOMETRY_AGENT_MODEL ?? process.env.DEFAULT_MODEL,
  };
}

const client = createGeometryModelClientFromEnv(modelEnv());
const existingCases = process.env.GEOMETRY_AGENT_EVAL_APPEND === "1"
  ? ((JSON.parse(await readFile(outputPath, "utf8")) as { cases?: EvaluationCase[] }).cases ?? [])
  : [];
const cases: EvaluationCase[] = [...existingCases];

for (const [index, item] of items.entries()) {
  const imageFiles = (item.img_path ?? []).map(imagePath);
  const imageFile = imageFiles[0] ? basename(imageFiles[0]) : undefined;
  process.stdout.write(`[${index + 1}/${items.length}] ${imageFile ?? "text-only"} ... `);
  let store: Awaited<ReturnType<typeof createRunArtifactStore>> | undefined;
  try {
    const images = await loadProblemImages(imageFiles);
    const runStore = await createRunArtifactStore(runsRoot, `evaluation-${index + 1}-${imageFile?.replace(/\.png$/i, "") ?? "text-only"}`);
    store = runStore;
    await runStore.writeInput({ problem: item.text, images: images.map((image) => image.metadata) });
    const result = await solveGeometryProblem({
      problem: item.text,
      images: images.map((image) => image.content),
      modelClient: client,
      sessionId: `evaluation-${index + 1}`,
      onStage1: (facts) => runStore.writeStage1(facts),
      onScene: (scene) => runStore.writeScene(scene),
      onGeoGebra: (script) => runStore.writeGeoGebra(script),
      onTimeline: (timeline) => runStore.writeTimeline(timeline),
    });
    await runStore.writeArtifact(result.artifact);
    // A fixed evaluation run id is intentionally reused for the showcase;
    // clear a stale failure marker left by an earlier failed attempt.
    try { await unlink(resolve(runStore.runDirectory, "failure.json")); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const record = {
      id: `evaluation-${index + 1}`,
      index,
      text: item.text,
      imageFile,
      status: "completed",
      stage1: result.stage1,
      artifact: result.artifact,
    } satisfies EvaluationCase;
    const previousIndex = cases.findIndex((candidate) => candidate.imageFile === imageFile);
    if (previousIndex >= 0) cases[previousIndex] = record;
    else cases.push(record);
    process.stdout.write("completed\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store?.writeFailure(error);
    const record: EvaluationCase = { id: `evaluation-${index + 1}`, index, text: item.text, imageFile, status: "failed", error: message };
    const previousIndex = cases.findIndex((candidate) => candidate.imageFile === imageFile);
    if (previousIndex >= 0) cases[previousIndex] = record;
    else cases.push(record);
    process.stdout.write(`failed: ${message}\n`);
  }
}

await writeFile(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), cases }, null, 2)}\n`, "utf8");
process.stdout.write(`Wrote ${cases.length} cases to ${outputPath}\n`);
