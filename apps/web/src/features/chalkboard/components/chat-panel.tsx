"use client";

import { useState } from "react";
import { MessagesSquare, Send } from "lucide-react";
import styles from "../chalkboard.module.css";

type ChatMessage = { id: string; role: "student" | "system"; text: string };

export function ChatPanel({ discussion }: { discussion: string }) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const sendMessage = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setMessages((current) => [...current, { id: `${Date.now()}-${current.length}`, role: "student", text }]);
    setDraft("");
  };

  return (
    <div className={styles.chatContent}>
      <div className={styles.chatIntro}><MessagesSquare size={16} /><strong>课堂 Chat</strong><p>记录你想追问的地方。消息暂时保存在本次课堂页面。</p></div>
      <div className={styles.chatMessageList} aria-live="polite">
        {discussion ? <div className={`${styles.chatMessage} ${styles.chatMessagePrompt}`}><span className={styles.chatPromptIcon}>?</span><p>{discussion}</p></div> : <p className={styles.chatEmpty}>当老师发起课堂提问时，这里会出现讨论内容。</p>}
        {messages.map((message) => <div className={`${styles.chatMessage} ${styles.chatMessageStudent}`} key={message.id}><span className={styles.studentAvatarSmall}>我</span><p>{message.text}</p></div>)}
      </div>
      <form className={styles.chatComposer} aria-label="课堂 Chat 输入区" onSubmit={sendMessage}>
        <input type="text" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="写下你想追问的地方" aria-label="写下你想追问的地方" maxLength={500} />
        <button type="submit" aria-label="发送" title="发送" disabled={!draft.trim()}><Send size={15} /></button>
      </form>
    </div>
  );
}
