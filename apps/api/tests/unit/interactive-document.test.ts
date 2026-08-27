import { describe, expect, it } from 'vitest';

import {
  InteractiveDocumentError,
  parseInteractiveDocument,
  type InteractiveDocumentErrorCode,
} from '../../src/modules/classroom-generation/services/interactive-document';

const messages = [
  'SET_WIDGET_STATE',
  'HIGHLIGHT_ELEMENT',
  'ANNOTATE_ELEMENT',
  'REVEAL_ELEMENT',
].join(' ');

function documentWith(body: string) {
  return `<!DOCTYPE html><html><head><title>课堂互动</title></head><body>${body}</body></html>`;
}

function expectCode(input: string, code: InteractiveDocumentErrorCode) {
  try {
    parseInteractiveDocument(input, 'simulation');
    throw new Error('Expected interactive document parsing to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(InteractiveDocumentError);
    expect(error).toMatchObject({ code });
  }
}

describe('interactive document validation', () => {
  it.each([
    ['', 'CLASSROOM_INTERACTIVE_CONTENT_MISSING'],
    [documentWith('x'.repeat(2 * 1024 * 1024)), 'CLASSROOM_INTERACTIVE_CONTENT_TOO_LARGE'],
    ['<!DOCTYPE html><html><body><button id="control">未完成', 'CLASSROOM_INTERACTIVE_CONTENT_INCOMPLETE'],
    [
      `${documentWith('<button id="one">一</button>')}${documentWith('<button id="two">二</button>')}`,
      'CLASSROOM_INTERACTIVE_CONTENT_MULTIPLE_DOCUMENTS',
    ],
    [documentWith('<button id="control">开始</button>'), 'CLASSROOM_INTERACTIVE_CONTENT_CONFIG_MISSING'],
    [
      documentWith('<button id="control">开始</button><script id="widget-config" type="application/json">{}</script><script id="widget-config" type="application/json">{}</script>'),
      'CLASSROOM_INTERACTIVE_CONTENT_CONFIG_DUPLICATE',
    ],
    [
      documentWith('<button id="control">开始</button><script id="widget-config" type="application/json">{broken}</script>'),
      'CLASSROOM_INTERACTIVE_CONTENT_CONFIG_INVALID',
    ],
    [
      documentWith('<button id="control">开始</button><script id="widget-config" type="application/json">{"type":"game"}</script>'),
      'CLASSROOM_INTERACTIVE_CONTENT_TYPE_MISMATCH',
    ],
    [
      documentWith('<button id="control">开始</button><script id="widget-config" type="application/json">{"type":"simulation"}</script>'),
      'CLASSROOM_INTERACTIVE_CONTENT_PROTOCOL_INCOMPLETE',
    ],
    [
      documentWith(`<p>没有稳定选择器</p><script id="widget-config" type="application/json">{"type":"simulation"}</script><script>${messages}</script>`),
      'CLASSROOM_INTERACTIVE_CONTENT_SELECTORS_MISSING',
    ],
  ] as const)('reports a stable code for invalid provider output', (input, code) => {
    expectCode(input, code);
  });

  it('accepts a complete document with the widget protocol and stable selectors', () => {
    const result = parseInteractiveDocument(documentWith(
      `<button id="control">开始</button><script id="widget-config" type="application/json">{"type":"simulation"}</script><script>${messages}</script>`,
    ), 'simulation');

    expect(result).toMatchObject({ type: 'interactive', widgetType: 'simulation', url: '' });
  });
});
