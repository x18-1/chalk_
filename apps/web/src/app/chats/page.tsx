"use client";

import Link from "next/link";
import { ArrowRight, MessageCircle, PanelTop } from "lucide-react";
import { useEffect, useState } from "react";

import { AppSidebar, defaultSidebarConversations } from "../../components/app-sidebar";
import { chatApi } from "../../api";
import { conversationGroup, formatConversationTitle } from "../../lib/conversations";
import { loadChalkboardHistory, type ChalkboardHistoryItem } from "../../features/chalkboard/lib/history";
import styles from "./chats.module.css";

export default function ChatsPage() {
  const [conversations, setConversations] = useState<typeof defaultSidebarConversations>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chalkboards, setChalkboards] = useState<ChalkboardHistoryItem[]>([]);

  useEffect(() => {
    setChalkboards(loadChalkboardHistory());
    void chatApi.list().then((data) => {
      setConversations(data.conversations.map((conversation) => ({ id: conversation.id, title: formatConversationTitle(conversation), group: conversationGroup(conversation.updatedAt) })));
    }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "加载对话失败")).finally(() => setLoading(false));
  }, []);

  function renameConversation(id: string, title: string) {
    void chatApi.rename(id, title).then(() => setConversations((current) => current.map((conversation) => conversation.id === id ? { ...conversation, title } : conversation))).catch((renameError) => setError(renameError instanceof Error ? renameError.message : "重命名失败"));
  }

  function deleteConversation(id: string) {
    void chatApi.delete(id).then(() => setConversations((current) => current.filter((conversation) => conversation.id !== id))).catch((deleteError) => setError(deleteError instanceof Error ? deleteError.message : "删除失败"));
  }

  return <main className={styles.page}>
    <AppSidebar activeSection="chats" historyMode="all" conversations={conversations} chalkboards={chalkboards} onRenameConversation={renameConversation} onDeleteConversation={deleteConversation} />
    <section className={styles.content} aria-labelledby="chats-title">
      <div className={styles.contentInner}>
        <header className={styles.header}>
          <div><span className={styles.kicker}>Chalk</span><h1 id="chats-title">Chats</h1><p>对话和课堂记录</p></div>
          <span className={styles.count}>{conversations.length + chalkboards.length}</span>
        </header>
        {error && <p role="alert">{error}</p>}
        <div className={styles.conversationRows}>
          {loading ? <div className={styles.emptyState}><p>正在加载对话…</p></div> : conversations.length ? conversations.map((conversation) => <Link className={styles.conversationRow} href={`/chat?conversation=${conversation.id}`} key={conversation.id}>
            <span className={styles.rowIcon}><MessageCircle size={17} /></span>
            <span className={styles.rowCopy}><strong>{conversation.title}</strong><small>数学对话</small></span>
            <ArrowRight size={16} className={styles.rowArrow} />
          </Link>) : <div className={styles.emptyState}><MessageCircle size={18} /><p>还没有对话</p><Link href="/chat?new=1">开始新对话</Link></div>}
        </div>
        {chalkboards.length ? <section className={styles.classroomRows} aria-labelledby="classroom-history-title">
          <header className={styles.classroomRowsHeader}><h2 id="classroom-history-title">课堂历史</h2><span>{chalkboards.length}</span></header>
          {chalkboards.map((classroom) => <Link className={styles.conversationRow} href={`/chalkboard?id=${encodeURIComponent(classroom.id)}`} key={classroom.id}>
            <span className={styles.rowIcon}><PanelTop size={17} /></span>
            <span className={styles.rowCopy}><strong>{classroom.title}</strong><small>{classroom.sceneId ? "继续上次课堂" : "已打开课堂"}</small></span>
            <ArrowRight size={16} className={styles.rowArrow} />
          </Link>)}
        </section> : null}
      </div>
    </section>
  </main>;
}
