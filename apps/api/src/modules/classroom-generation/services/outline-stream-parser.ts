import { randomUUID } from 'node:crypto';

import { ApiError } from '../../../http/errors';
import {
  classroomOutlineSchema,
  sceneOutlineSchema,
  type ClassroomMediaPlanningConfig,
  type ClassroomOutline,
} from '../schemas';
import { normalizeInteractiveOutline } from './interactive-outline';

const HEAD_SCAN_LIMIT = 8_192;
export const MAX_OUTLINE_STREAM_BYTES = 512 * 1_024;
const COURSE_TITLE_RE = /"courseTitle"\s*:\s*"((?:[^"\\]|\\.)*)"/;

export type OutlineStreamEventData =
  | { type: 'languageDirective'; data: string }
  | { type: 'courseTitle'; data: string }
  | { type: 'outline'; data: ClassroomOutline['outlines'][number]; index: number };

export class OutlineStreamParser {
  private buffer = '';
  private scanFrom = 0;
  private languageDirective: string | null = null;
  private courseTitle: string | null = null;
  private readonly outlines: ClassroomOutline['outlines'] = [];
  private readonly usedOutlineIds = new Set<string>();

  constructor(private readonly media: ClassroomMediaPlanningConfig | undefined) {}

  push(chunk: string): OutlineStreamEventData[] {
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer, 'utf8') > MAX_OUTLINE_STREAM_BYTES) {
      throw new ApiError(502, 'The classroom outline stream exceeded its size limit', 'CLASSROOM_OUTLINE_INVALID');
    }

    const events: OutlineStreamEventData[] = [];
    if (!this.languageDirective) {
      this.languageDirective = extractLanguageDirective(this.buffer);
      if (this.languageDirective) {
        events.push({ type: 'languageDirective', data: this.languageDirective });
      }
    }
    if (!this.courseTitle) {
      this.courseTitle = extractCourseTitle(this.buffer, true);
      if (this.courseTitle) events.push({ type: 'courseTitle', data: this.courseTitle });
    }

    const parsed = extractNewOutlineValues(this.buffer, this.scanFrom);
    this.scanFrom = parsed.scanFrom;
    for (const value of parsed.outlines) {
      const outline = this.validateOutline(value);
      this.outlines.push(outline);
      events.push({ type: 'outline', data: outline, index: this.outlines.length - 1 });
    }
    return events;
  }

  finish(): ClassroomOutline {
    if (!this.courseTitle) this.courseTitle = extractCourseTitle(this.buffer, false);
    const parsed = classroomOutlineSchema.safeParse({
      languageDirective: this.languageDirective,
      courseTitle: this.courseTitle,
      outlines: this.outlines,
    });
    if (!parsed.success) {
      throw new ApiError(502, 'The model returned an invalid classroom outline', 'CLASSROOM_OUTLINE_INVALID');
    }
    return parsed.data;
  }

  private validateOutline(value: unknown): ClassroomOutline['outlines'][number] {
    if (value && typeof value === 'object' && !Array.isArray(value) && (value as { type?: unknown }).type === 'pbl') {
      throw new ApiError(422, 'PBL scenes are outside Chalkboard V3', 'CLASSROOM_OUTLINE_TYPE_UNSUPPORTED');
    }
    const record = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
    const candidateId = typeof record.id === 'string' && record.id.trim() && !this.usedOutlineIds.has(record.id)
      ? record.id
      : randomUUID();
    const parsed = sceneOutlineSchema.safeParse({
      ...record,
      id: candidateId,
      order: this.outlines.length + 1,
    });
    if (!parsed.success || parsed.data.type === 'pbl') {
      throw new ApiError(502, 'The model returned an invalid classroom outline', 'CLASSROOM_OUTLINE_INVALID');
    }
    const requests = parsed.data.mediaGenerations ?? [];
    if (requests.some((request) => request.type === 'image' ? !this.media?.image : !this.media?.video)) {
      throw new ApiError(502, 'The model returned an invalid classroom outline', 'CLASSROOM_OUTLINE_INVALID');
    }
    this.usedOutlineIds.add(candidateId);
    return normalizeInteractiveOutline(parsed.data);
  }
}

function extractLanguageDirective(buffer: string) {
  const head = buffer.length > HEAD_SCAN_LIMIT ? buffer.slice(0, HEAD_SCAN_LIMIT) : buffer;
  const match = head.match(/"languageDirective"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  return match ? decodeJsonString(match[1]!) : null;
}

function extractCourseTitle(buffer: string, headOnly: boolean) {
  const source = headOnly && buffer.length > HEAD_SCAN_LIMIT ? buffer.slice(0, HEAD_SCAN_LIMIT) : buffer;
  const match = source.match(COURSE_TITLE_RE);
  if (!match) return null;
  const title = decodeJsonString(match[1]!).trim();
  return title ? title.slice(0, 120) : null;
}

function decodeJsonString(raw: string) {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw;
  }
}

export function extractNewOutlineValues(
  buffer: string,
  scanFrom: number,
): { outlines: unknown[]; scanFrom: number } {
  const outlines: unknown[] = [];
  let index: number;
  if (scanFrom > 0) {
    index = scanFrom;
  } else {
    const outlinesKeyIndex = buffer.indexOf('"outlines"');
    const arrayStart = outlinesKeyIndex >= 0
      ? buffer.indexOf('[', outlinesKeyIndex)
      : buffer.indexOf('[');
    if (arrayStart === -1) return { outlines, scanFrom: 0 };
    index = arrayStart + 1;
  }

  let depth = 0;
  let objectStart = -1;
  let inString = false;
  let escaped = false;
  let consumed = index;
  for (; index < buffer.length; index += 1) {
    const character = buffer[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (character === '{') {
      if (depth === 0) objectStart = index;
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0 && objectStart >= 0) {
        try {
          outlines.push(JSON.parse(buffer.substring(objectStart, index + 1)));
        } catch {
          // A syntactically invalid complete object is ignored and the final
          // classroom contract rejects an empty/invalid outline collection.
        }
        objectStart = -1;
        consumed = index + 1;
      }
    }
  }
  return { outlines, scanFrom: consumed };
}
