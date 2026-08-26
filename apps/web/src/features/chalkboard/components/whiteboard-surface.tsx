"use client";

import { useRef } from "react";
import { Eraser, Minimize2, PencilLine } from "lucide-react";
import type { Action } from "@chalk/chalkboard";

import styles from "../chalkboard.module.css";

export type WhiteboardStroke = Array<[number, number]>;

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

export function WhiteboardSurface({ elements, strokes, onStrokesChange, onClose }: {
  elements: readonly Action[];
  strokes: readonly WhiteboardStroke[];
  onStrokesChange: (strokes: WhiteboardStroke[]) => void;
  onClose: () => void;
}) {
  const activeStroke = useRef<Array<[number, number]> | null>(null);
  const activePointerId = useRef<number | null>(null);

  const pointFromEvent = (event: React.PointerEvent<SVGSVGElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [((event.clientX - rect.left) / rect.width) * 1000, ((event.clientY - rect.top) / rect.height) * 560];
  };

  const startStroke = (event: React.PointerEvent<SVGSVGElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerId.current = event.pointerId;
    const stroke: Array<[number, number]> = [pointFromEvent(event)];
    activeStroke.current = stroke;
    onStrokesChange([...strokes, stroke]);
  };

  const continueStroke = (event: React.PointerEvent<SVGSVGElement>) => {
    if (activePointerId.current !== event.pointerId || !Array.isArray(activeStroke.current)) return;
    activeStroke.current.push(pointFromEvent(event));
    const stroke = activeStroke.current;
    onStrokesChange([...strokes.slice(0, -1), [...stroke]]);
  };

  const endStroke = (event?: React.PointerEvent<SVGSVGElement>) => {
    if (event && activePointerId.current !== event.pointerId) return;
    if (event?.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    activePointerId.current = null;
    activeStroke.current = null;
  };

  const clearBoard = () => {
    activePointerId.current = null;
    activeStroke.current = null;
    onStrokesChange([]);
  };

  return (
    <div className={styles.whiteboardSurface} role="dialog" aria-label="课堂白板">
      <header className={styles.whiteboardHeader}>
        <div className={styles.whiteboardTitle}><span className={styles.whiteboardMark}><PencilLine size={14} /></span><strong>课堂白板</strong><span>在课件上记录你的思路</span></div>
        <div className={styles.whiteboardActions}>
          <button type="button" aria-label="清空手写内容" title="清空手写内容" onClick={clearBoard} disabled={!strokes.length}><Eraser size={14} /></button>
          <button type="button" aria-label="关闭白板" title="关闭白板" onClick={onClose}><Minimize2 size={15} /></button>
        </div>
      </header>
      <div className={styles.whiteboardCanvas}>
        {!strokes.length && !elements.length ? <div className={styles.whiteboardEmpty}><span>白板已打开</span><p>拖动鼠标或触控笔，记录你的思路。</p></div> : null}
        <svg viewBox="0 0 1000 560" role="img" aria-label="可书写白板" onPointerDown={startStroke} onPointerMove={continueStroke} onPointerUp={endStroke} onPointerCancel={endStroke}>
          {elements.filter((action) => action.type === "wb_draw_line").map((action) => <AuthoredWhiteboardElement key={action.id} action={action} />)}
          {strokes.map((stroke, index) => <polyline key={`stroke-${index}`} points={stroke.map(([x, y]) => `${x},${y}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />)}
        </svg>
        <div className={styles.whiteboardAuthoredLayer} aria-label="教师白板内容">
          {elements.filter((action) => action.type !== "wb_draw_line").map((action) => <AuthoredWhiteboardElement key={action.id} action={action} />)}
        </div>
      </div>
    </div>
  );
}
