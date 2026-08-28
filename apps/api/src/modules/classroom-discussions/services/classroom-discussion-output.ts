import { randomUUID } from 'node:crypto';

export type DiscussionOutputEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'action'; actionId: string; actionName: string; params: Record<string, unknown> };

export type DiscussionOutputParser = {
  push(chunk: string): DiscussionOutputEvent[];
  finish(): DiscussionOutputEvent[];
};

function projectItem(value: unknown, nextActionId: () => string): DiscussionOutputEvent | null {
  if (typeof value !== 'object' || value === null) return null;
  const item = value as Record<string, unknown>;
  if (item.type === 'text' && typeof item.content === 'string' && item.content) {
    return { type: 'text_delta', delta: item.content };
  }
  const actionName = item.name ?? item.tool_name;
  const rawParams = item.params ?? item.parameters ?? {};
  if (item.type !== 'action' || typeof actionName !== 'string' ||
    typeof rawParams !== 'object' || rawParams === null || Array.isArray(rawParams)) {
    return null;
  }
  return {
    type: 'action',
    actionId: typeof item.action_id === 'string' && item.action_id ? item.action_id : nextActionId(),
    actionName,
    params: rawParams as Record<string, unknown>,
  };
}

/** Incrementally extracts complete items from OpenMAIC's structured output
 * envelope without exposing partial JSON to the student. */
export function createDiscussionOutputParser(): DiscussionOutputParser {
  let buffer = '';
  let arrayStarted = false;
  let done = false;
  let scanIndex = 0;
  let objectStart = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  const actionBatchId = randomUUID();
  let actionSequence = 0;
  const nextActionId = () => `discussion-action-${actionBatchId}-${++actionSequence}`;

  const scan = () => {
    const events: DiscussionOutputEvent[] = [];
    if (done) return events;
    if (!arrayStarted) {
      const opening = buffer.indexOf('[');
      if (opening < 0) return events;
      arrayStarted = true;
      scanIndex = opening + 1;
    }

    for (; scanIndex < buffer.length; scanIndex += 1) {
      const character = buffer[scanIndex]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
        continue;
      }
      if (character === '{') {
        if (depth === 0) objectStart = scanIndex;
        depth += 1;
        continue;
      }
      if (character === '}' && depth > 0) {
        depth -= 1;
        if (depth !== 0 || objectStart < 0) continue;
        try {
          const event = projectItem(JSON.parse(buffer.slice(objectStart, scanIndex + 1)), nextActionId);
          if (event) events.push(event);
        } catch {
          // A malformed structured item is ignored; raw JSON is never speech.
        }
        objectStart = -1;
        continue;
      }
      if (character === ']' && depth === 0) {
        done = true;
        scanIndex += 1;
        break;
      }
    }
    return events;
  };

  return {
    push(chunk) {
      if (!done) buffer += chunk;
      return scan();
    },
    finish() {
      const events = scan();
      if (arrayStarted || done) return events;
      const text = buffer.trim();
      if (!text || /^(?:```\w*\s*)?[[{]\s*(?:[\]}{]|"?(?:type|name|params|content)"?\s*:)/u.test(text)) {
        return events;
      }
      return [...events, { type: 'text_delta', delta: text }];
    },
  };
}
