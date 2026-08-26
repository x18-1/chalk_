"use client";

import { MessageCircle, MessagesSquare, Mic, Send, Users } from "lucide-react";

import styles from "../chalkboard.module.css";

export interface DiscussionParticipant {
  id: string;
  name: string;
  role: "teacher" | "agent" | "user";
}

export interface DiscussionDockProps {
  sceneIndex: number;
  actionIndex: number;
  actionCount: number;
  discussion: string;
  draft: string;
  reply: string;
  voiceStatus: string;
  isListening: boolean;
  participants?: readonly DiscussionParticipant[];
  onDraftChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onToggleVoice: () => void;
  onOpenChat: () => void;
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
  draft,
  reply,
  voiceStatus,
  isListening,
  participants = [],
  onDraftChange,
  onSubmit,
  onToggleVoice,
  onOpenChat,
}: DiscussionDockProps) {
  const teacher = participants.find((participant) => participant.role === "teacher") ?? { id: "teacher", name: "AI Teacher", role: "teacher" as const };
  const others = participants.filter((participant) => participant.role !== "teacher");
  const user = others.find((participant) => participant.role === "user") ?? { id: "user", name: "我", role: "user" as const };
  const agents = others.filter((participant) => participant.role === "agent");

  return (
    <section className={styles.discussionDock} aria-label="课堂讨论">
      <div className={styles.discussionHeader}>
        <div className={styles.discussionHeading}><MessageCircle size={16} /><strong>课堂讨论</strong><span>跟随老师的提问一起思考</span></div>
        <span className={styles.discussionPosition}>第 {sceneIndex + 1} 页 · {Math.min(actionIndex + 1, actionCount)} / {actionCount}</span>
      </div>
      <div className={styles.discussionMain}>
        <div className={styles.discussionConversation}>
          <div className={styles.discussionSpeaker}><ParticipantAvatar participant={teacher} /><div><strong>{teacher.name}</strong><span>老师</span></div></div>
          <div className={styles.discussionMessageCard}>
            {discussion ? <>
              <p>{discussion}</p>
              <div className={styles.discussionPrompt}><MessageCircle size={14} /><span>老师正在邀请大家讨论</span></div>
            </> : <p className={styles.discussionIdle}>本页没有主动讨论。需要追问时，可以从右侧 Chat 开始。</p>}
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
              <input value={draft} onChange={(event) => onDraftChange(event.target.value)} placeholder={isListening ? "正在听，请说出你的想法" : "写下你的回答"} aria-label="课堂讨论回答" maxLength={500} />
              <button type="submit" aria-label="提交课堂回答" title="提交课堂回答" disabled={!draft.trim()}><Send size={14} /></button>
            </form>
            <ParticipantAvatar participant={user} />
            <button className={styles.discussionChatButton} type="button" aria-label="打开课堂 Chat" title="打开课堂 Chat" onClick={onOpenChat}><MessagesSquare size={15} /></button>
          </div>
          {reply ? <p className={styles.discussionReplySaved}>已记录：{reply}</p> : null}
          {voiceStatus ? <span className={styles.voiceStatus} role="status">{voiceStatus}</span> : null}
        </div>
      </div>
    </section>
  );
}
