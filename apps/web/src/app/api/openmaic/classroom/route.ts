import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { normalizeClassroomPackageManifest } from "@chalk/chalkboard";

const execFileAsync = promisify(execFile);
const openMaicBaseUrl = (process.env.OPENMAIC_BASE_URL ?? "http://localhost:3310").replace(/\/$/, "");
const useOpenMaicRemote = process.env.CHALKBOARD_USE_OPENMAIC_REMOTE === "true";
const localFixturePaths = [
  resolve(process.cwd(), "packages/chalkboard/tests/fixtures/openmaic-live-classroom.json"),
  resolve(process.cwd(), "../../packages/chalkboard/tests/fixtures/openmaic-live-classroom.json"),
];
const localFixtureId = "4DuyVUkWv3";
const fourierPackagePaths = [
    resolve(process.cwd(), "packages/chalkboard/傅里叶变换入门.maic.zip"),
    resolve(process.cwd(), ".worktree/chalkboard-v1/packages/chalkboard/傅里叶变换入门.maic.zip"),
    resolve(process.cwd(), "../../packages/chalkboard/傅里叶变换入门.maic.zip"),
  ];
const packagePaths: Record<string, string[]> = {
  "fourier-transform-intro": fourierPackagePaths,
  "681PbzeDfm": fourierPackagePaths,
};

export const runtime = "nodejs";

type ClassroomPayload = {
  id?: string;
  scenes?: Array<{ content?: { canvas?: { elements?: Array<{ src?: string }> } } }>;
  [key: string]: unknown;
};

async function readPackageManifest(packageId: string, origin: string) {
  const archivePaths = packagePaths[packageId];
  if (!archivePaths) return null;
  try {
    let stdout = "";
    for (const archivePath of archivePaths) {
      try {
        ({ stdout } = await execFileAsync("unzip", ["-p", archivePath, "manifest.json"], { maxBuffer: 8 * 1024 * 1024 }));
        break;
      } catch {
        // Next may run the route from the workspace root or the app root.
      }
    }
    if (!stdout) return null;
    const manifest = JSON.parse(stdout) as Record<string, unknown>;
    return normalizeClassroomPackageManifest(manifest, {
      stageId: packageId,
      mediaUrl: (mediaPath) => `${origin}/api/openmaic/classroom-package-media/${packageId}/${mediaPath}`,
    });
  } catch {
    return null;
  }
}

async function loadLocalFixture(id: string, origin: string) {
  if (id !== localFixtureId) return null;
  try {
    let raw: string | null = null;
    for (const path of localFixturePaths) {
      try {
        raw = await readFile(path, "utf8");
        break;
      } catch {
        // Next may execute the route with either the workspace or app cwd.
      }
    }
    if (!raw) return null;
    const classroom = JSON.parse(raw) as ClassroomPayload;
    if (classroom.id !== id) return null;

    // The fixture is a Chalk-owned playback asset. Keep its authored media
    // usable when OpenMAIC is offline instead of leaking a localhost:3200 URL
    // into the browser.
    for (const scene of classroom.scenes ?? []) {
      for (const element of scene.content?.canvas?.elements ?? []) {
        if (typeof element.src !== "string") continue;
        const marker = "/api/classroom-media/";
        const markerIndex = element.src.indexOf(marker);
        if (markerIndex < 0) continue;
        const mediaPath = element.src.slice(markerIndex + marker.length).split("/").slice(1).join("/");
        if (mediaPath) element.src = `${origin}/classroom-fixtures/${id}/${mediaPath}`;
      }
    }

    return classroom;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "4DuyVUkWv3";
  const target = `${openMaicBaseUrl}/api/classroom?id=${encodeURIComponent(id)}`;
  const origin = new URL(request.url).origin;

  const packagedClassroom = await readPackageManifest(id, origin);
  if (packagedClassroom) {
    return NextResponse.json({ success: true, classroom: packagedClassroom }, { headers: { "x-chalkboard-source": "package" } });
  }

  // A classroom that has been migrated into Chalk is self-contained. The
  // reference service is opt-in for refreshing or probing future classrooms.
  if (!useOpenMaicRemote) {
    const localClassroom = await loadLocalFixture(id, origin);
    if (localClassroom) {
      return NextResponse.json({ success: true, classroom: localClassroom }, { headers: { "x-chalkboard-source": "local-fixture" } });
    }
  }

  try {
    const response = await fetch(target, { cache: "no-store", signal: AbortSignal.timeout(1_500) });
    const body = await response.json().catch(() => ({ success: false, error: "Invalid classroom response" }));
    if (response.ok) return NextResponse.json(body, { status: response.status });

    const classroom = await loadLocalFixture(id, origin);
    if (classroom) return NextResponse.json({ success: true, classroom }, { headers: { "x-chalkboard-source": "local-fixture" } });
    return NextResponse.json(body, { status: response.status });
  } catch {
    const classroom = await loadLocalFixture(id, origin);
    if (classroom) return NextResponse.json({ success: true, classroom }, { headers: { "x-chalkboard-source": "local-fixture" } });
    return NextResponse.json(
      { success: false, error: "课堂数据暂时不可用，请稍后重试。" },
      { status: 502 },
    );
  }
}
