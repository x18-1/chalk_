"use client";

import Link from "next/link";
import { ArrowLeft, Eye, FileQuestion, ListVideo } from "lucide-react";
import type { SceneView } from "@chalk/chalkboard";

import styles from "../chalkboard.module.css";
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

export function SceneRail({ scenes, activeId, onSelect }: {
  scenes: readonly SceneView[];
  activeId: string | null;
  onSelect: (scene: SceneView) => void;
}) {
  return (
    <aside className={styles.sceneRail} aria-label="课程场景">
      <div className={styles.sceneRailBrand}>
        <span className={styles.sceneRailContext}>本课堂</span>
        <Link className={styles.iconButton} href="/chat" aria-label="回到 Chat" title="回到 Chat"><ArrowLeft size={15} /></Link>
      </div>
      <div className={styles.sceneRailHeader}><span>课程场景</span><strong>{scenes.length} 页</strong></div>
      <div className={styles.sceneList}>
        {scenes.map((scene, index) => (
          <button
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
          </button>
        ))}
      </div>
    </aside>
  );
}
