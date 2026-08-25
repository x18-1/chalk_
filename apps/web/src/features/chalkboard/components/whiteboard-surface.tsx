"use client";

import { useRef, useState } from "react";
import { Eraser, Minimize2, PencilLine } from "lucide-react";

import styles from "../../../app/chalkboard/chalkboard.module.css";

export function WhiteboardSurface({ onClose }: { onClose: () => void }) {
  const [strokes, setStrokes] = useState<Array<Array<[number, number]>>>([]);
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
    setStrokes((current) => [...current, stroke]);
  };

  const continueStroke = (event: React.PointerEvent<SVGSVGElement>) => {
    if (activePointerId.current !== event.pointerId || !Array.isArray(activeStroke.current)) return;
    activeStroke.current.push(pointFromEvent(event));
    const stroke = activeStroke.current;
    setStrokes((current) => [...current.slice(0, -1), [...stroke]]);
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
    setStrokes([]);
  };

  return (
    <div className={styles.whiteboardSurface} role="dialog" aria-label="课堂白板">
      <header className={styles.whiteboardHeader}>
        <div className={styles.whiteboardTitle}><span className={styles.whiteboardMark}><PencilLine size={14} /></span><strong>课堂白板</strong><span>在课件上记录你的思路</span></div>
        <div className={styles.whiteboardActions}>
          <button type="button" aria-label="清空白板" title="清空白板" onClick={clearBoard} disabled={!strokes.length}><Eraser size={14} /></button>
          <button type="button" aria-label="关闭白板" title="关闭白板" onClick={onClose}><Minimize2 size={15} /></button>
        </div>
      </header>
      <div className={styles.whiteboardCanvas}>
        {!strokes.length ? <div className={styles.whiteboardEmpty}><span>白板已打开</span><p>拖动鼠标或触控笔，记录你的思路。</p></div> : null}
        <svg viewBox="0 0 1000 560" role="img" aria-label="可书写白板" onPointerDown={startStroke} onPointerMove={continueStroke} onPointerUp={endStroke} onPointerCancel={endStroke}>
          {strokes.map((stroke, index) => <polyline key={`stroke-${index}`} points={stroke.map(([x, y]) => `${x},${y}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />)}
        </svg>
      </div>
    </div>
  );
}
