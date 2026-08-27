"use client";

import { Minimize2, Presentation } from "lucide-react";
import type { Action } from "@chalk/chalkboard";

import styles from "../chalkboard.module.css";

function actionPosition(action: Action): React.CSSProperties {
  const x = typeof action.x === "number" ? action.x : 40;
  const y = typeof action.y === "number" ? action.y : 40;
  const width = typeof action.width === "number" ? action.width : 260;
  const height = typeof action.height === "number" ? action.height : 100;
  return { left: `${x / 10}%`, top: `${y / 5.6}%`, width: `${width / 10}%`, minHeight: `${height / 5.6}%` };
}

function AuthoredWhiteboardElement({ action }: { action: Action }) {
  if (action.type === "wb_draw_line") {
    return <line x1={Number(action.startX)} y1={Number(action.startY)} x2={Number(action.endX)} y2={Number(action.endY)} stroke={typeof action.color === "string" ? action.color : "currentColor"} strokeWidth={typeof action.strokeWidth === "number" ? action.strokeWidth : 4} strokeLinecap="round" />;
  }
  const text = action.type === "wb_draw_text" ? String(action.content)
    : action.type === "wb_draw_latex" ? String(action.latex)
      : action.type === "wb_draw_code" ? String(action.code)
        : action.type === "wb_draw_table" ? (action.data as unknown[][]).map((row) => row.join("  ·  ")).join("\n")
          : action.type === "wb_draw_chart" ? JSON.stringify(action.data)
            : String(action.label ?? action.shape ?? "");
  return <div className={styles.whiteboardAuthoredElement} data-whiteboard-type={action.type} style={actionPosition(action)}>{text}</div>;
}

export function WhiteboardSurface({ elements, onClose }: {
  elements: readonly Action[];
  onClose: () => void;
}) {
  return (
    <div className={styles.whiteboardSurface} role="dialog" aria-label="教师白板">
      <header className={styles.whiteboardHeader}>
        <div className={styles.whiteboardTitle}><span className={styles.whiteboardMark}><Presentation size={14} /></span><strong>教师白板</strong><span>跟随课堂步骤展示</span></div>
        <div className={styles.whiteboardActions}>
          <button type="button" aria-label="关闭白板" title="关闭白板" onClick={onClose}><Minimize2 size={15} /></button>
        </div>
      </header>
      <div className={styles.whiteboardCanvas}>
        {!elements.length ? <div className={styles.whiteboardEmpty}><span>白板已打开</span><p>老师正在准备白板内容。</p></div> : null}
        <svg viewBox="0 0 1000 560" role="img" aria-label="教师白板图示">
          {elements.filter((action) => action.type === "wb_draw_line").map((action) => <AuthoredWhiteboardElement key={action.id} action={action} />)}
        </svg>
        <div className={styles.whiteboardAuthoredLayer} aria-label="教师白板内容">
          {elements.filter((action) => action.type !== "wb_draw_line").map((action) => <AuthoredWhiteboardElement key={action.id} action={action} />)}
        </div>
      </div>
    </div>
  );
}
