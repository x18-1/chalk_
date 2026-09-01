"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CanvasElement, SceneView } from "@chalk/chalkboard";
import katex from "katex";
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

type ChartData = { labels: string[]; legends: string[]; series: number[][] };

function chartData(element: CanvasElement): ChartData | null {
  const data = asRecord(element.data);
  const rawSeries = Array.isArray(data.series) ? data.series : [];
  const series = rawSeries.map((row) => Array.isArray(row)
    ? row.map((value) => typeof value === "number" && Number.isFinite(value) ? value : 0)
    : []);
  if (!series.length || !series.some((row) => row.length)) return null;
  const itemCount = Math.max(...series.map((row) => row.length));
  const labels = Array.isArray(data.labels)
    ? data.labels.slice(0, itemCount).map((value) => String(value))
    : [];
  const legends = Array.isArray(data.legends)
    ? data.legends.slice(0, series.length).map((value) => String(value))
    : [];
  return {
    labels: Array.from({ length: itemCount }, (_, index) => labels[index] ?? String(index + 1)),
    legends: series.map((_, index) => legends[index] ?? `系列 ${index + 1}`),
    series: series.map((row) => Array.from({ length: itemCount }, (_, index) => row[index] ?? 0)),
  };
}

const chartNames: Record<string, string> = {
  area: "面积图",
  bar: "柱状图",
  column: "条形图",
  line: "折线图",
  pie: "饼图",
  radar: "雷达图",
  ring: "环形图",
  scatter: "散点图",
};

function chartColors(element: CanvasElement, count: number): string[] {
  const defaults = ["#3f6f8c", "#c15f3c", "#42604a", "#a76024", "#7a5b83"];
  const configured = Array.isArray(element.themeColors)
    ? element.themeColors.filter((value): value is string => typeof value === "string" && value.length > 0)
    : [];
  return Array.from({ length: count }, (_, index) => configured[index] ?? defaults[index % defaults.length]!);
}

function polarPoint(cx: number, cy: number, radius: number, angle: number) {
  return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
}

function donutSegment(cx: number, cy: number, outer: number, inner: number, start: number, end: number): string {
  const outerStart = polarPoint(cx, cy, outer, start);
  const outerEnd = polarPoint(cx, cy, outer, end);
  const largeArc = end - start > Math.PI ? 1 : 0;
  if (inner <= 0) return `M ${cx} ${cy} L ${outerStart.x} ${outerStart.y} A ${outer} ${outer} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y} Z`;
  const innerEnd = polarPoint(cx, cy, inner, end);
  const innerStart = polarPoint(cx, cy, inner, start);
  return `M ${outerStart.x} ${outerStart.y} A ${outer} ${outer} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y} L ${innerEnd.x} ${innerEnd.y} A ${inner} ${inner} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y} Z`;
}

function ChartCanvasElement({
  element,
  style,
  commonClass,
}: {
  element: CanvasElement;
  style: React.CSSProperties;
  commonClass: string;
}) {
  const data = chartData(element);
  const width = element.width ?? 320;
  const height = element.height ?? 180;
  const type = typeof element.chartType === "string" ? element.chartType : "bar";
  const chartName = chartNames[type] ?? "图表";
  const ariaLabel = data ? `${chartName}：${data.legends.join("、")}` : `${chartName}：暂无有效数据`;
  if (!data) return <div className={`${commonClass} ${styles.canvasChartEmpty}`} style={style} role="img" aria-label={ariaLabel}>暂无有效图表数据</div>;

  const colors = chartColors(element, Math.max(data.series.length, data.labels.length));
  const textColor = typeof element.textColor === "string" ? element.textColor : "#514c47";
  const allValues = data.series.flat();
  const minimum = Math.min(0, ...allValues);
  const maximum = Math.max(0, ...allValues);
  const range = maximum - minimum || 1;
  const left = 42;
  const right = 12;
  const top = data.legends.length ? 30 : 12;
  const bottom = 28;
  const plotWidth = Math.max(1, width - left - right);
  const plotHeight = Math.max(1, height - top - bottom);
  const yFor = (value: number) => top + ((maximum - value) / range) * plotHeight;
  const xFor = (index: number) => left + ((index + 0.5) / data.labels.length) * plotWidth;
  const baseline = yFor(0);
  const legend = <g className={styles.canvasChartLegend}>{data.legends.map((name, index) => <g key={name} transform={`translate(${left + index * Math.min(112, plotWidth / Math.max(1, data.legends.length))} 12)`}><rect width="9" height="9" rx="2" fill={colors[index]} /><text x="14" y="9" fill={textColor}>{name.slice(0, 14)}</text></g>)}</g>;

  let marks: React.ReactNode;
  if (type === "pie" || type === "ring") {
    const values = data.series[0]!.map((value) => Math.max(0, value));
    const total = values.reduce((sum, value) => sum + value, 0) || 1;
    const radius = Math.max(8, Math.min(plotWidth, plotHeight) * 0.42);
    const cx = left + plotWidth / 2;
    const cy = top + plotHeight / 2;
    let cursor = -Math.PI / 2;
    marks = <>{values.map((value, index) => {
      const start = cursor;
      const end = cursor + (value / total) * Math.PI * 2;
      cursor = end;
      return <path key={`${data.labels[index]}-${index}`} d={donutSegment(cx, cy, radius, type === "ring" ? radius * 0.58 : 0, start, end)} fill={colors[index]} stroke="#fff" strokeWidth="2"><title>{`${data.labels[index]}：${value}`}</title></path>;
    })}</>;
  } else if (type === "radar") {
    const cx = left + plotWidth / 2;
    const cy = top + plotHeight / 2;
    const radius = Math.max(8, Math.min(plotWidth, plotHeight) * 0.42);
    const radarMax = Math.max(1, ...allValues.map((value) => Math.abs(value)));
    const axes = data.labels.map((_, index) => -Math.PI / 2 + index * Math.PI * 2 / data.labels.length);
    marks = <>
      {[0.25, 0.5, 0.75, 1].map((ratio) => <polygon key={ratio} points={axes.map((angle) => { const point = polarPoint(cx, cy, radius * ratio, angle); return `${point.x},${point.y}`; }).join(" ")} fill="none" stroke="#ddd6ce" />)}
      {axes.map((angle, index) => { const end = polarPoint(cx, cy, radius, angle); const label = polarPoint(cx, cy, radius + 12, angle); return <g key={data.labels[index]}><line x1={cx} y1={cy} x2={end.x} y2={end.y} stroke="#ddd6ce" /><text x={label.x} y={label.y} textAnchor="middle" dominantBaseline="middle" fill={textColor}>{data.labels[index]!.slice(0, 8)}</text></g>; })}
      {data.series.map((series, seriesIndex) => <polygon key={data.legends[seriesIndex]} points={axes.map((angle, index) => { const point = polarPoint(cx, cy, radius * Math.max(0, series[index] ?? 0) / radarMax, angle); return `${point.x},${point.y}`; }).join(" ")} fill={colors[seriesIndex]} fillOpacity="0.16" stroke={colors[seriesIndex]} strokeWidth="2" />)}
    </>;
  } else if (type === "column") {
    const groupHeight = plotHeight / data.labels.length;
    const barHeight = Math.max(2, groupHeight * 0.68 / data.series.length);
    const xZero = left + ((0 - minimum) / range) * plotWidth;
    marks = <>
      <line x1={xZero} y1={top} x2={xZero} y2={top + plotHeight} stroke="#c4bbb2" />
      {data.labels.map((label, itemIndex) => <text key={label} x={left - 5} y={top + (itemIndex + 0.5) * groupHeight} textAnchor="end" dominantBaseline="middle" fill={textColor}>{label.slice(0, 8)}</text>)}
      {data.series.flatMap((series, seriesIndex) => series.map((value, itemIndex) => {
        const xValue = left + ((value - minimum) / range) * plotWidth;
        return <rect key={`${seriesIndex}-${itemIndex}`} x={Math.min(xZero, xValue)} y={top + itemIndex * groupHeight + groupHeight * 0.16 + seriesIndex * barHeight} width={Math.max(1, Math.abs(xValue - xZero))} height={barHeight} rx="2" fill={colors[seriesIndex]}><title>{`${data.labels[itemIndex]} · ${data.legends[seriesIndex]}：${value}`}</title></rect>;
      }))}
    </>;
  } else {
    marks = <>
      {[0, 0.25, 0.5, 0.75, 1].map((ratio) => { const value = maximum - range * ratio; const y = top + plotHeight * ratio; return <g key={ratio}><line x1={left} y1={y} x2={left + plotWidth} y2={y} stroke="#ebe6df" /><text x={left - 6} y={y} textAnchor="end" dominantBaseline="middle" fill={textColor}>{Number(value.toFixed(2))}</text></g>; })}
      <line x1={left} y1={baseline} x2={left + plotWidth} y2={baseline} stroke="#c4bbb2" />
      {data.labels.map((label, index) => <text key={label} x={xFor(index)} y={height - 7} textAnchor="middle" fill={textColor}>{label.slice(0, 10)}</text>)}
      {type === "bar" ? data.series.flatMap((series, seriesIndex) => {
        const groupWidth = plotWidth / data.labels.length;
        const barWidth = Math.max(2, groupWidth * 0.68 / data.series.length);
        return series.map((value, itemIndex) => {
          const valueY = yFor(value);
          return <rect key={`${seriesIndex}-${itemIndex}`} x={left + itemIndex * groupWidth + groupWidth * 0.16 + seriesIndex * barWidth} y={Math.min(baseline, valueY)} width={barWidth} height={Math.max(1, Math.abs(valueY - baseline))} rx="2" fill={colors[seriesIndex]}><title>{`${data.labels[itemIndex]} · ${data.legends[seriesIndex]}：${value}`}</title></rect>;
        });
      }) : data.series.map((series, seriesIndex) => {
        const points = series.map((value, index) => `${xFor(index)},${yFor(value)}`).join(" ");
        const linePath = `M ${series.map((value, index) => `${xFor(index)} ${yFor(value)}`).join(" L ")}`;
        return <g key={data.legends[seriesIndex]}>
          {type === "area" ? <path d={`${linePath} L ${xFor(series.length - 1)} ${baseline} L ${xFor(0)} ${baseline} Z`} fill={colors[seriesIndex]} fillOpacity="0.14" /> : null}
          {type !== "scatter" ? <polyline points={points} fill="none" stroke={colors[seriesIndex]} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" /> : null}
          {series.map((value, index) => <circle key={index} cx={xFor(index)} cy={yFor(value)} r={type === "scatter" ? 4 : 3} fill={colors[seriesIndex]} stroke="#fff" strokeWidth="1"><title>{`${data.labels[index]} · ${data.legends[seriesIndex]}：${value}`}</title></circle>)}
        </g>;
      })}
    </>;
  }

  return <svg className={`${commonClass} ${styles.canvasChart}`} style={style} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} preserveAspectRatio="none"><title>{ariaLabel}</title>{legend}{marks}</svg>;
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
  const latex = typeof element.latex === "string" ? element.latex : "";
  const html = typeof element.html === "string" ? element.html : "";
  const safeMarkup = useMemo(() => {
    if (html.trim()) return sanitizeClassroomMarkup(html);
    if (!latex.trim()) return "";
    return sanitizeClassroomMarkup(katex.renderToString(latex, {
      displayMode: true,
      output: "htmlAndMathml",
      strict: "ignore",
      throwOnError: false,
      trust: false,
    }));
  }, [html, latex]);
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
  }, [height, safeMarkup, width]);

  return (
    <div className={`${commonClass} ${styles.canvasLatex}`} style={style} role="img" aria-label={`数学公式：${latex || "已渲染公式"}`}>
      <div className={styles.canvasLatexViewport} style={{ alignItems: "center", justifyContent: align }}>
        <div
          ref={innerRef}
          className={styles.canvasLatexContent}
          style={{
            color: element.color ?? "#333",
            fontSize: typeof element.fontSize === "number" ? `${element.fontSize}px` : undefined,
            transformOrigin,
            transform: `scale(${contentScale})`,
          }}
          dangerouslySetInnerHTML={{ __html: safeMarkup }}
        />
      </div>
    </div>
  );
}

function codeLines(element: CanvasElement): string[] {
  if (Array.isArray(element.lines)) {
    return element.lines.map((line) => {
      if (typeof line === "string") return line;
      const record = asRecord(line);
      return typeof record.content === "string" ? record.content : "";
    });
  }
  return typeof element.code === "string" ? element.code.split("\n") : [];
}

function CodeCanvasElement({
  element,
  style,
  commonClass,
}: {
  element: CanvasElement;
  style: React.CSSProperties;
  commonClass: string;
}) {
  const lines = codeLines(element);
  const language = typeof element.language === "string" && element.language.trim() ? element.language : "text";
  const fileName = typeof element.fileName === "string" && element.fileName.trim() ? element.fileName : language;
  const showLineNumbers = element.showLineNumbers !== false;
  const fontSize = typeof element.fontSize === "number" && Number.isFinite(element.fontSize)
    ? Math.max(8, Math.min(40, element.fontSize))
    : 14;
  return (
    <figure className={`${commonClass} ${styles.canvasCode}`} style={style} aria-label={`代码：${fileName}`}>
      <figcaption className={styles.canvasCodeHeader}>
        <span title={fileName}>{fileName}</span>
        <span>{language}</span>
      </figcaption>
      <pre className={styles.canvasCodeBody} style={{ fontSize }}><code>{lines.length ? lines.map((line, index) => (
        <span className={styles.canvasCodeLine} key={`${element.id ?? "code"}-line-${index}`}>
          {showLineNumbers ? <span className={styles.canvasCodeLineNumber} aria-hidden="true">{index + 1}</span> : null}
          <span>{line || " "}</span>
        </span>
      )) : <span className={styles.canvasCodeEmpty}>暂无代码内容</span>}</code></pre>
    </figure>
  );
}

function UnsupportedCanvasElement({
  element,
  style,
  commonClass,
}: {
  element: CanvasElement;
  style: React.CSSProperties;
  commonClass: string;
}) {
  const type = typeof element.type === "string" && element.type.trim() ? element.type : "unknown";
  return <div className={`${commonClass} ${styles.canvasUnsupported}`} style={style} role="status">暂不支持课件元素：{type}</div>;
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
          if (element.type === "chart") return <ChartCanvasElement key={element.id ?? index} element={element} style={style} commonClass={commonClass} />;
          if (element.type === "code") return <CodeCanvasElement key={element.id ?? index} element={element} style={style} commonClass={commonClass} />;
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
            const width = element.width ?? 40;
            const height = element.height ?? 30;
            const shapeName = element.shape ?? element.shapeType;
            let shapeStyle = style;
            let viewBox = element.viewBox ?? [width, height];
            const radius = Math.min(typeof element.rx === "number" ? element.rx : 12, width / 2, height / 2);
            let fallbackPath = shapeName === "circle"
              ? `M ${width / 2} 0 A ${Math.min(width, height) / 2} ${Math.min(width, height) / 2} 0 1 1 ${width / 2 - 0.01} ${height} A ${Math.min(width, height) / 2} ${Math.min(width, height) / 2} 0 1 1 ${width / 2} 0 Z`
              : shapeName === "ellipse" || shapeName === "oval"
                ? `M ${width / 2} 0 A ${width / 2} ${height / 2} 0 1 1 ${width / 2} ${height} A ${width / 2} ${height / 2} 0 1 1 ${width / 2} 0 Z`
              : shapeName === "roundedRect" || shapeName === "rounded-rect"
                ? `M ${radius} 0 H ${width - radius} Q ${width} 0 ${width} ${radius} V ${height - radius} Q ${width} ${height} ${width - radius} ${height} H ${radius} Q 0 ${height} 0 ${height - radius} V ${radius} Q 0 0 ${radius} 0 Z`
                : shapeName === "rect" || shapeName === "rectangle"
                  ? `M 0 0 H ${width} V ${height} H 0 Z`
                  : "M 0 0 L 1 0 L 1 1 L 0 1 Z";
            if (shapeName === "polygon" && !element.path && Array.isArray(element.points)) {
              const rawPoints: unknown[] = element.points as unknown[];
              const points = rawPoints.filter((point): point is number[] => Array.isArray(point)
                && point.length >= 2 && typeof point[0] === "number" && typeof point[1] === "number");
              if (points.length >= 3) {
                const minX = Math.min(...points.map((point) => point[0]!));
                const minY = Math.min(...points.map((point) => point[1]!));
                const maxX = Math.max(...points.map((point) => point[0]!));
                const maxY = Math.max(...points.map((point) => point[1]!));
                viewBox = [Math.max(1, maxX - minX), Math.max(1, maxY - minY)];
                shapeStyle = { ...style, left: minX, top: minY, width: viewBox[0], height: viewBox[1] };
                fallbackPath = `${points.map((point, pointIndex) => `${pointIndex === 0 ? "M" : "L"} ${point[0]! - minX} ${point[1]! - minY}`).join(" ")} Z`;
              }
            }
            return <svg className={`${commonClass} ${styles.canvasShape}`} key={element.id ?? index} style={{ ...shapeStyle, opacity: element.opacity }} viewBox={`0 0 ${viewBox[0]} ${viewBox[1]}`} preserveAspectRatio="none" aria-hidden="true"><path d={element.path ?? fallbackPath} fill={element.fill ?? "#eef4fb"} stroke={element.outline?.color} strokeWidth={element.outline?.width} strokeDasharray={element.outline?.style === "dashed" ? "8 4" : element.outline?.style === "dotted" ? "2 3" : undefined} /></svg>;
          }
          if (element.type === "text") {
            const content = element.content ?? "";
            const fontSize = content.match(/font-size:\s*(\d+)px/)?.[1];
            const textAlign = element.textAlign ?? element.align;
            // Canvas JSON expresses lineHeight in coordinate pixels. React's
            // numeric line-height is unitless, so pass an explicit px value.
            const lineHeight = typeof element.lineHeight === "number"
              ? element.lineHeight <= 4 ? element.lineHeight : `${element.lineHeight}px`
              : undefined;
            const fontWeight = typeof element.fontWeight === "number" || typeof element.fontWeight === "string"
              ? element.fontWeight
              : undefined;
            return <div className={`${commonClass} ${styles.canvasText}`} key={element.id ?? index} style={{
              ...style,
              color: element.defaultColor ?? element.color ?? "#333",
              fontSize: fontSize ? `${Number(fontSize)}px` : typeof element.fontSize === "number" ? `${element.fontSize}px` : undefined,
              fontWeight,
              lineHeight,
              textAlign: textAlign === "left" || textAlign === "center" || textAlign === "right" ? textAlign : undefined,
            }} dangerouslySetInnerHTML={{ __html: sanitizeClassroomMarkup(content) }} />;
          }
          if (element.type === "table") {
            const rows = Array.isArray(element.data) ? element.data : [];
            const colWidths = Array.isArray(element.colWidths) ? element.colWidths : [];
            return <table className={`${commonClass} ${styles.canvasTable}`} key={element.id ?? index} style={style}><tbody>{rows.map((row, rowIndex) => <tr key={`${element.id ?? index}-row-${rowIndex}`}>{(Array.isArray(row) ? row : []).map((rawCell, cellIndex) => { const cell = tableCell(rawCell); return <td key={`${element.id ?? index}-cell-${rowIndex}-${cellIndex}`} colSpan={cell.colSpan} rowSpan={cell.rowSpan} style={{ ...cell.style, width: colWidths[cellIndex] ? `${colWidths[cellIndex] * 100}%` : undefined }}>{textFromMarkup(cell.text)}</td>; })}</tr>)}</tbody></table>;
          }
          return <UnsupportedCanvasElement key={element.id ?? index} element={element} style={style} commonClass={commonClass} />;
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
