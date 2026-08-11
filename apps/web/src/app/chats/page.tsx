"use client";

import Link from "next/link";
import { ArrowRight, MessageCircle } from "lucide-react";
import { useState } from "react";

import { AppSidebar, defaultSidebarConversations } from "../../components/app-sidebar";
import styles from "./chats.module.css";

export default function ChatsPage() {
  const [conversations, setConversations] = useState(defaultSidebarConversations);

  function renameConversation(id: string, title: string) {
    setConversations((current) => current.map((conversation) => conversation.id === id ? { ...conversation, title } : conversation));
  }

  function deleteConversation(id: string) {
    setConversations((current) => current.filter((conversation) => conversation.id !== id));
  }

  return <main className={styles.page}>
    <AppSidebar activeSection="chats" conversations={conversations} onRenameConversation={renameConversation} onDeleteConversation={deleteConversation} />
    <section className={styles.content} aria-labelledby="chats-title">
      <div className={styles.contentInner}>
        <header className={styles.header}>
          <div><span className={styles.kicker}>Chalk</span><h1 id="chats-title">Chats</h1><p>所有对话</p></div>
          <span className={styles.count}>{conversations.length}</span>
        </header>
        <div className={styles.conversationRows}>
          {conversations.length ? conversations.map((conversation) => <Link className={styles.conversationRow} href={`/chat?conversation=${conversation.id}`} key={conversation.id}>
            <span className={styles.rowIcon}><MessageCircle size={17} /></span>
            <span className={styles.rowCopy}><strong>{conversation.title}</strong><small>数学对话</small></span>
            <ArrowRight size={16} className={styles.rowArrow} />
          </Link>) : <div className={styles.emptyState}><MessageCircle size={18} /><p>还没有对话</p><Link href="/chat?new=1">开始新对话</Link></div>}
        </div>
      </div>
    </section>
  </main>;
}
