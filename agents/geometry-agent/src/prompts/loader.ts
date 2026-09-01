import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { GeometryPromptId } from "../../prompts/geometry-agent/registry";

const filenames: Record<GeometryPromptId, string> = {
  "stage1.system": "stage1.system.en.md",
  "stage2.system": "stage2.system.en.md",
  "stage2.geogebra.system": "stage2.geogebra.system.en.md",
};

function candidates(filename: string): string[] {
  const moduleDirectory = new URL(".", import.meta.url);
  return [
    new URL(`../prompts/geometry-agent/${filename}`, moduleDirectory).pathname,
    new URL(`../../prompts/geometry-agent/${filename}`, moduleDirectory).pathname,
    new URL(`../../../prompts/geometry-agent/${filename}`, moduleDirectory).pathname,
    resolve("prompts/geometry-agent", filename),
  ];
}

export function loadGeometryPrompt(id: GeometryPromptId): string {
  const filename = filenames[id];
  for (const path of candidates(filename)) {
    try {
      return readFileSync(path, "utf8").replace(/\r\n/g, "\n").replace(/\n?$/, "\n");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  throw new Error(`Geometry prompt asset is missing: ${id}`);
}
