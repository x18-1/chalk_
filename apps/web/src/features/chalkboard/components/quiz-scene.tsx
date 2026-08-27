"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, FileQuestion } from "lucide-react";
import type { QuizQuestion, SceneView } from "@chalk/chalkboard";
import type { QuizAttempt } from "../../../api";
import type { QuizAttemptSaveResult } from "../lib/classroom-client";
import styles from "../chalkboard.module.css";

export function QuizScene({
  scene,
  attempt,
  onSubmit,
}: {
  scene: SceneView;
  attempt: QuizAttempt | null;
  onSubmit(answers: Record<string, string[]>): Promise<QuizAttemptSaveResult>;
}) {
  const [answers, setAnswers] = useState<Record<string, string[]>>(() => attempt?.answers ?? {});
  const [savedAttempt, setSavedAttempt] = useState<QuizAttempt | null>(attempt);
  const [submitted, setSubmitted] = useState(Boolean(attempt));
  const [validationMessage, setValidationMessage] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "conflict" | "offline" | "error">(attempt ? "saved" : "idle");
  const questions = (Array.isArray(scene.content.questions) ? scene.content.questions : []) as QuizQuestion[];

  useEffect(() => {
    setAnswers(attempt?.answers ?? {});
    setSavedAttempt(attempt);
    setSubmitted(Boolean(attempt));
    setValidationMessage("");
    setSaveStatus(attempt ? "saved" : "idle");
  }, [attempt, scene.id]);

  const toggleAnswer = (question: QuizQuestion, value: string) => {
    setSubmitted(false);
    setValidationMessage("");
    setAnswers((current) => {
      const previous = current[question.id] ?? [];
      if (question.type === "single") return { ...current, [question.id]: [value] };
      return { ...current, [question.id]: previous.includes(value) ? previous.filter((item) => item !== value) : [...previous, value] };
    });
  };

  const changeShortAnswer = (questionId: string, value: string) => {
    setSubmitted(false);
    setValidationMessage("");
    setAnswers((current) => ({ ...current, [questionId]: [value] }));
  };

  const submit = async () => {
    const incomplete = questions.some((question) => !(answers[question.id] ?? []).some((value) => value.trim()));
    if (incomplete) {
      setValidationMessage("请先完成每一道题，再提交答案。");
      return;
    }
    setValidationMessage("");
    setSaveStatus("saving");
    try {
      const result = await onSubmit(answers);
      setSavedAttempt(result.quizAttempt);
      setAnswers(result.quizAttempt.answers);
      setSubmitted(true);
      setSaveStatus(result.status === "conflict" ? "conflict" : "saved");
    } catch {
      setSaveStatus(typeof navigator !== "undefined" && !navigator.onLine ? "offline" : "error");
    }
  };

  const scoredQuestions = questions.filter((question) => Array.isArray(question.answer));
  const resultByQuestion = useMemo(
    () => new Map(savedAttempt?.results.map((result) => [result.questionId, result]) ?? []),
    [savedAttempt],
  );
  const hasScore = savedAttempt?.results.some((result) => result.correct !== null) ?? false;
  const feedback = saveStatus === "conflict"
    ? "检测到其他设备保存了更新答案，已恢复最新答案。"
    : saveStatus === "offline"
      ? "当前离线，答案尚未保存。恢复网络后可以再次提交。"
      : saveStatus === "error"
        ? "答案暂时没有保存成功，填写内容仍保留，请重试。"
        : "";

  return (
    <div className={styles.quizPanel}>
      <div className={styles.quizIntro}>
        <span className={styles.panelKicker}>CHECKPOINT</span>
        <h2>用自己的话检查理解</h2>
        <p>先独立作答，再查看系统给出的讲解依据。</p>
        {questions.length ? <span className={styles.quizCount}>共 {questions.length} 题 · {scoredQuestions.length ? `可自动评分 ${scoredQuestions.length} 题` : "提交后查看讲解"}</span> : null}
      </div>
      {questions.length ? <div className={styles.questionList}>
        {questions.map((question, index) => {
          const correct = submitted ? resultByQuestion.get(question.id)?.correct : null;
          return (
            <section className={styles.question} key={question.id}>
              <div className={styles.questionHeader}><span>{String(index + 1).padStart(2, "0")}</span><strong>{question.points ?? 1} 分</strong></div>
              <h3>{question.question}</h3>
              {question.type === "short_answer" ? (
                <textarea className={styles.answerText} value={answers[question.id]?.[0] ?? ""} onChange={(event) => changeShortAnswer(question.id, event.target.value)} placeholder="写下你的推理步骤" aria-label={question.question} />
              ) : (
                <div className={styles.optionList}>
                  {(question.options ?? []).map((option) => {
                    const checked = answers[question.id]?.includes(option.value) ?? false;
                    return (
                      <label className={`${styles.option} ${checked ? styles.optionChecked : ""}`} key={option.value}>
                        <input type={question.type === "single" ? "radio" : "checkbox"} name={question.id} checked={checked} onChange={() => toggleAnswer(question, option.value)} />
                        <span className={styles.optionKey}>{option.value}</span><span>{option.label}</span>
                      </label>
                    );
                  })}
                </div>
              )}
              {submitted && question.analysis ? <p className={`${styles.analysis} ${correct ? styles.analysisCorrect : ""}`}>{correct ? "回答正确。" : "讲解："}{question.analysis}</p> : null}
            </section>
          );
        })}
      </div> : <div className={styles.quizEmpty}><FileQuestion size={22} /><strong>这节暂时没有题目</strong><span>可以继续播放后面的课堂内容。</span></div>}
      {validationMessage ? <p className={styles.quizValidation} role="alert">{validationMessage}</p> : null}
      {feedback ? <p className={`${styles.quizSaveStatus} ${saveStatus === "offline" || saveStatus === "error" ? styles.quizSaveWarning : ""}`} role={saveStatus === "error" ? "alert" : "status"}>{feedback}</p> : null}
      {submitted && savedAttempt ? <div className={styles.quizResult} role="status"><Check size={15} /><strong>{hasScore ? `已完成 · 得分 ${savedAttempt.score} / ${savedAttempt.maxScore}` : "答案已提交"}</strong><span>{saveStatus === "conflict" ? "当前显示已保存的最新答案。" : "已保存，可以修改后再次提交。"}</span></div> : null}
      {questions.length ? <button className={styles.submitButton} type="button" onClick={() => void submit()} disabled={saveStatus === "saving"}><Check size={15} />{saveStatus === "saving" ? "正在提交…" : submitted ? "重新提交" : "提交答案"}</button> : null}
    </div>
  );
}
