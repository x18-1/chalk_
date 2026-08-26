/**
 * Keep OpenMAIC interactive documents at the iframe's actual viewport size.
 * The same patch is used by the full stage and the scene rail thumbnail so a
 * thumbnail is a scaled view of the real widget, not a second implementation.
 */
export function patchInteractiveHtml(html: string): string {
  const css = `<style data-chalkboard-iframe-patch>
html,body{width:100%;height:100%;margin:0;padding:0;overflow-x:hidden;overflow-y:auto;}
body{min-height:100vh;}
</style>`;
  const head = html.match(/<head[^>]*>/i);
  if (!head || head.index === undefined) return `${css}${html}`;
  const insertionPoint = head.index + head[0].length;
  return `${html.slice(0, insertionPoint)}${css}${html.slice(insertionPoint)}`;
}

export type InteractiveWidgetMessage =
  | { type: "HIGHLIGHT_ELEMENT"; target: string; content?: string }
  | { type: "SET_WIDGET_STATE"; state: Record<string, unknown>; content?: string }
  | { type: "ANNOTATE_ELEMENT"; target: string; content?: string }
  | { type: "REVEAL_ELEMENT"; target: string; content?: string };

export function postInteractiveMessage(
  frame: HTMLIFrameElement | null,
  message: InteractiveWidgetMessage,
): void {
  if (!frame?.contentWindow) return;
  const targetOrigin = frame.hasAttribute("srcdoc")
    ? "*"
    : (() => {
      try {
        return new URL(frame.src, window.location.href).origin;
      } catch {
        return window.location.origin;
      }
    })();
  frame.contentWindow.postMessage({ ...message, source: "chalkboard" }, targetOrigin);
}
