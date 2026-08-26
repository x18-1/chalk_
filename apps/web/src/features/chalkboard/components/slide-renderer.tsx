"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CanvasElement, SceneView } from "@chalk/chalkboard";
import styles from "../chalkboard.module.css";
import { sanitizeClassroomMarkup } from "../lib/safe-html";

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function textFromMarkup(value: string): string {
  return value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function canvasElements(scene: SceneView): CanvasElement[] {
  const canvas = asRecord(scene.content.canvas);
  return Array.isArray(canvas.elements) ? canvas.elements as CanvasElement[] : [];
}

function linePath(element: CanvasElement): string {
  const start = element.start ?? [0, 0];
  const end = element.end ?? [100, 100];
  const startText = start.join(",");
  const endText = end.join(",");
  if (element.broken) return `M${startText} L${element.broken.join(",")} L${endText}`;
  if (element.broken2) {
    const horizontal = Math.abs(end[0] - start[0]) >= Math.abs(end[1] - start[1]);
    if (horizontal) return `M${startText} L${element.broken2[0]},${start[1]} L${element.broken2[0]},${end[1]} L${endText}`;
    return `M${startText} L${start[0]},${element.broken2[1]} L${end[0]},${element.broken2[1]} L${endText}`;
  }
  if (element.curve) return `M${startText} Q${element.curve.join(",")} ${endText}`;
  if (element.cubic) return `M${startText} C${element.cubic[0].join(",")} ${element.cubic[1].join(",")} ${endText}`;
  return `M${startText} L${endText}`;
}

function lineBounds(element: CanvasElement) {
  const points: Array<[number, number]> = [element.start ?? [0, 0], element.end ?? [100, 100]];
  if (element.broken) points.push(element.broken);
  if (element.broken2) points.push(element.broken2);
  if (element.curve) points.push(element.curve);
  if (element.cubic) points.push(...element.cubic);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { minX, minY, width: Math.max(24, Math.max(...xs) - minX), height: Math.max(24, Math.max(...ys) - minY) };
}

function lineDashArray(element: CanvasElement): string {
  const size = Math.max(1, element.width ?? 1);
  if (element.style === "dashed") return size <= 8 ? `${size * 5} ${size * 2.5}` : `${size * 5} ${size * 1.5}`;
  if (element.style === "dotted") return size <= 8 ? `${size * 1.8} ${size * 1.6}` : `${size * 1.5} ${size * 1.2}`;
  return "0 0";
}

function tableCell(value: unknown): { text: string; style: Record<string, string>; colSpan: number; rowSpan: number } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { text: String(value ?? ""), style: {}, colSpan: 1, rowSpan: 1 };
  }
  const cell = value as { text?: unknown; colspan?: unknown; rowspan?: unknown; style?: { bold?: boolean; backcolor?: string; color?: string; align?: string; fontsize?: number } };
  const cellStyle = cell.style ?? {};
  return {
    text: typeof cell.text === "string" ? cell.text : String(cell.text ?? ""),
    style: {
      ...(cellStyle.bold ? { fontWeight: "700" } : {}),
      ...(typeof cellStyle.backcolor === "string" ? { backgroundColor: cellStyle.backcolor } : {}),
      ...(typeof cellStyle.color === "string" ? { color: cellStyle.color } : {}),
      ...(typeof cellStyle.align === "string" ? { textAlign: cellStyle.align as "left" | "center" | "right" } : {}),
      ...(typeof cellStyle.fontsize === "number" ? { fontSize: `${cellStyle.fontsize}px` } : {}),
    },
    colSpan: typeof cell.colspan === "number" ? cell.colspan : 1,
    rowSpan: typeof cell.rowspan === "number" ? cell.rowspan : 1,
  };
}

function LatexCanvasElement({
  element,
  style,
  commonClass,
}: {
  element: CanvasElement;
  style: React.CSSProperties;
  commonClass: string;
}) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [contentScale, setContentScale] = useState(1);
  const width = element.width ?? 40;
  const height = element.height ?? 30;
  const markup = element.html ?? element.latex ?? "";
  const safeMarkup = useMemo(() => sanitizeClassroomMarkup(markup), [markup]);
  const align = element.align === "left" ? "flex-start" : element.align === "right" ? "flex-end" : "center";
  const transformOrigin = element.align === "left" ? "left center" : element.align === "right" ? "right center" : "center center";

  useLayoutEffect(() => {
    const node = innerRef.current;
    if (!node) return;
    const naturalWidth = node.scrollWidth;
    const naturalHeight = node.scrollHeight;
    if (naturalWidth > 0 && naturalHeight > 0) {
      setContentScale(Math.min(1, width / naturalWidth, height / naturalHeight));
    }
  }, [height, markup, width]);

  return (
    <div className={`${commonClass} ${styles.canvasLatex}`} style={style}>
      <div className={styles.canvasLatexViewport} style={{ alignItems: "center", justifyContent: align }}>
        <div
          ref={innerRef}
          className={styles.canvasLatexContent}
          style={{ color: element.color ?? "#333", transformOrigin, transform: `scale(${contentScale})` }}
          dangerouslySetInnerHTML={{ __html: safeMarkup }}
        />
      </div>
    </div>
  );
}

export function SlideCanvas({ scene, highlightedElementId, laserElementId = null, thumbnail = false }: { scene: SceneView; highlightedElementId: string | null; laserElementId?: string | null; thumbnail?: boolean }) {
  const canvas = asRecord(scene.content.canvas);
  const viewportSize = typeof canvas.viewportSize === "number" ? canvas.viewportSize : 1000;
  const viewportRatio = typeof canvas.viewportRatio === "number" ? canvas.viewportRatio : 0.5625;
  const elements = canvasElements(scene);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(thumbnail ? 0.18 : 1);
  const canvasHeight = viewportSize * viewportRatio;
  const background = asRecord(canvas.background);
  const backgroundColor = typeof background.color === "string"
    ? background.color
    : typeof asRecord(canvas.theme).backgroundColor === "string"
      ? asRecord(canvas.theme).backgroundColor as string
      : "#ffffff";

  useEffect(() => {
    const node = canvasRef.current;
    if (!node) return;
    const update = () => {
      // A thumbnail is mounted inside a flex/grid button. During the first
      // layout pass its width can be zero; retaining the last useful scale is
      // preferable to collapsing the entire fixed-coordinate canvas.
      if (node.clientWidth > 0) setScale(node.clientWidth / viewportSize);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [viewportSize]);

  return (
    <div ref={canvasRef} className={`${styles.slideCanvas} ${thumbnail ? styles.slideCanvasThumbnail : ""}`} style={{ aspectRatio: `${viewportSize} / ${canvasHeight}` }}>
      <div className={styles.slideCanvasInner} style={{ width: viewportSize, height: canvasHeight, background: backgroundColor, transform: `scale(${scale})` }}>
        {elements.map((element, index) => {
          const left = element.left ?? 0;
          const top = element.top ?? 0;
          const width = element.width ?? 40;
          const height = element.height ?? 30;
          const style = { left, top, width, height, transform: `rotate(${element.rotate ?? 0}deg)` };
          const commonClass = `${styles.canvasElement} ${element.id === highlightedElementId ? styles.canvasElementHighlighted : ""} ${element.id === laserElementId ? styles.canvasElementLaser : ""}`;
          if (element.type === "image" && element.src) {
            // eslint-disable-next-line @next/next/no-img-element
            return <img className={commonClass} key={element.id ?? index} src={element.src} alt="课件插图" style={style} />;
          }
          if (element.type === "video" && element.src) return <video className={`${commonClass} ${styles.canvasVideo}`} key={element.id ?? index} src={element.src} poster={element.poster} controls={!thumbnail && element.controls !== false} playsInline preload={thumbnail ? "metadata" : "auto"} data-video-element data-element-id={element.id} aria-label="课件视频" style={style} />;
          if (element.type === "line") {
            const bounds = lineBounds(element);
            const lineStyle = { left: left + bounds.minX, top: top + bounds.minY, width: bounds.width, height: bounds.height, transform: `rotate(${element.rotate ?? 0}deg)` };
            const points = element.points ?? ["", ""];
            const markerPrefix = `${element.id ?? `line-${index}`}-${thumbnail ? "thumb" : "main"}`;
            const strokeWidth = Math.max(1, element.width ?? 1);
            return <svg className={`${commonClass} ${styles.canvasLine}`} key={element.id ?? index} style={lineStyle} viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`} preserveAspectRatio="none" aria-hidden="true"><defs>{points[0] ? <marker id={`${markerPrefix}-${points[0]}-start`} markerUnits="userSpaceOnUse" orient="auto" markerWidth={strokeWidth * 3} markerHeight={strokeWidth * 3} refX={strokeWidth * 1.5} refY={strokeWidth * 1.5}><path d="M0,0 L10,5 0,10 Z" fill={element.color ?? "#333"} transform={`scale(${strokeWidth * 0.3}) rotate(180, 5, 5)`} /></marker> : null}{points[1] ? <marker id={`${markerPrefix}-${points[1]}-end`} markerUnits="userSpaceOnUse" orient="auto" markerWidth={strokeWidth * 3} markerHeight={strokeWidth * 3} refX={strokeWidth * 1.5} refY={strokeWidth * 1.5}><path d="M0,0 L10,5 0,10 Z" fill={element.color ?? "#333"} transform={`scale(${strokeWidth * 0.3})`} /></marker> : null}</defs><path d={linePath(element)} fill="none" stroke={element.color ?? "#333"} strokeWidth={strokeWidth} strokeDasharray={lineDashArray(element)} markerStart={points[0] ? `url(#${markerPrefix}-${points[0]}-start)` : undefined} markerEnd={points[1] ? `url(#${markerPrefix}-${points[1]}-end)` : undefined} /></svg>;
          }
          if (element.type === "latex") return <LatexCanvasElement key={element.id ?? index} element={element} style={style} commonClass={commonClass} />;
          if (element.type === "shape") {
            const viewBox = element.viewBox ?? [1, 1];
            return <svg className={`${commonClass} ${styles.canvasShape}`} key={element.id ?? index} style={{ ...style, opacity: element.opacity }} viewBox={`0 0 ${viewBox[0]} ${viewBox[1]}`} preserveAspectRatio="none" aria-hidden="true"><path d={element.path ?? "M 0 0 L 1 0 L 1 1 L 0 1 Z"} fill={element.fill ?? "#eef4fb"} stroke={element.outline?.color} strokeWidth={element.outline?.width} strokeDasharray={element.outline?.style === "dashed" ? "8 4" : element.outline?.style === "dotted" ? "2 3" : undefined} /></svg>;
          }
          if (element.type === "text") {
            const content = element.content ?? "";
            const fontSize = content.match(/font-size:\s*(\d+)px/)?.[1];
            return <div className={`${commonClass} ${styles.canvasText}`} key={element.id ?? index} style={{ ...style, color: element.defaultColor ?? "#333", fontSize: fontSize ? `${Number(fontSize)}px` : undefined }} dangerouslySetInnerHTML={{ __html: sanitizeClassroomMarkup(content) }} />;
          }
          if (element.type === "table") {
            const rows = Array.isArray(element.data) ? element.data : [];
            const colWidths = Array.isArray(element.colWidths) ? element.colWidths : [];
            return <table className={`${commonClass} ${styles.canvasTable}`} key={element.id ?? index} style={style}><tbody>{rows.map((row, rowIndex) => <tr key={`${element.id ?? index}-row-${rowIndex}`}>{(Array.isArray(row) ? row : []).map((rawCell, cellIndex) => { const cell = tableCell(rawCell); return <td key={`${element.id ?? index}-cell-${rowIndex}-${cellIndex}`} colSpan={cell.colSpan} rowSpan={cell.rowSpan} style={{ ...cell.style, width: colWidths[cellIndex] ? `${colWidths[cellIndex] * 100}%` : undefined }}>{textFromMarkup(cell.text)}</td>; })}</tr>)}</tbody></table>;
          }
          return null;
        })}
        {highlightedElementId ? (() => {
          const target = elements.find((element) => element.id === highlightedElementId);
          if (!target) return null;
          const targetId = `spotlight-${scene.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
          return (
            <svg className={styles.canvasSpotlight} viewBox={`0 0 ${viewportSize} ${canvasHeight}`} preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <mask id={targetId}>
                  <rect width={viewportSize} height={canvasHeight} fill="white" />
                  <rect x={target.left ?? 0} y={target.top ?? 0} width={target.width ?? 40} height={target.height ?? 30} rx="8" fill="black" />
                </mask>
              </defs>
              <rect width={viewportSize} height={canvasHeight} fill="rgba(28, 27, 25, .48)" mask={`url(#${targetId})`} />
            </svg>
          );
        })() : null}
      </div>
    </div>
  );
}
