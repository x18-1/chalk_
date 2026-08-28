"use client";

import { CirclePlay, LoaderCircle, MessageCircle, MessagesSquare, Mic, RotateCcw, Send, Square, Users } from "lucide-react";

import type { ClassroomDiscussionMessage } from "../../../api";
import type { ClassroomDiscussionUiStatus } from "../hooks/use-classroom-discussion";

import styles from "../chalkboard.module.css";

export interface DiscussionParticipant {
  id: string;
  name: string;
  role: "teacher" | "assistant" | "student" | "user";
}

export interface DiscussionDockProps {
  sceneIndex: number;
  actionIndex: number;
  actionCount: number;
  discussion: string;
  message: ClassroomDiscussionMessage | null;
  draft: string;
  voiceStatus: string;
  isListening: boolean;
  status: ClassroomDiscussionUiStatus;
  error: string | null;
  canStart: boolean;
  participants?: readonly DiscussionParticipant[];
  onDraftChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onToggleVoice: () => void;
  onOpenChat: () => void;
  onStart: () => void;
  onStop: () => void;
  onRetry: () => void;
}

function ParticipantAvatar({ participant }: { participant: DiscussionParticipant }) {
  const initials = participant.role === "user" ? "我" : participant.name.trim().slice(0, 1) || "课";
  const palette = ["clay", "ink", "sage", "ochre", "stone", "brick"] as const;
  const variant = participant.role === "user"
    ? "user"
    : palette[[...participant.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % palette.length];
  return <div className={styles.participantAvatar} data-avatar-variant={variant} title={participant.name} aria-label={`${participant.name}头像`}><span>{initials}</span></div>;
}

export function DiscussionDock({
  sceneIndex,
  actionIndex,
  actionCount,
  discussion,
  message,
  draft,
  voiceStatus,
  isListening,
  status,
  error,
  canStart,
  participants = [],
  onDraftChange,
  onSubmit,
  onToggleVoice,
  onOpenChat,
  onStart,
  onStop,
  onRetry,
}: DiscussionDockProps) {
  const teacher = participants.find((participant) => participant.role === "teacher") ?? { id: "teacher", name: "AI Teacher", role: "teacher" as const };
  const others = participants.filter((participant) => participant.role !== "teacher");
  const user = others.find((participant) => participant.role === "user") ?? { id: "user", name: "我", role: "user" as const };
  const agents = others.filter((participant) => participant.role !== "user");
  const speaker = message?.agentId
    ? participants.find((participant) => participant.id === message.agentId) ?? {
        id: message.agentId,
        name: message.agentName ?? "课堂成员",
        role: message.agentRole === "assistant" ? "assistant" as const : message.agentRole === "student" ? "student" as const : "teacher" as const,
      }
    : teacher;
  const working = status === "streaming" || status === "stopping" || status === "completing";

  return (
    <section className={styles.discussionDock} aria-label="课堂讨论">
      <div className={styles.discussionHeader}>
        <div className={styles.discussionHeading}><MessageCircle size={16} /><strong>课堂讨论</strong><span>跟随老师的提问一起思考</span></div>
        <span className={styles.discussionPosition}>第 {sceneIndex + 1} 页 · {Math.min(actionIndex + 1, actionCount)} / {actionCount}</span>
      </div>
      <div className={styles.discussionMain}>
        <div className={styles.discussionConversation}>
          <div className={styles.discussionSpeaker}><ParticipantAvatar participant={speaker} /><div><strong>{speaker.name}</strong><span>{speaker.role === "teacher" ? "老师" : speaker.role === "assistant" ? "助教" : "课堂同伴"}</span></div></div>
          <div className={styles.discussionMessageCard}>
            {message?.content ? <p>{message.content}{message.status === "streaming" ? <span className={styles.streamingCaret} aria-hidden="true" /> : null}</p>
              : discussion ? <><p>{discussion}</p>{canStart
                ? <button className={`${styles.discussionPrompt} ${styles.discussionPromptButton}`} type="button" onClick={onStart}><CirclePlay size={13} /><span>开始讨论</span></button>
                : <div className={styles.discussionPrompt}><MessageCircle size={14} /><span>老师正在邀请大家讨论</span></div>}</>
                : <p className={styles.discussionIdle}>本页没有主动讨论。你仍然可以直接向课堂成员追问。</p>}
            {status === "restoring" ? <span className={styles.discussionActivity}><LoaderCircle className={styles.importSpinner} size={12} />正在恢复讨论记录…</span> : null}
          </div>
        </div>
        <div className={styles.participantRail} aria-label="课堂成员">
          <div className={styles.participantRailHeader}><span><Users size={13} />课堂成员</span><div className={styles.agentAvatarRow}>
            {agents.map((participant) => <ParticipantAvatar key={participant.id} participant={participant} />)}
            {!agents.length ? <span className={styles.agentHint}>等待同学加入</span> : null}
          </div></div>
          <div className={styles.discussionComposerRow}>
            <form className={styles.discussionReply} onSubmit={onSubmit}>
              <button className={`${styles.inputModeButton} ${isListening ? styles.inputModeButtonActive : ""}`} type="button" aria-label={isListening ? "停止语音输入" : "语音输入"} title={isListening ? "停止语音输入" : "语音输入"} onClick={onToggleVoice}><Mic size={14} /></button>
              <input value={draft} onChange={(event) => onDraftChange(event.target.value)} placeholder={isListening ? "正在听，请说出你的想法" : working ? "课堂成员正在回答" : "写下你的回答或追问"} aria-label="课堂讨论回答" maxLength={2000} disabled={working} />
              {working
                ? <button type="button" aria-label="停止这一轮回答" title="停止这一轮回答" onClick={onStop}><Square size={13} /></button>
                : <button type="submit" aria-label="提交课堂回答" title="提交课堂回答" disabled={!draft.trim()}><Send size={14} /></button>}
            </form>
            <ParticipantAvatar participant={user} />
            <button className={styles.discussionChatButton} type="button" aria-label="打开课堂 Chat" title="打开课堂 Chat" onClick={onOpenChat}><MessagesSquare size={15} /></button>
          </div>
          {working ? <p className={styles.discussionReplySaved} role="status"><LoaderCircle className={styles.importSpinner} size={11} />{status === "stopping" ? "正在停止这一轮…" : status === "completing" ? "正在结束讨论…" : "课堂成员正在接力回答…"}</p> : null}
          {error ? <p className={styles.discussionError} role="alert"><span>{error}</span><button type="button" onClick={onRetry}><RotateCcw size={11} />恢复记录</button></p> : null}
          {voiceStatus ? <span className={styles.voiceStatus} role="status">{voiceStatus}</span> : null}
        </div>
      </div>
    </section>
  );
}
