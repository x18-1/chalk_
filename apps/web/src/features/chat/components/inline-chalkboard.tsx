"use client";

import type { SceneView } from "@chalk/chalkboard";

import { SlideCanvas } from "../../chalkboard/components/slide-renderer";
import styles from "../../../app/chat/chat.module.css";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function ReadonlyQuiz({ scene }: { scene: SceneView }) {
  const questions = Array.isArray(scene.content.questions) ? scene.content.questions : [];
  return (
    <div className={styles.inlineQuiz}>
      <div className={styles.inlineSceneIntro}><span>CHECKPOINT</span><strong>{questions.length ? `${questions.length} 道练习题` : "知识检查"}</strong><small>聊天黑板只展示题目，不提交答案</small></div>
      {questions.map((rawQuestion, index) => {
        const question = asRecord(rawQuestion);
        const options = Array.isArray(question.options) ? question.options : [];
        const prompt = typeof question.question === "string"
          ? question.question
          : typeof question.prompt === "string"
            ? question.prompt
            : "未提供题干";
        return (
          <section className={styles.inlineQuestion} key={typeof question.id === "string" ? question.id : index}>
            <div className={styles.inlineQuestionNumber}>QUESTION {String(index + 1).padStart(2, "0")}</div>
            <p>{prompt}</p>
            {options.length ? <ul>{options.map((rawOption, optionIndex) => {
              const option = asRecord(rawOption);
              const label = typeof rawOption === "string"
                ? rawOption
                : typeof option.label === "string"
                  ? option.label
                  : String(option.value ?? "");
              return <li key={optionIndex}><span>{String.fromCharCode(65 + optionIndex)}</span>{label}</li>;
            })}</ul> : null}
          </section>
        );
      })}
    </div>
  );
}

function ReadonlyInteractive({ scene }: { scene: SceneView }) {
  const html = typeof scene.content.html === "string" ? scene.content.html : undefined;
  const rawUrl = typeof scene.content.url === "string" ? scene.content.url : undefined;
  const url = rawUrl && /^https?:\/\//i.test(rawUrl) ? rawUrl : undefined;
  if (!html && !url) return <div className={styles.inlineSceneUnsupported}>互动 Scene 没有可展示的内容。</div>;
  // Keep the preview isolated from the parent app while allowing self-contained
  // canvas/SVG animations to run. We intentionally do not grant same-origin,
  // forms, popups, or top-navigation permissions.
  return <div className={styles.inlineInteractive}><iframe title={scene.title} src={url} srcDoc={html} sandbox="allow-scripts" referrerPolicy="no-referrer" /></div>;
}

export function InlineChalkboard({ scene }: { scene: SceneView }) {
  const label = scene.type === "slide" ? "SLIDE" : scene.type === "quiz" ? "QUIZ" : scene.type === "interactive" ? "INTERACTIVE" : "SCENE";
  return (
    <figure className={styles.inlineChalkboard} aria-label={`Chalkboard Scene：${scene.title}`}>
      <figcaption><span>CHALKBOARD · {label}</span>{scene.title}</figcaption>
      {scene.type === "slide" ? <SlideCanvas scene={scene} highlightedElementId={null} /> : scene.type === "quiz" ? <ReadonlyQuiz scene={scene} /> : scene.type === "interactive" ? <ReadonlyInteractive scene={scene} /> : <div className={styles.inlineSceneUnsupported}>当前版本只读承载 {scene.type} Scene 内容。</div>}
    </figure>
  );
}
