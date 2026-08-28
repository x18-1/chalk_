"use client";

import { useEffect, useRef } from "react";
import { Check, LoaderCircle, MessageCircleQuestion, Mic, Pause, Play, RotateCcw, Send, Square, UsersRound, Volume2 } from "lucide-react";
import type { ClassroomDiscussionMessage, ClassroomDiscussionParticipant } from "../../../api";
import type { ClassroomDiscussionUiStatus } from "../hooks/use-classroom-discussion";
import type { DiscussionSpeechState } from "../hooks/use-discussion-speech";
import styles from "../chalkboard.module.css";

export function ChatPanel({
  sceneIndex,
  actionIndex,
  actionCount,
  discussion,
  participants,
  messages,
  status,
  error,
  canStart,
  canComplete,
  draft,
  voiceStatus,
  speechState,
  isListening,
  onDraftChange,
  onSend,
  onToggleVoice,
  onStart,
  onStop,
  onComplete,
  onRetry,
  onPauseSpeech,
  onResumeSpeech,
}: {
  sceneIndex: number;
  actionIndex: number;
  actionCount: number;
  discussion: string;
  participants: ClassroomDiscussionParticipant[];
  messages: ClassroomDiscussionMessage[];
  status: ClassroomDiscussionUiStatus;
  error: string | null;
  canStart: boolean;
  canComplete: boolean;
  draft: string;
  voiceStatus: string;
  speechState: DiscussionSpeechState;
  isListening: boolean;
  onDraftChange: (value: string) => void;
  onSend: (message: string) => void;
  onToggleVoice: () => void;
  onStart: () => void;
  onStop: () => void;
  onComplete: () => void;
  onRetry: () => void;
  onPauseSpeech: () => void;
  onResumeSpeech: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const working = status === "streaming" || status === "stopping" || status === "completing";

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const sendMessage = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onDraftChange("");
    onSend(text);
  };

  return (
    <div className={styles.chatContent} role="region" aria-label="课堂讨论">
      <div className={styles.chatIntro}>
        <div className={styles.chatIntroHeader}>
          <span><MessageCircleQuestion size={16} /><strong>课堂讨论</strong></span>
          <span className={styles.chatPosition}>S{sceneIndex + 1} · A{Math.min(actionIndex + 1, Math.max(actionCount, 1))}/{Math.max(actionCount, 1)}</span>
          {canComplete ? <button type="button" onClick={onComplete} disabled={working}><Check size={12} />结束讨论</button> : null}
        </div>
        <p>由老师、助教和课堂同伴共同参与。每位成员会等上一位说完后再发言。</p>
        <div className={styles.chatParticipants} role="group" aria-label="本节课参与者" tabIndex={0}>
          <UsersRound size={13} />
          {participants.map((participant) => <span key={participant.id} title={participant.persona}>
            <i aria-hidden="true">{participant.name.trim().slice(0, 1)}</i>
            <b>{participant.name}</b>
            <small>{participant.role === "teacher" ? "老师" : participant.role === "assistant" ? "助教" : "同伴"}</small>
          </span>)}
        </div>
        {speechState.phase !== "idle" ? <div className={styles.chatSpeechStatus} role="status" aria-live="polite">
          <Volume2 size={13} />
          <span><strong>{speechState.speakerName ?? "课堂成员"}</strong>{speechState.phase === "paused" ? "的讲解已暂停" : "正在讲解"}</span>
          {speechState.queuedSegments > 0 ? <small>后面还有 {speechState.queuedSegments} 段</small> : null}
          <button
            type="button"
            onClick={speechState.phase === "paused" ? onResumeSpeech : onPauseSpeech}
            aria-label={speechState.phase === "paused" ? "继续讨论语音" : "暂停讨论语音"}
            title={speechState.phase === "paused" ? "继续讨论语音" : "暂停讨论语音"}
          >{speechState.phase === "paused" ? <Play size={11} /> : <Pause size={11} />}</button>
        </div> : null}
      </div>
      <div ref={listRef} className={styles.chatMessageList} aria-label="讨论记录">
        {discussion ? <div className={`${styles.chatMessage} ${styles.chatMessagePrompt}`}><span className={styles.chatPromptIcon}>?</span><div><small>当前议题</small><p>{discussion}</p>{canStart ? <button type="button" className={styles.chatStartButton} onClick={onStart} disabled={working}>开始讨论</button> : null}</div></div> : <p className={styles.chatEmpty}>你可以随时提问；当课件发起讨论时，议题也会出现在这里。</p>}
        {messages.map((message) => message.sender === "student"
          ? <div className={`${styles.chatMessage} ${styles.chatMessageStudent}`} key={message.id}><p>{message.content}</p><span className={styles.studentAvatarSmall}>我</span></div>
          : <div className={`${styles.chatMessage} ${styles.chatMessageAgent}`} key={message.id} data-message-status={message.status}>
              <span className={styles.agentAvatarSmall}>{message.agentName?.trim().slice(0, 1) || "课"}</span>
              <div><strong>{message.agentName ?? "课堂成员"}<small>{message.agentRole === "teacher" ? "老师" : message.agentRole === "assistant" ? "助教" : "课堂同伴"}</small></strong><p>{message.content || "正在组织回答…"}{message.status === "streaming" ? <span className={styles.streamingCaret} aria-hidden="true" /> : null}</p>{message.status === "interrupted" ? <small>这条回答被中断，已保留可见内容。</small> : null}</div>
            </div>)}
        {status === "restoring" ? <p className={styles.chatActivity}><LoaderCircle className={styles.importSpinner} size={13} />正在恢复讨论记录…</p> : null}
      </div>
      {error ? <div className={styles.chatError} role="alert"><span>{error}</span><button type="button" onClick={onRetry}><RotateCcw size={12} />重试</button></div> : null}
      {voiceStatus ? <span className={styles.chatVoiceStatus} role="status">{voiceStatus}</span> : null}
      <form className={styles.chatComposer} aria-label="课堂讨论输入区" onSubmit={sendMessage}>
        <button className={isListening ? styles.chatMicActive : ""} type="button" aria-label={isListening ? "停止语音输入" : "语音输入"} title={isListening ? "停止语音输入" : "语音输入"} onClick={onToggleVoice} disabled={working}><Mic size={14} /></button>
        <input type="text" value={draft} onChange={(event) => onDraftChange(event.target.value)} placeholder={working ? "课堂成员正在回答" : "写下你想追问的地方"} aria-label="写下你想追问的地方" maxLength={2000} disabled={working} />
        {working
          ? <button type="button" aria-label="停止这一轮回答" title="停止这一轮回答" onClick={onStop}><Square size={13} /></button>
          : <button type="submit" aria-label="发送" title="发送" disabled={!draft.trim()}><Send size={15} /></button>}
      </form>
    </div>
  );
}
