"use client";

import { useState } from "react";
import { AlertTriangle, Eye } from "lucide-react";
import type { SceneView } from "@chalk/chalkboard";
import styles from "../../../app/chalkboard/chalkboard.module.css";
import { patchInteractiveHtml, postInteractiveMessage } from "../lib/interactive-html";

export function InteractiveScene({
  scene,
  iframeRef,
  highlightTarget,
  widgetState,
  widgetAnnotation,
  widgetRevealTarget,
}: {
  scene: SceneView;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  highlightTarget: string | null;
  widgetState: Record<string, unknown> | null;
  widgetAnnotation: { target: string; content?: string } | null;
  widgetRevealTarget: string | null;
}) {
  const [frameError, setFrameError] = useState(false);
  const html = typeof scene.content.html === "string" ? scene.content.html : "";
  const url = typeof scene.content.url === "string" && scene.content.url ? scene.content.url : undefined;
  const patchedHtml = html ? patchInteractiveHtml(html) : undefined;
  if (!html && !url) {
    return <div className={styles.sceneEmpty}><Eye size={22} /><strong>互动内容为空</strong><span>这一步没有可加载的互动课件。</span></div>;
  }
  if (frameError) {
    return <div className={styles.sceneEmpty}><AlertTriangle size={22} /><strong>互动课件加载失败</strong><span>课堂仍可继续，你可以先阅读教师讲解。</span><button type="button" onClick={() => setFrameError(false)}>重新加载</button></div>;
  }
  return (
    <div className={styles.interactiveFrameWrap}>
      <iframe
        ref={iframeRef}
        className={styles.interactiveFrame}
        src={url}
        srcDoc={patchedHtml}
        title={scene.title}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        onLoad={() => {
          setFrameError(false);
          if (highlightTarget) postInteractiveMessage(iframeRef.current, { type: "HIGHLIGHT_ELEMENT", target: highlightTarget });
          if (widgetState) postInteractiveMessage(iframeRef.current, { type: "SET_WIDGET_STATE", state: widgetState });
          if (widgetAnnotation) postInteractiveMessage(iframeRef.current, { type: "ANNOTATE_ELEMENT", ...widgetAnnotation });
          if (widgetRevealTarget) postInteractiveMessage(iframeRef.current, { type: "REVEAL_ELEMENT", target: widgetRevealTarget });
        }}
        onError={() => setFrameError(true)}
      />
    </div>
  );
}
