const MAX_INTERACTIVE_HTML_BYTES = 2 * 1024 * 1024;
const REQUIRED_WIDGET_MESSAGES = [
  'SET_WIDGET_STATE',
  'HIGHLIGHT_ELEMENT',
  'ANNOTATE_ELEMENT',
  'REVEAL_ELEMENT',
] as const;

export const INTERACTIVE_WIDGET_TYPES = [
  'simulation',
  'diagram',
  'code',
  'game',
  'visualization3d',
] as const;

export type InteractiveWidgetType = typeof INTERACTIVE_WIDGET_TYPES[number];

export type InteractiveDocumentErrorCode =
  | 'CLASSROOM_INTERACTIVE_CONTENT_MISSING'
  | 'CLASSROOM_INTERACTIVE_CONTENT_TOO_LARGE'
  | 'CLASSROOM_INTERACTIVE_CONTENT_INCOMPLETE'
  | 'CLASSROOM_INTERACTIVE_CONTENT_MULTIPLE_DOCUMENTS'
  | 'CLASSROOM_INTERACTIVE_CONTENT_CONFIG_MISSING'
  | 'CLASSROOM_INTERACTIVE_CONTENT_CONFIG_DUPLICATE'
  | 'CLASSROOM_INTERACTIVE_CONTENT_CONFIG_INVALID'
  | 'CLASSROOM_INTERACTIVE_CONTENT_TYPE_MISMATCH'
  | 'CLASSROOM_INTERACTIVE_CONTENT_PROTOCOL_INCOMPLETE'
  | 'CLASSROOM_INTERACTIVE_CONTENT_SELECTORS_MISSING';

export class InteractiveDocumentError extends Error {
  readonly name = 'InteractiveDocumentError';

  constructor(readonly code: InteractiveDocumentErrorCode) {
    super(code);
  }
}

export type InteractiveContent = {
  type: 'interactive';
  url: '';
  html: string;
  widgetType: InteractiveWidgetType;
  widgetConfig: Record<string, unknown>;
};

export function parseInteractiveDocument(text: string, expectedWidgetType: InteractiveWidgetType): InteractiveContent {
  const extracted = extractHtml(text);
  if (!extracted) throw new InteractiveDocumentError('CLASSROOM_INTERACTIVE_CONTENT_MISSING');
  if (Buffer.byteLength(extracted, 'utf8') > MAX_INTERACTIVE_HTML_BYTES) {
    throw new InteractiveDocumentError('CLASSROOM_INTERACTIVE_CONTENT_TOO_LARGE');
  }
  if (!/^\s*(?:<!doctype\s+html[^>]*>\s*)?<html\b/i.test(extracted) || !/<\/html>\s*$/i.test(extracted)) {
    throw new InteractiveDocumentError('CLASSROOM_INTERACTIVE_CONTENT_INCOMPLETE');
  }
  if ((extracted.match(/<!doctype\s+html/gi)?.length ?? 0) > 1 || (extracted.match(/<html\b/gi)?.length ?? 0) !== 1) {
    throw new InteractiveDocumentError('CLASSROOM_INTERACTIVE_CONTENT_MULTIPLE_DOCUMENTS');
  }
  const configBlocks = [...extracted.matchAll(
    /<script\b(?=[^>]*\bid=["']widget-config["'])(?=[^>]*\btype=["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/gi,
  )];
  if (configBlocks.length === 0) {
    throw new InteractiveDocumentError('CLASSROOM_INTERACTIVE_CONTENT_CONFIG_MISSING');
  }
  if (configBlocks.length > 1) {
    throw new InteractiveDocumentError('CLASSROOM_INTERACTIVE_CONTENT_CONFIG_DUPLICATE');
  }

  let widgetConfig: unknown;
  try {
    widgetConfig = JSON.parse(configBlocks[0]![1]!);
  } catch {
    throw new InteractiveDocumentError('CLASSROOM_INTERACTIVE_CONTENT_CONFIG_INVALID');
  }
  if (!isRecord(widgetConfig) || widgetConfig.type !== expectedWidgetType) {
    throw new InteractiveDocumentError('CLASSROOM_INTERACTIVE_CONTENT_TYPE_MISMATCH');
  }
  if (REQUIRED_WIDGET_MESSAGES.some((message) => !extracted.includes(message))) {
    throw new InteractiveDocumentError('CLASSROOM_INTERACTIVE_CONTENT_PROTOCOL_INCOMPLETE');
  }
  const inventory = interactiveElementInventory(extracted);
  if (inventory.selectors.size === 0) {
    throw new InteractiveDocumentError('CLASSROOM_INTERACTIVE_CONTENT_SELECTORS_MISSING');
  }

  return {
    type: 'interactive',
    url: '',
    html: postProcessInteractiveHtml(extracted),
    widgetType: expectedWidgetType,
    widgetConfig,
  };
}

export function interactiveElementInventory(html: string) {
  const selectors = new Set<string>();
  const lines: string[] = [];
  let dom = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const unterminatedScript = dom.search(/<script\b/i);
  if (unterminatedScript >= 0) dom = dom.slice(0, unterminatedScript);

  const tagPattern = /<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[a-zA-Z_:][\w:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>`=]+))?)*)\s*\/?>/g;
  for (const match of dom.matchAll(tagPattern)) {
    const tag = match[1]!.toLowerCase();
    const attrs = parseAttributes(match[2] ?? '');
    const id = attrs.id;
    if (id && /^[A-Za-z][\w:.-]{0,119}$/.test(id)) {
      const selector = `#${id}`;
      selectors.add(selector);
      if (lines.length < 60) lines.push(`${selector} <${tag}>${describeElement(attrs)}`);
    }
    for (const attribute of ['data-step-id', 'data-action'] as const) {
      const value = attrs[attribute];
      if (!value || !/^[A-Za-z0-9_-]{1,120}$/.test(value)) continue;
      const selector = `[${attribute}="${value}"]`;
      selectors.add(selector);
      if (lines.length < 60) lines.push(`${selector} <${tag}>`);
    }
    for (const className of (attrs.class ?? '').split(/\s+/).filter(Boolean)) {
      if (!/^[A-Za-z_][\w-]{0,119}$/.test(className)) continue;
      selectors.add(`.${className}`);
    }
  }
  return {
    selectors,
    prompt: lines.length > 0 ? `Elements with stable selectors:\n${lines.join('\n')}` : '',
  };
}

export function hasInteractiveTarget(content: unknown, target: string) {
  if (!isRecord(content) || typeof content.html !== 'string') return false;
  return interactiveElementInventory(content.html).selectors.has(target);
}

function extractHtml(response: string) {
  const doctypeStart = response.search(/<!doctype\s+html/i);
  const htmlStart = response.search(/<html\b/i);
  const start = doctypeStart >= 0 ? doctypeStart : htmlStart;
  if (start >= 0) {
    const closing = response.toLowerCase().lastIndexOf('</html>');
    if (closing >= start) return response.slice(start, closing + 7).trim();
    return response.slice(start).trim();
  }
  const codeBlock = response.match(/```(?:html)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  return codeBlock && /^(?:<!doctype\s+html|<html\b)/i.test(codeBlock) ? codeBlock : null;
}

function postProcessInteractiveHtml(html: string) {
  const scripts: string[] = [];
  let processed = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, (script) => {
    scripts.push(script);
    return `__CHALK_SCRIPT_${scripts.length - 1}__`;
  });
  processed = processed
    .replace(/\$\$([^$]+)\$\$/g, '\\[$1\\]')
    .replace(/\$([^$\n]+?)\$/g, '\\($1\\)')
    .replace(/__CHALK_SCRIPT_(\d+)__/g, (placeholder, index) => scripts[Number(index)] ?? placeholder);
  if (/katex/i.test(processed)) return processed;

  const assets = `
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"></script>
<script>
document.addEventListener("DOMContentLoaded", function () {
  if (typeof renderMathInElement !== "function") return;
  renderMathInElement(document.body, {
    delimiters: [
      { left: "\\\\[", right: "\\\\]", display: true },
      { left: "\\\\(", right: "\\\\)", display: false },
      { left: "$$", right: "$$", display: true },
      { left: "$", right: "$", display: false }
    ],
    throwOnError: false,
    strict: false,
    trust: true
  });
});
</script>`;
  const headEnd = processed.search(/<\/head>/i);
  if (headEnd >= 0) return `${processed.slice(0, headEnd)}${assets}\n${processed.slice(headEnd)}`;
  const bodyEnd = processed.search(/<\/body>/i);
  if (bodyEnd >= 0) return `${processed.slice(0, bodyEnd)}${assets}\n${processed.slice(bodyEnd)}`;
  return `${processed}${assets}`;
}

const ATTRIBUTE_PATTERN = /([a-zA-Z_:][\w:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`=]+)))?/g;

function parseAttributes(value: string) {
  const result: Record<string, string> = {};
  for (const match of value.matchAll(ATTRIBUTE_PATTERN)) {
    const name = match[1]!.toLowerCase();
    result[name] ??= match[2] ?? match[3] ?? match[4] ?? '';
  }
  return result;
}

function describeElement(attributes: Record<string, string>) {
  const values = [
    attributes.type ? ` type=${clean(attributes.type)}` : '',
    attributes.role ? ` role=${clean(attributes.role)}` : '',
    attributes['aria-label'] ? ` aria-label="${clean(attributes['aria-label'])}"` : '',
  ];
  return values.join('');
}

function clean(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 120);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
