"use client";

import { useState } from "react";
import { Check, FileQuestion } from "lucide-react";
import type { QuizQuestion, SceneView } from "@chalk/chalkboard";
import styles from "../../../app/chalkboard/chalkboard.module.css";

export function QuizScene({ scene }: { scene: SceneView }) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [submitted, setSubmitted] = useState(false);
  const [validationMessage, setValidationMessage] = useState("");
  const questions = (Array.isArray(scene.content.questions) ? scene.content.questions : []) as QuizQuestion[];

  const toggleAnswer = (question: QuizQuestion, value: string) => {
    setSubmitted(false);
    setValidationMessage("");
    setAnswers((current) => {
      const previous = current[question.id] ?? [];
      if (question.type === "single") return { ...current, [question.id]: [value] };
      return { ...current, [question.id]: previous.includes(value) ? previous.filter((item) => item !== value) : [...previous, value] };
    });
  };

  const submit = () => {
    const incomplete = questions.some((question) => !(answers[question.id] ?? []).some((value) => value.trim()));
    if (incomplete) {
      setValidationMessage("请先完成每一道题，再提交答案。");
      return;
    }
    setValidationMessage("");
    setSubmitted(true);
  };

  const scoredQuestions = questions.filter((question) => Array.isArray(question.answer));
  const score = submitted
    ? scoredQuestions.reduce((total, question) => {
      const actual = [...(answers[question.id] ?? [])].sort().join();
      const expected = [...(question.answer ?? [])].sort().join();
      return total + (actual === expected ? question.points ?? 1 : 0);
    }, 0)
    : null;

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
          const correct = submitted && question.answer && [...(answers[question.id] ?? [])].sort().join() === [...question.answer].sort().join();
          return (
            <section className={styles.question} key={question.id}>
              <div className={styles.questionHeader}><span>{String(index + 1).padStart(2, "0")}</span><strong>{question.points ?? 1} 分</strong></div>
              <h3>{question.question}</h3>
              {question.type === "short_answer" ? (
                <textarea className={styles.answerText} value={answers[question.id]?.[0] ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: [event.target.value] }))} placeholder="写下你的推理步骤" aria-label={question.question} />
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
      {submitted ? <div className={styles.quizResult} role="status"><Check size={15} /><strong>{score === null ? "答案已提交" : `已完成 · 得分 ${score}`}</strong><span>可以修改答案后再次提交。</span></div> : null}
      {questions.length ? <button className={styles.submitButton} type="button" onClick={submit}><Check size={15} />{submitted ? "重新提交" : "提交答案"}</button> : null}
    </div>
  );
}
