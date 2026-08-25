import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { NextResponse } from "next/server";

const execFileAsync = promisify(execFile);
const fourierPackagePaths = [
    resolve(process.cwd(), "packages/chalkboard/傅里叶变换入门.maic.zip"),
    resolve(process.cwd(), ".worktree/chalkboard-v1/packages/chalkboard/傅里叶变换入门.maic.zip"),
    resolve(process.cwd(), "../../packages/chalkboard/傅里叶变换入门.maic.zip"),
  ];
const packagePaths: Record<string, string[]> = {
  "fourier-transform-intro": fourierPackagePaths,
  "681PbzeDfm": fourierPackagePaths,
};
const contentTypes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  mp4: "video/mp4",
  webm: "video/webm",
};

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ package: string; path: string[] }> },
) {
  const { package: packageId, path } = await params;
  const archivePaths = packagePaths[packageId];
  const entry = path.join("/");
  if (!archivePaths || !entry || entry.includes("..") || entry.startsWith("/")) {
    return NextResponse.json({ success: false, error: "Media asset not found" }, { status: 404 });
  }
  try {
    let stdout: Buffer = Buffer.alloc(0);
    for (const archivePath of archivePaths) {
      try {
        ({ stdout } = await execFileAsync("unzip", ["-p", archivePath, entry], { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 }));
        break;
      } catch {
        // Try the next workspace-relative candidate.
      }
    }
    if (!stdout.length) return NextResponse.json({ success: false, error: "Media asset not found" }, { status: 404 });
    const extension = entry.split(".").pop()?.toLowerCase() ?? "";
    return new NextResponse(new Uint8Array(stdout), {
      headers: {
        "content-type": contentTypes[extension] ?? "application/octet-stream",
        "cache-control": "public, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ success: false, error: "Media asset not found" }, { status: 404 });
  }
}
