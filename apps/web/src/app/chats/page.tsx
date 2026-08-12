"use client";

import Link from "next/link";
import { ArrowRight, MessageCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { AppSidebar, defaultSidebarConversations } from "../../components/app-sidebar";
import { apiJson, conversationGroup, formatConversationTitle, type Conversation } from "../../lib/client/api";
import styles from "./chats.module.css";

export default function ChatsPage() {
  const [conversations, setConversations] = useState<typeof defaultSidebarConversations>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiJson<{ conversations: Conversation[] }>("/api/chat").then((data) => {
      setConversations(data.conversations.map((conversation) => ({ id: conversation.id, title: formatConversationTitle(conversation), group: conversationGroup(conversation.updatedAt) })));
    }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "加载对话失败")).finally(() => setLoading(false));
  }, []);

  function renameConversation(id: string, title: string) {
    void apiJson(`/api/chat/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }).then(() => setConversations((current) => current.map((conversation) => conversation.id === id ? { ...conversation, title } : conversation))).catch((renameError) => setError(renameError instanceof Error ? renameError.message : "重命名失败"));
  }

  function deleteConversation(id: string) {
    void apiJson(`/api/chat/${id}`, { method: "DELETE" }).then(() => setConversations((current) => current.filter((conversation) => conversation.id !== id))).catch((deleteError) => setError(deleteError instanceof Error ? deleteError.message : "删除失败"));
  }

  return <main className={styles.page}>
    <AppSidebar activeSection="chats" conversations={conversations} onRenameConversation={renameConversation} onDeleteConversation={deleteConversation} />
    <section className={styles.content} aria-labelledby="chats-title">
      <div className={styles.contentInner}>
        <header className={styles.header}>
          <div><span className={styles.kicker}>Chalk</span><h1 id="chats-title">Chats</h1><p>所有对话</p></div>
          <span className={styles.count}>{conversations.length}</span>
        </header>
        {error && <p role="alert">{error}</p>}
        <div className={styles.conversationRows}>
          {loading ? <div className={styles.emptyState}><p>正在加载对话…</p></div> : conversations.length ? conversations.map((conversation) => <Link className={styles.conversationRow} href={`/chat?conversation=${conversation.id}`} key={conversation.id}>
            <span className={styles.rowIcon}><MessageCircle size={17} /></span>
            <span className={styles.rowCopy}><strong>{conversation.title}</strong><small>数学对话</small></span>
            <ArrowRight size={16} className={styles.rowArrow} />
          </Link>) : <div className={styles.emptyState}><MessageCircle size={18} /><p>还没有对话</p><Link href="/chat?new=1">开始新对话</Link></div>}
        </div>
      </div>
    </section>
  </main>;
}
