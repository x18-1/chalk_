"use client";

import {
  Eye,
  Flashlight,
  MessageCircle,
  MousePointer2,
  Play,
  SlidersHorizontal,
  Volume2,
  Zap,
} from "lucide-react";

import type { Action, SceneView } from "@chalk/chalkboard";
import styles from "../chalkboard.module.css";

type ActionConfig = { label: string; Icon: typeof Flashlight; className: string };

const ACTION_CONFIG: Record<string, ActionConfig> = {
  spotlight: { label: "聚光", Icon: Flashlight, className: styles.noteToolSpotlight },
  laser: { label: "激光", Icon: MousePointer2, className: styles.noteToolLaser },
  play_video: { label: "播放视频", Icon: Play, className: styles.noteToolVideo },
  discussion: { label: "课堂提问", Icon: MessageCircle, className: styles.noteToolDiscussion },
  // OpenMAIC's lecture notes represent an interactive highlight with the same
  // visual cue as a slide spotlight. Keep the protocol action intact while
  // preserving that authored teaching meaning in the notes rail.
  widget_highlight: { label: "聚光", Icon: Flashlight, className: styles.noteToolSpotlight },
  widget_setState: { label: "互动状态", Icon: SlidersHorizontal, className: styles.noteToolWidget },
  widget_annotation: { label: "互动标注", Icon: Eye, className: styles.noteToolWidget },
  widget_reveal: { label: "互动揭示", Icon: Eye, className: styles.noteToolWidget },
  speech: { label: "讲解", Icon: Volume2, className: styles.noteToolSpeech },
};

function actionText(action: Action): string | null {
  if (typeof action.text === "string") return action.text;
  if (typeof action.topic === "string") return action.topic;
  if (typeof action.content === "string") return action.content;
  return null;
}

function ActionTag({ action, compact = false }: { action: Action; compact?: boolean }) {
  const config = ACTION_CONFIG[action.type] ?? { label: action.type, Icon: Zap, className: styles.noteToolUnknown };
  const Icon = config.Icon;
  return compact
    ? <span className={`${styles.noteInlineAction} ${config.className}`} title={config.label} aria-label={config.label}><Icon size={11} /></span>
    : <span className={`${styles.noteActionTag} ${config.className}`}><Icon size={12} /><span>{config.label}</span></span>;
}

type NoteRow =
  | { kind: "speech"; text: string; actions: Action[]; indices: number[] }
  | { kind: "discussion"; action: Action; indices: number[] }
  | { kind: "tools"; actions: Action[]; indices: number[] };

function buildNoteRows(actions: readonly Action[]): NoteRow[] {
  const rows: NoteRow[] = [];
  let pending: Action[] = [];
  let pendingIndices: number[] = [];
  const flushTools = () => {
    if (!pending.length) return;
    rows.push({ kind: "tools", actions: pending, indices: pendingIndices });
    pending = [];
    pendingIndices = [];
  };
  actions.forEach((action, index) => {
    if (action.type === "speech") {
      rows.push({ kind: "speech", text: actionText(action) ?? "", actions: pending, indices: [...pendingIndices, index] });
      pending = [];
      pendingIndices = [];
    } else if (action.type === "discussion") {
      flushTools();
      rows.push({ kind: "discussion", action, indices: [index] });
    } else if (action.type !== "discussion") {
      pending.push(action);
      pendingIndices.push(index);
    }
  });
  flushTools();
  return rows;
}

export function NotesPanel({ scene, actions, activeActionIndex }: { scene: SceneView; actions: readonly Action[]; activeActionIndex: number }) {
  return (
    <div className={styles.notesContent}>
      <div className={styles.notesHeading}>
        <span className={styles.notesPageMarker}>Page {scene.order}</span>
        <strong>{scene.title}</strong>
        <span className={styles.notesMeta}>{actions.length} 个课堂动作</span>
      </div>
      <div className={styles.notesList}>
        {actions.length ? buildNoteRows(actions).map((row, index) => {
          const active = row.indices.includes(activeActionIndex);
          if (row.kind === "speech") {
            return <div className={`${styles.noteRow} ${active ? styles.noteRowActive : ""}`} key={`speech-${row.indices[0]}`}>
              <p className={styles.noteSpeech}><span className={styles.noteInlineActions}>{row.actions.map((action) => <ActionTag key={action.id} action={action} compact />)}</span>{row.text}</p>
            </div>;
          }
          if (row.kind === "discussion") {
            return <div className={`${styles.noteRow} ${styles.noteDiscussionRow} ${active ? styles.noteRowActive : ""}`} key={`discussion-${row.indices[0]}`}>
              <div className={styles.noteDiscussionContent}><ActionTag action={row.action} /><span>{actionText(row.action) ?? "课堂提问"}</span></div>
            </div>;
          }
          return <div className={`${styles.noteRow} ${active ? styles.noteRowActive : ""}`} key={`tools-${index}`}>
            <div className={styles.noteTrailingActions}>{row.actions.map((action) => <ActionTag key={action.id} action={action} />)}</div>
          </div>;
        }) : <p className={styles.notesEmpty}>这一页暂时没有课堂动作。</p>}
      </div>
    </div>
  );
}
