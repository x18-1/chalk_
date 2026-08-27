import { createHash } from 'node:crypto';

import {
  classroomPackageMediaReferences,
  normalizeClassroomPackageManifest,
  parseStageDocument,
  type ClassroomPackageManifest,
} from '@chalk/chalkboard';
import { fromBufferPromise } from 'yauzl';

import { ApiError } from '../../http/errors';
import type { ImportClassroomInput } from './services/classroom.service';

const MAX_ENTRIES = 256;
const MAX_MANIFEST_BYTES = 4 * 1_024 * 1_024;
const MAX_ENTRY_BYTES = 32 * 1_024 * 1_024;
const MAX_UNCOMPRESSED_BYTES = 128 * 1_024 * 1_024;

type ArchiveInput = {
  filename: string;
  contentType: string;
  body: Buffer;
};

export async function parseClassroomArchive(input: ArchiveInput): Promise<ImportClassroomInput> {
  const kind = archiveKind(input.filename);
  if (!kind) {
    throw new ApiError(
      400,
      'Only .chalk.zip and .maic.zip classroom archives are supported',
      'CLASSROOM_ARCHIVE_TYPE_UNSUPPORTED',
    );
  }
  if (!['application/zip', 'application/x-zip-compressed', 'application/octet-stream'].includes(input.contentType)) {
    throw new ApiError(400, 'Classroom archive must be a ZIP file', 'CLASSROOM_ARCHIVE_TYPE_UNSUPPORTED');
  }

  let archive;
  try {
    archive = await fromBufferPromise(input.body, {
      decodeStrings: true,
      strictFileNames: true,
      validateEntrySizes: true,
    });
  } catch {
    throw new ApiError(400, 'Classroom archive is not a valid ZIP file', 'CLASSROOM_ARCHIVE_INVALID');
  }

  if (archive.entryCount > MAX_ENTRIES) {
    throw new ApiError(400, 'Classroom archive contains too many files', 'CLASSROOM_ARCHIVE_LIMIT_EXCEEDED');
  }

  const entries = new Map<string, Buffer>();
  let uncompressedBytes = 0;
  try {
    for await (const entry of archive.eachEntry()) {
      const unixFileType = (entry.externalFileAttributes >>> 16) & 0o170000;
      const madeByUnix = (entry.versionMadeBy >>> 8) === 3;
      if (madeByUnix && unixFileType !== 0 && unixFileType !== 0o100000 && unixFileType !== 0o040000) {
        throw new ApiError(400, 'Classroom archive contains an unsupported file', 'CLASSROOM_ARCHIVE_INVALID');
      }
      if (entry.fileName.endsWith('/')) continue;
      if (entries.has(entry.fileName)) {
        throw new ApiError(400, 'Classroom archive contains duplicate paths', 'CLASSROOM_ARCHIVE_INVALID');
      }
      const entryLimit = entry.fileName === 'manifest.json' ? MAX_MANIFEST_BYTES : MAX_ENTRY_BYTES;
      uncompressedBytes += entry.uncompressedSize;
      if (entry.uncompressedSize > entryLimit || uncompressedBytes > MAX_UNCOMPRESSED_BYTES) {
        throw new ApiError(400, 'Classroom archive expands beyond the allowed size', 'CLASSROOM_ARCHIVE_LIMIT_EXCEEDED');
      }
      if (entry.isEncrypted() || !entry.canDecodeFileData()) {
        throw new ApiError(400, 'Classroom archive contains an unsupported file', 'CLASSROOM_ARCHIVE_INVALID');
      }
      entries.set(entry.fileName, await readEntry(archive, entry, entryLimit));
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'Classroom archive could not be read', 'CLASSROOM_ARCHIVE_INVALID');
  }

  const manifestBody = entries.get('manifest.json');
  if (!manifestBody) {
    throw new ApiError(400, 'Classroom archive is missing manifest.json', 'CLASSROOM_MANIFEST_MISSING');
  }

  let manifest: ClassroomPackageManifest;
  try {
    const parsed = JSON.parse(manifestBody.toString('utf8')) as unknown;
    if (!isRecord(parsed)) throw new Error('Manifest must be an object');
    manifest = parsed as ClassroomPackageManifest;
  } catch {
    throw new ApiError(400, 'Classroom manifest is not valid JSON', 'CLASSROOM_MANIFEST_INVALID');
  }
  if (kind === 'chalk' && (manifest.format !== 'chalk-classroom' || manifest.formatVersion !== 1)) {
    throw new ApiError(400, 'Unsupported Chalk classroom archive version', 'CLASSROOM_ARCHIVE_VERSION_UNSUPPORTED');
  }

  const mediaIndex = isRecord(manifest.mediaIndex) ? manifest.mediaIndex : {};
  if (Object.keys(mediaIndex).some((path) => !path.startsWith('media/'))) {
    throw new ApiError(
      400,
      'Classroom media must be stored under media/',
      'CLASSROOM_MEDIA_PATH_INVALID',
    );
  }
  const declaredPaths = new Set(['manifest.json', ...Object.keys(mediaIndex)]);
  if ([...entries.keys()].some((path) => !declaredPaths.has(path))) {
    throw new ApiError(
      400,
      'Classroom archive contains files not declared by manifest.json',
      'CLASSROOM_ARCHIVE_INVALID',
    );
  }
  if (classroomPackageMediaReferences(manifest).some((path) => !Object.hasOwn(mediaIndex, path))) {
    throw new ApiError(
      400,
      'Classroom document references media not declared by manifest.json',
      'CLASSROOM_MEDIA_UNDECLARED',
    );
  }
  const media = Object.entries(mediaIndex).map(([path, metadata]) => {
    const body = entries.get(path);
    if (!body) {
      throw new ApiError(400, `Classroom archive is missing media: ${path}`, 'CLASSROOM_MEDIA_MISSING');
    }
    const mediaMetadata = isRecord(metadata) ? metadata : {};
    return {
      path,
      contentType: typeof mediaMetadata.mimeType === 'string'
        ? mediaMetadata.mimeType
        : contentTypeFromPath(path),
      body,
    };
  });
  const document = normalizeClassroomPackageManifest(manifest, {
    mediaReference: (path) => path,
    now: 0,
  });
  delete document.format;
  delete document.formatVersion;
  delete document.exportedAt;
  delete document.appVersion;
  delete document.classroomId;
  delete document.mediaIndex;
  try {
    parseStageDocument(document);
  } catch {
    throw new ApiError(
      400,
      'Classroom manifest does not contain a valid classroom',
      'CLASSROOM_DOCUMENT_INVALID',
    );
  }
  const stage = isRecord(document.stage) ? document.stage : {};
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(document))
    .update('\0')
    .update(media
      .map((asset) => `${asset.path}\0${asset.contentType}\0${createHash('sha256').update(asset.body).digest('hex')}`)
      .sort()
      .join('\0'))
    .digest('hex');
  const archiveIdentity = stableArchiveIdentity(
    input.filename,
    manifest,
    isRecord(manifest.stage) ? manifest.stage : {},
  );
  return {
    sourceKey: `classroom-archive:${createHash('sha256').update(archiveIdentity).digest('hex')}`,
    contentFingerprint: fingerprint,
    title: typeof stage.name === 'string' ? stage.name : 'Imported Classroom',
    document,
    media,
  };
}

function stableArchiveIdentity(
  filename: string,
  manifest: ClassroomPackageManifest,
  stage: Record<string, unknown>,
) {
  if (typeof manifest.classroomId === 'string' && manifest.classroomId.trim()) {
    return `classroom-id:${manifest.classroomId.trim()}`;
  }
  if (typeof stage.id === 'string' && stage.id.trim()) return `stage-id:${stage.id.trim()}`;
  const name = typeof stage.name === 'string' && stage.name.trim() ? stage.name.trim() : 'Imported Classroom';
  const archiveName = filename.replace(/\.(chalk|maic)\.zip$/i, '').toLowerCase();
  if (typeof stage.createdAt === 'number') return `authored:${archiveName}:${stage.createdAt}:${name}`;
  return `legacy-file:${archiveName}:${name}`;
}

async function readEntry(
  archive: Awaited<ReturnType<typeof fromBufferPromise>>,
  entry: Parameters<typeof archive.openReadStreamPromise>[0],
  limit: number,
) {
  const stream = await archive.openReadStreamPromise(entry);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > limit) throw new ApiError(400, 'Classroom archive entry is too large', 'CLASSROOM_ARCHIVE_LIMIT_EXCEEDED');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function archiveKind(filename: string): 'chalk' | 'openmaic' | null {
  const normalized = filename.trim().toLowerCase();
  if (normalized.endsWith('.chalk.zip')) return 'chalk';
  if (normalized.endsWith('.maic.zip')) return 'openmaic';
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function contentTypeFromPath(path: string) {
  const extension = path.split('.').pop()?.toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'mp3') return 'audio/mpeg';
  if (extension === 'wav') return 'audio/wav';
  if (extension === 'mp4') return 'video/mp4';
  if (extension === 'html') return 'text/html';
  return 'application/octet-stream';
}
