"use client";

import Link from "next/link";
import { ArrowLeft, CircleDashed, Eye, FileQuestion, ListVideo, TriangleAlert } from "lucide-react";
import type { SceneView } from "@chalk/chalkboard";

import styles from "../chalkboard.module.css";
import type { DraftSceneSlot } from "../lib/draft-classroom";
import { SlideCanvas } from "./slide-renderer";

function QuizThumbnail() {
  return (
    <div className={styles.sceneQuizThumbnail} aria-label="知识检查缩略图">
      <div className={styles.quizCoverGlow} aria-hidden="true" />
      <div className={styles.quizCoverIcon}><FileQuestion size={18} /></div>
      <span className={styles.quizCoverKicker}>CHECKPOINT</span>
      <strong className={styles.quizCoverTitle}>知识检查</strong>
      <span className={styles.quizCoverSubtitle}>课堂小测验</span>
    </div>
  );
}

function SceneThumbnail({ scene }: { scene: SceneView }) {
  if (scene.type === "slide") return <SlideCanvas scene={scene} highlightedElementId={null} thumbnail />;
  if (scene.type === "interactive") {
    return (
      <div className={styles.sceneInteractiveThumbnail} aria-label={`${scene.title} 缩略图`}>
        <div className={styles.sceneInteractivePreview}><Eye size={22} /><span>INTERACTIVE</span></div>
        <div className={styles.sceneInteractiveShade} aria-hidden="true"><span>互动探索</span><Eye size={13} /></div>
      </div>
    );
  }
  if (scene.type === "quiz") return <QuizThumbnail />;
  return <div className={styles.sceneInteractiveFallback}><ListVideo size={18} /><span>{scene.title}</span></div>;
}

export function SceneRail({ scenes, activeId, onSelect, draftSlots, onSelectDraftSlot }: {
  scenes: readonly SceneView[];
  activeId: string | null;
  onSelect: (scene: SceneView) => void;
  draftSlots?: readonly DraftSceneSlot[];
  onSelectDraftSlot?: (slot: DraftSceneSlot) => void;
}) {
  const slots = draftSlots?.length
    ? draftSlots
    : scenes.map((scene) => ({ id: scene.id, title: scene.title, order: scene.order, status: "ready" as const }));
  const scenesById = new Map(scenes.map((scene) => [scene.id, scene]));
  return (
    <aside className={styles.sceneRail} aria-label="课程场景">
      <div className={styles.sceneRailBrand}>
        <span className={styles.sceneRailContext}>本课堂</span>
        <Link className={styles.iconButton} href="/chat" aria-label="回到 Chat" title="回到 Chat"><ArrowLeft size={15} /></Link>
      </div>
      <div className={styles.sceneRailHeader}><span>课程场景</span><strong>{slots.length} 页</strong></div>
      <div className={styles.sceneList}>
        {slots.map((slot, index) => {
          const scene = scenesById.get(slot.id);
          if (!scene || slot.status !== "ready") {
            const statusLabel = slot.status === "failed" ? "生成暂停" : slot.status === "running" ? "正在生成" : "等待生成";
            return <button
              className={`${styles.sceneItemPending} ${slot.id === activeId ? styles.sceneItemActive : ""}`}
              key={slot.id}
              type="button"
              aria-current={slot.id === activeId ? "page" : undefined}
              aria-label={`${slot.title} · ${statusLabel}`}
              onClick={() => onSelectDraftSlot?.(slot)}
            >
              <div className={styles.scenePendingThumbnail} aria-hidden="true">
                {slot.status === "failed" ? <TriangleAlert size={19} /> : <CircleDashed className={slot.status === "running" ? styles.importSpinner : ""} size={19} />}
                <span>{statusLabel}</span>
                <span className={styles.sceneThumbnailNumber}>{index + 1}</span>
              </div>
              <div className={styles.sceneItemTopline}>
                <span className={styles.sceneNumber}>{String(index + 1).padStart(2, "0")}</span>
                <span>{statusLabel}</span>
              </div>
              <span className={styles.sceneItemTitle}>{slot.title}</span>
            </button>;
          }
          return <button
              className={`${styles.sceneItem} ${scene.id === activeId ? styles.sceneItemActive : ""}`}
              key={scene.id}
              onClick={() => onSelect(scene)}
              type="button"
              aria-current={scene.id === activeId ? "page" : undefined}
            >
              <div className={styles.sceneThumbnail}>
                <SceneThumbnail scene={scene} />
                <span className={styles.sceneThumbnailNumber}>{index + 1}</span>
              </div>
              <div className={styles.sceneItemTopline}>
                <span className={styles.sceneNumber}>{String(index + 1).padStart(2, "0")}</span>
                <span>{scene.actionCount} 个动作</span>
              </div>
              <span className={styles.sceneItemTitle}>{scene.title}</span>
            </button>;
        })}
      </div>
    </aside>
  );
}
