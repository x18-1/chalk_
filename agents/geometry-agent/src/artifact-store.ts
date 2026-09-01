import { mkdir, writeFile, appendFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import type { GeometryArtifact } from "./tools";
import type { GeoGebraScript } from "./geogebra";

export type RunInputManifest = {
  problem: string;
  images: Array<{ path: string; mimeType: string; byteLength: number }>;
};

function sanitizeForLog(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeForLog);
  if (!value || typeof value !== "object") return value;

  const record = value as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (key === "data" && typeof entry === "string" && record.type === "image") {
      sanitized[key] = `[image data omitted: ${entry.length} chars]`;
    } else {
      sanitized[key] = sanitizeForLog(entry);
    }
  }
  return sanitized;
}

export type RunArtifactStore = {
  runDirectory: string;
  writeInput(input: RunInputManifest): Promise<void>;
  appendEvent(event: unknown): Promise<void>;
  writeArtifact(artifact: GeometryArtifact): Promise<void>;
  writeStage1(facts: GeometryArtifact["problemFacts"]): Promise<void>;
  writeScene(scene: GeometryArtifact["scene"]): Promise<void>;
  writeGeoGebra(script: GeoGebraScript): Promise<void>;
  writeTimeline(timeline: GeometryArtifact["lessonTimeline"]): Promise<void>;
  writeFailure(error: unknown): Promise<void>;
};

export async function createRunArtifactStore(
  runsRoot = resolve("runs"),
  runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`,
): Promise<RunArtifactStore> {
  const runDirectory = join(runsRoot, runId);
  await mkdir(runDirectory, { recursive: true });

  return {
    runDirectory,
    writeInput(input) {
      return writeFile(join(runDirectory, "input.json"), `${JSON.stringify(input, null, 2)}\n`, "utf8");
    },
    appendEvent(event) {
      return appendFile(join(runDirectory, "session.jsonl"), `${JSON.stringify(sanitizeForLog(event))}\n`, "utf8");
    },
    async writeArtifact(artifact) {
      await Promise.all([
        writeFile(join(runDirectory, "problem-facts.json"), `${JSON.stringify(artifact.problemFacts, null, 2)}\n`, "utf8"),
        writeFile(join(runDirectory, "geometry-scene.json"), `${JSON.stringify(artifact.scene, null, 2)}\n`, "utf8"),
        writeFile(join(runDirectory, "lesson-timeline.json"), `${JSON.stringify(artifact.lessonTimeline, null, 2)}\n`, "utf8"),
        writeFile(join(runDirectory, "diagnostics.json"), `${JSON.stringify(artifact.diagnostics, null, 2)}\n`, "utf8"),
        writeFile(join(runDirectory, "manim-web-scene.ts"), artifact.manimWebSource, "utf8"),
        ...(artifact.geoGebraSource ? [writeFile(join(runDirectory, "geogebra-script.txt"), `${artifact.geoGebraSource}\n`, "utf8")] : []),
      ]);
    },
    writeStage1(facts) {
      return writeFile(join(runDirectory, "stage1-problem-facts.json"), `${JSON.stringify(facts, null, 2)}\n`, "utf8");
    },
    writeScene(scene) {
      return writeFile(join(runDirectory, "stage2-geometry-scene.json"), `${JSON.stringify(scene, null, 2)}\n`, "utf8");
    },
    writeGeoGebra(script) {
      return writeFile(join(runDirectory, "stage2-geogebra.json"), `${JSON.stringify(script, null, 2)}\n`, "utf8");
    },
    writeTimeline(timeline) {
      return writeFile(join(runDirectory, "stage2-lesson-timeline.json"), `${JSON.stringify(timeline, null, 2)}\n`, "utf8");
    },
    writeFailure(error) {
      const message = error instanceof Error ? error.message : String(error);
      return writeFile(join(runDirectory, "failure.json"), `${JSON.stringify({ message }, null, 2)}\n`, "utf8");
    },
  };
}
