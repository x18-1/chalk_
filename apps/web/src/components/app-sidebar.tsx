"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronRight,
  ChevronUp,
  CircleHelp,
  ListFilter,
  LoaderCircle,
  LogOut,
  MessageCircle,
  MoreHorizontal,
  PanelTop,
  Pencil,
  Settings2,
  SquarePen,
  Trash2,
} from "lucide-react";

import styles from "./app-sidebar.module.css";
import { SettingsDialog } from "./settings-dialog";
import { authApi } from "../api";

export type SidebarClassroom = {
  id: string;
  title: string;
  sceneId?: string;
  generation?: {
    stage: 'outline' | 'scene_content' | 'scene_actions' | 'media_tasks' | 'progressive';
    status: 'queued' | 'running' | 'completed' | 'failed' | 'aborted';
    draftStatus: string;
  };
};

export type ConversationGroup = "今天" | "昨天" | "过去 7 天" | "过去 30 天";

export type SidebarConversation = {
  id: string;
  title: string;
  group: ConversationGroup;
};

export const defaultSidebarConversations: SidebarConversation[] = [
  { id: "geometry", title: "为什么这里要作辅助线？", group: "今天" },
  { id: "fractions", title: "分数方程的检验", group: "昨天" },
  { id: "quadratic", title: "二次函数图像", group: "过去 7 天" },
  { id: "proof", title: "证明三角形全等", group: "过去 7 天" },
  { id: "vectors", title: "向量的数量积", group: "过去 30 天" },
];

const conversationGroupOrder: ConversationGroup[] = ["今天", "昨天", "过去 7 天", "过去 30 天"];

type AppSidebarProps = {
  activeSection?: "new" | "chats" | "chalkboard";
  /** Which records belong in the contextual history rail on this surface. */
  historyMode?: "chat" | "chalkboard" | "all";
  conversations?: SidebarConversation[];
  selectedConversationId?: string;
  runningConversationIds?: ReadonlySet<string>;
  onNewConversation?: () => void;
  onSelectConversation?: (id: string) => void;
  onRenameConversation?: (id: string, title: string) => void;
  onDeleteConversation?: (id: string) => void;
  chalkboards?: SidebarClassroom[];
  selectedChalkboardId?: string;
  onSelectChalkboard?: (id: string) => void;
};

type ConversationMenuPosition = {
  top: number;
  left: number;
};

export function AppSidebar({
  activeSection,
  historyMode = "chat",
  conversations: controlledConversations,
  selectedConversationId,
  runningConversationIds,
  onNewConversation,
  onSelectConversation,
  onRenameConversation,
  onDeleteConversation,
  chalkboards = [],
  selectedChalkboardId,
  onSelectChalkboard,
}: AppSidebarProps) {
  const [localConversations, setLocalConversations] = useState(defaultSidebarConversations);
  const [recentOpen, setRecentOpen] = useState(true);
  const [groupByTime, setGroupByTime] = useState(false);
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [openConversationMenu, setOpenConversationMenu] = useState<string | null>(null);
  const [conversationMenuPosition, setConversationMenuPosition] = useState<ConversationMenuPosition | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [renamingConversationId, setRenamingConversationId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const conversations = controlledConversations ?? localConversations;
  const pendingDeleteConversation = conversations.find((conversation) => conversation.id === pendingDeleteId);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target as Element).closest("[data-sidebar-menu]")) closeTransientMenus();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeTransientMenus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const conversationGroups = useMemo(() => {
    if (!groupByTime) return [{ group: null, items: conversations }];
    return conversationGroupOrder
      .map((group) => ({ group, items: conversations.filter((conversation) => conversation.group === group) }))
      .filter((section) => section.items.length);
  }, [conversations, groupByTime]);

  function closeTransientMenus() {
    setGroupMenuOpen(false);
    setUserMenuOpen(false);
    setOpenConversationMenu(null);
    setConversationMenuPosition(null);
    setPendingDeleteId(null);
  }

  function startRenameConversation(conversation: SidebarConversation) {
    setOpenConversationMenu(null);
    setPendingDeleteId(null);
    setRenamingConversationId(conversation.id);
    setRenameValue(conversation.title);
  }

  function commitRenameConversation(id: string) {
    const title = renameValue.trim();
    if (title) {
      if (onRenameConversation) onRenameConversation(id, title);
      else setLocalConversations((current) => current.map((conversation) => conversation.id === id ? { ...conversation, title } : conversation));
    }
    setRenamingConversationId(null);
    setRenameValue("");
  }

  function deleteConversation(id: string) {
    if (onDeleteConversation) onDeleteConversation(id);
    else setLocalConversations((current) => current.filter((conversation) => conversation.id !== id));
    setPendingDeleteId(null);
  }

  function selectConversation(id: string) {
    closeTransientMenus();
    onSelectConversation?.(id);
  }

  function toggleConversationMenu(id: string, button: HTMLButtonElement) {
    const opening = openConversationMenu !== id;
    if (opening) {
      const buttonRect = button.getBoundingClientRect();
      const menuHeight = 72;
      const menuWidth = 132;
      const gap = 4;
      const showAbove = window.innerHeight - buttonRect.bottom < menuHeight + gap && buttonRect.top >= menuHeight + gap;
      setConversationMenuPosition({
        top: Math.round(showAbove ? buttonRect.top - menuHeight - gap : buttonRect.bottom + gap),
        left: Math.round(Math.max(8, Math.min(window.innerWidth - menuWidth - 8, buttonRect.right - menuWidth))),
      });
    }
    setOpenConversationMenu(opening ? id : null);
    if (!opening) setConversationMenuPosition(null);
    setPendingDeleteId(null);
  }

  async function logout() {
    setUserMenuOpen(false);
    await authApi.logout().catch(() => undefined);
    window.location.assign("/login");
  }

  return <>
    <aside className={styles.sidebar} aria-label="主导航">
      <div className={styles.brand}><span className={styles.brandMark}>C</span><span>Chalk</span></div>

      {onNewConversation
        ? <button className={`${styles.newConversation} ${activeSection === "new" ? styles.activeNavItem : ""}`} type="button" onClick={() => { closeTransientMenus(); onNewConversation(); }}><SquarePen size={16} /><span>新建对话</span></button>
        : <Link className={`${styles.newConversation} ${activeSection === "new" ? styles.activeNavItem : ""}`} href="/chat?new=1"><SquarePen size={16} /><span>新建对话</span></Link>}

      <nav className={styles.primaryNav} aria-label="产品功能">
        <Link className={activeSection === "chats" ? styles.activeNavItem : ""} href="/chats"><MessageCircle size={16} /><span>Chats</span></Link>
        <Link className={activeSection === "chalkboard" ? styles.activeNavItem : ""} href="/chalkboard"><PanelTop size={16} /><span>Chalkboard</span></Link>
      </nav>

      {historyMode !== "chalkboard" ? <div className={styles.recentHeader}>
        <button className={styles.recentToggle} type="button" aria-expanded={recentOpen} onClick={() => { setRecentOpen((open) => !open); setGroupMenuOpen(false); }}><ChevronRight size={15} className={recentOpen ? styles.recentExpanded : ""} /><span>最近</span></button>
        <div className={styles.recentActions}>
          <button data-sidebar-menu className={`${styles.groupByButton} ${groupByTime ? styles.groupByActive : ""}`} type="button" aria-label="按时间分组" title="按时间分组" aria-expanded={groupMenuOpen} onClick={() => { setGroupMenuOpen((open) => !open); setUserMenuOpen(false); }}><ListFilter size={15} /></button>
          {groupMenuOpen && <div data-sidebar-menu className={styles.groupMenuPopover} role="menu">
            <button type="button" role="menuitemcheckbox" aria-checked={groupByTime} onClick={() => { setGroupByTime((active) => !active); setGroupMenuOpen(false); }}><span>按时间</span>{groupByTime && <Check size={14} />}</button>
          </div>}
        </div>
      </div> : null}

      {historyMode !== "chalkboard" && recentOpen && <nav className={styles.conversationList} aria-label="最近对话" onScroll={closeTransientMenus}>
        {conversationGroups.some((section) => section.items.length) ? conversationGroups.map(({ group, items }) => <section className={styles.conversationGroup} key={group ?? "all"}>
          {groupByTime && <h2>{group}</h2>}
          {items.map((conversation) => <div key={conversation.id} className={`${styles.conversationItem} ${selectedConversationId === conversation.id ? styles.selectedConversation : ""}`}>
            {renamingConversationId === conversation.id
              ? <input className={styles.conversationRename} value={renameValue} autoFocus aria-label="重命名会话" onChange={(event) => setRenameValue(event.target.value)} onBlur={() => commitRenameConversation(conversation.id)} onKeyDown={(event) => { if (event.key === "Enter") commitRenameConversation(conversation.id); if (event.key === "Escape") { setRenamingConversationId(null); setRenameValue(""); } }} />
              : onSelectConversation
                ? <button className={styles.conversationSelect} type="button" aria-current={selectedConversationId === conversation.id ? "page" : undefined} onClick={() => selectConversation(conversation.id)}><strong>{conversation.title}</strong>{runningConversationIds?.has(conversation.id) && <small className={styles.conversationRunning}><LoaderCircle size={11} />正在回答</small>}</button>
                : <Link className={styles.conversationSelect} href={`/chat?conversation=${conversation.id}`}><strong>{conversation.title}</strong></Link>}
            <button data-sidebar-menu className={styles.conversationMenu} type="button" aria-label={`${conversation.title} 的更多操作`} title="更多操作" aria-expanded={openConversationMenu === conversation.id} onClick={(event) => toggleConversationMenu(conversation.id, event.currentTarget)}><MoreHorizontal size={15} /></button>
            {openConversationMenu === conversation.id && conversationMenuPosition && <div data-sidebar-menu className={styles.conversationMenuPopover} style={conversationMenuPosition} role="menu"><button type="button" role="menuitem" onClick={() => startRenameConversation(conversation)}><Pencil size={14} />重命名</button><button type="button" role="menuitem" onClick={() => { setOpenConversationMenu(null); setConversationMenuPosition(null); setPendingDeleteId(conversation.id); }}><Trash2 size={14} />删除</button></div>}
          </div>)}
        </section>) : <p className={styles.emptyConversations}>暂无会话</p>}
      </nav>}

      {historyMode !== "chat" && recentOpen && chalkboards.length > 0 && <section className={styles.chalkboardHistory} aria-label="最近课堂">
        <div className={styles.chalkboardHistoryHeading}><span>最近课堂</span><small>{chalkboards.length}</small></div>
        <nav className={styles.chalkboardHistoryList} aria-label="课堂记录">
          {chalkboards.map((classroom) => <Link
            key={classroom.id}
            className={`${styles.chalkboardHistoryItem} ${selectedChalkboardId === classroom.id ? styles.chalkboardHistoryItemActive : ""}`}
            href={`/chalkboard?id=${encodeURIComponent(classroom.id)}`}
            aria-current={selectedChalkboardId === classroom.id ? "page" : undefined}
            onClick={() => onSelectChalkboard?.(classroom.id)}
          >
            <PanelTop size={14} />
            <span><strong>{classroom.title}</strong><small>{classroomStatusLabel(classroom)}</small></span>
          </Link>)}
        </nav>
      </section>}

      <div className={styles.userArea}>
        {userMenuOpen && <div data-sidebar-menu className={styles.userMenu} role="menu">
          <button type="button" role="menuitem" onClick={() => { setUserMenuOpen(false); setSettingsOpen(true); }}><Settings2 size={16} /><span>设置</span></button>
          <button type="button" role="menuitem" disabled title="帮助与反馈暂不可用"><CircleHelp size={16} /><span>帮助与反馈</span></button>
          <button type="button" role="menuitem" onClick={() => void logout()}><LogOut size={16} /><span>退出登录</span></button>
        </div>}
        <button data-sidebar-menu className={styles.userButton} type="button" aria-expanded={userMenuOpen} aria-label="打开用户菜单" onClick={() => { setUserMenuOpen((open) => !open); setGroupMenuOpen(false); }}>
          <span className={styles.avatar}>林</span>
          <span className={styles.userCopy}><strong>林同学</strong><small>自学空间</small></span>
          <ChevronUp size={16} className={userMenuOpen ? styles.userChevronOpen : ""} />
        </button>
      </div>
    </aside>
    {pendingDeleteConversation && createPortal(<div className={styles.deleteConfirmBackdrop} onPointerDown={(event) => { if (event.target === event.currentTarget) setPendingDeleteId(null); }}><section data-sidebar-menu className={styles.deleteConfirm} role="dialog" aria-modal="true" aria-labelledby="delete-conversation-title" aria-describedby="delete-conversation-description"><strong id="delete-conversation-title">删除这段对话？</strong><p id="delete-conversation-description">删除后，对话记录将无法恢复。</p><div className={styles.deleteConfirmActions}><button type="button" onClick={() => setPendingDeleteId(null)}>取消</button><button className={styles.deleteConfirmDanger} type="button" onClick={() => deleteConversation(pendingDeleteConversation.id)}>删除</button></div></section></div>, document.body)}
    {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
  </>;
}

function classroomStatusLabel(classroom: SidebarClassroom) {
  if (!classroom.generation) return classroom.sceneId ? "继续上次课堂" : "已完成课堂";
  if (classroom.generation.status === "failed") return "生成暂停 · 点击查看";
  if (classroom.generation.status === "aborted") return "已停止 · 点击查看";
  if (classroom.generation.stage === "outline") {
    return classroom.generation.status === "completed" ? "大纲等待确认" : "正在生成大纲";
  }
  if (classroom.generation.draftStatus === "publishing") return "正在发布课堂";
  if (classroom.generation.draftStatus === "media_ready") return "课堂已生成 · 待发布";
  if (classroom.generation.draftStatus === "preview_ready") {
    return "可开始 · 其余生成中";
  }
  return "正在生成首幕";
}
