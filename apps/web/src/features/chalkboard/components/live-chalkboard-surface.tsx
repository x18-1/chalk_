"use client";

import { useMemo } from "react";
import katex from "katex";
import { Minimize2, Presentation } from "lucide-react";
import type { Action } from "@chalk/chalkboard";

import { sanitizeClassroomMarkup } from "../lib/safe-html";
import styles from "../chalkboard.module.css";

const CHART_COLORS = ["#b85c3b", "#3f7b77", "#d49a43", "#6f668c", "#79955a", "#b86c84"];

function elementKey(action: Action) {
  return typeof action.elementId === "string" ? action.elementId : action.id;
}

function actionPosition(action: Action): React.CSSProperties {
  const x = typeof action.x === "number" ? action.x : 40;
  const y = typeof action.y === "number" ? action.y : 40;
  const width = typeof action.width === "number" ? action.width : 260;
  const height = typeof action.height === "number" ? action.height : 100;
  return {
    left: `${x / 10}%`,
    top: `${y / 5.625}%`,
    width: `${width / 10}%`,
    minHeight: `${height / 5.625}%`,
  };
}

function LatexElement({ action }: { action: Action }) {
  const latex = typeof action.latex === "string" ? action.latex : "";
  const markup = useMemo(() => sanitizeClassroomMarkup(katex.renderToString(latex, {
    displayMode: true,
    output: "htmlAndMathml",
    strict: "ignore",
    throwOnError: false,
    trust: false,
  })), [latex]);
  return <div className={styles.liveChalkboardLatex} role="img" aria-label={`数学公式：${latex}`} dangerouslySetInnerHTML={{ __html: markup }} />;
}

function TableElement({ action }: { action: Action }) {
  const rows = Array.isArray(action.data)
    ? action.data.filter((row): row is unknown[] => Array.isArray(row))
    : [];
  return <table className={styles.liveChalkboardTable}>
    <tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => (
      <td key={cellIndex}>{String(cell)}</td>
    ))}</tr>)}</tbody>
  </table>;
}

function ChartElement({ action }: { action: Action }) {
  const data = typeof action.data === "object" && action.data !== null
    ? action.data as { labels?: unknown; series?: unknown }
    : {};
  const labels = Array.isArray(data.labels) ? data.labels.map(String) : [];
  const series = Array.isArray(data.series)
    ? data.series.filter((row): row is number[] => Array.isArray(row) && row.every((value) => typeof value === "number"))
    : [];
  const values = series.flat();
  const maximum = Math.max(1, ...values.map((value) => Math.abs(value)));
  const colors = Array.isArray(action.themeColors) && action.themeColors.every((color) => typeof color === "string")
    ? action.themeColors as string[]
    : CHART_COLORS;
  const chartType = typeof action.chartType === "string" ? action.chartType : "bar";

  if (chartType === "pie" || chartType === "ring") {
    const pieValues = series[0] ?? [];
    const total = pieValues.reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
    let cursor = 0;
    const stops = pieValues.map((value, index) => {
      const start = cursor;
      cursor += Math.max(0, value) / total * 360;
      return `${colors[index % colors.length]} ${start}deg ${cursor}deg`;
    });
    return <div className={styles.liveChalkboardPieWrap}>
      <div className={styles.liveChalkboardPie} data-ring={chartType === "ring" || undefined} style={{ background: `conic-gradient(${stops.join(",")})` }} />
      <div className={styles.liveChalkboardLegend}>{labels.map((label, index) => <span key={`${label}-${index}`}><i style={{ background: colors[index % colors.length] }} />{label}</span>)}</div>
    </div>;
  }

  const pointCount = Math.max(1, ...series.map((row) => row.length));
  const x = (index: number) => 28 + index * (244 / Math.max(1, pointCount - 1));
  const y = (value: number) => 142 - Math.max(0, value) / maximum * 112;
  const lineLike = ["line", "area", "scatter", "radar"].includes(chartType);
  return <svg className={styles.liveChalkboardChart} viewBox="0 0 300 180" role="img" aria-label={`${chartType} 图表`}>
    <line x1="26" y1="146" x2="282" y2="146" />
    {lineLike ? series.map((row, seriesIndex) => {
      const points = row.map((value, index) => `${x(index)},${y(value)}`).join(" ");
      return <g key={seriesIndex}>
        {chartType !== "scatter" ? <polyline points={points} fill="none" stroke={colors[seriesIndex % colors.length]} strokeWidth="3" strokeLinejoin="round" /> : null}
        {row.map((value, index) => <circle key={index} cx={x(index)} cy={y(value)} r="4" fill={colors[seriesIndex % colors.length]}><title>{`${labels[index] ?? index + 1}: ${value}`}</title></circle>)}
      </g>;
    }) : series.flatMap((row, seriesIndex) => row.map((value, index) => {
      const groupWidth = 244 / Math.max(1, pointCount);
      const barWidth = Math.max(4, groupWidth / Math.max(1, series.length) - 3);
      const barX = 28 + index * groupWidth + seriesIndex * (barWidth + 3);
      return <rect key={`${seriesIndex}-${index}`} x={barX} y={y(value)} width={barWidth} height={146 - y(value)} rx="2" fill={colors[seriesIndex % colors.length]}><title>{`${labels[index] ?? index + 1}: ${value}`}</title></rect>;
    }))}
    {labels.slice(0, 8).map((label, index) => <text key={`${label}-${index}`} x={x(index)} y="164" textAnchor="middle">{label.slice(0, 7)}</text>)}
  </svg>;
}

function AuthoredChalkboardElement({ action }: { action: Action }) {
  if (action.type === "wb_draw_line") {
    const markerStart = Array.isArray(action.points) && action.points[0] === "arrow" ? "url(#chalkboard-arrow-start)" : undefined;
    const markerEnd = Array.isArray(action.points) && action.points[1] === "arrow" ? "url(#chalkboard-arrow-end)" : undefined;
    return <line
      x1={Number(action.startX)}
      y1={Number(action.startY)}
      x2={Number(action.endX)}
      y2={Number(action.endY)}
      stroke={typeof action.color === "string" ? action.color : "currentColor"}
      strokeWidth={typeof action.width === "number" ? action.width : 4}
      strokeDasharray={action.style === "dashed" ? "10 8" : undefined}
      markerStart={markerStart}
      markerEnd={markerEnd}
      strokeLinecap="round"
    />;
  }

  let content: React.ReactNode = null;
  if (action.type === "wb_draw_text") content = String(action.content);
  if (action.type === "wb_draw_latex") content = <LatexElement action={action} />;
  if (action.type === "wb_draw_code") content = <><span className={styles.liveChalkboardCodeLabel}>{String(action.fileName ?? action.language ?? "代码")}</span><pre>{String(action.code)}</pre></>;
  if (action.type === "wb_draw_table") content = <TableElement action={action} />;
  if (action.type === "wb_draw_chart") content = <ChartElement action={action} />;
  if (action.type === "wb_draw_shape") content = <span className={styles.liveChalkboardShapeLabel}>{String(action.label ?? "")}</span>;
  const style = {
    ...actionPosition(action),
    ...(typeof action.color === "string" ? { color: action.color } : {}),
    ...(action.type === "wb_draw_shape" && typeof action.fillColor === "string" ? { backgroundColor: action.fillColor } : {}),
    ...(action.type === "wb_draw_text" && typeof action.fontSize === "number" ? { fontSize: `${action.fontSize}px` } : {}),
  };
  return <div
    className={styles.liveChalkboardAuthoredElement}
    data-chalkboard-type={action.type}
    data-shape={action.type === "wb_draw_shape" ? String(action.shape) : undefined}
    style={style}
  >{content}</div>;
}

export function LiveChalkboardSurface({ elements, onClose }: {
  elements: readonly Action[];
  onClose: () => void;
}) {
  return (
    <section className={styles.liveChalkboardSurface} aria-label="实时黑板">
      <header className={styles.liveChalkboardHeader}>
        <div className={styles.liveChalkboardTitle}><span className={styles.liveChalkboardMark}><Presentation size={14} /></span><strong>实时黑板</strong><span>课堂 Agent 正在板书 · {elements.length} 项内容</span></div>
        <div className={styles.liveChalkboardActions}>
          <button type="button" aria-label="收起实时黑板" title="收起实时黑板" onClick={onClose}><Minimize2 size={15} /></button>
        </div>
      </header>
      <div className={styles.liveChalkboardCanvas}>
        {!elements.length ? <div className={styles.liveChalkboardEmpty}><span>实时黑板已打开</span><p>课堂 Agent 正在准备板书。</p></div> : null}
        <svg viewBox="0 0 1000 562.5" role="img" aria-label="实时黑板图示">
          <defs>
            <marker id="chalkboard-arrow-end" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z" fill="context-stroke" /></marker>
            <marker id="chalkboard-arrow-start" markerWidth="8" markerHeight="8" refX="1" refY="4" orient="auto-start-reverse"><path d="M8,0 L0,4 L8,8 Z" fill="context-stroke" /></marker>
          </defs>
          {elements.filter((action) => action.type === "wb_draw_line").map((action) => <AuthoredChalkboardElement key={elementKey(action)} action={action} />)}
        </svg>
        <div className={styles.liveChalkboardAuthoredLayer} aria-label="实时黑板内容">
          {elements.filter((action) => action.type !== "wb_draw_line").map((action) => <AuthoredChalkboardElement key={elementKey(action)} action={action} />)}
        </div>
      </div>
    </section>
  );
}
