import { readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";

import type { ImageContent } from "@earendil-works/pi-ai";

const imageMimeTypes: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export type LoadedProblemImage = {
  content: ImageContent;
  metadata: {
    path: string;
    mimeType: string;
    byteLength: number;
  };
};

export async function loadProblemImages(paths: readonly string[]): Promise<LoadedProblemImage[]> {
  return Promise.all(paths.map(async (inputPath) => {
    const path = resolve(inputPath);
    const extension = extname(path).toLowerCase();
    const mimeType = imageMimeTypes[extension];
    if (!mimeType) throw new Error(`Unsupported image format: ${extension || "unknown"}`);

    const [data, fileStat] = await Promise.all([readFile(path), stat(path)]);
    if (!fileStat.isFile()) throw new Error(`Image path is not a file: ${path}`);
    return {
      content: { type: "image", data: data.toString("base64"), mimeType },
      metadata: { path, mimeType, byteLength: data.byteLength },
    };
  }));
}
