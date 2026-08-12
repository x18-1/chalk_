"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  ChevronUp,
  CircleHelp,
  ListFilter,
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
  activeSection?: "chats" | "chalkboard";
  conversations?: SidebarConversation[];
  selectedConversationId?: string;
  onNewConversation?: () => void;
  onSelectConversation?: (id: string) => void;
  onRenameConversation?: (id: string, title: string) => void;
  onDeleteConversation?: (id: string) => void;
};

export function AppSidebar({
  activeSection,
  conversations: controlledConversations,
  selectedConversationId,
  onNewConversation,
  onSelectConversation,
  onRenameConversation,
  onDeleteConversation,
}: AppSidebarProps) {
  const [localConversations, setLocalConversations] = useState(defaultSidebarConversations);
  const [recentOpen, setRecentOpen] = useState(true);
  const [groupByTime, setGroupByTime] = useState(false);
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [openConversationMenu, setOpenConversationMenu] = useState<string | null>(null);
  const [conversationMenuAbove, setConversationMenuAbove] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [renamingConversationId, setRenamingConversationId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const conversations = controlledConversations ?? localConversations;

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
      const list = button.closest('[aria-label="最近对话"]');
      const buttonRect = button.getBoundingClientRect();
      const listRect = list?.getBoundingClientRect();
      const menuHeight = 72;
      setConversationMenuAbove(Boolean(
        listRect &&
        listRect.bottom - buttonRect.bottom < menuHeight &&
        buttonRect.top - listRect.top >= menuHeight
      ));
    }
    setOpenConversationMenu(opening ? id : null);
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
        ? <button className={styles.newConversation} type="button" onClick={() => { closeTransientMenus(); onNewConversation(); }}><SquarePen size={16} /><span>新建对话</span></button>
        : <Link className={styles.newConversation} href="/chat?new=1"><SquarePen size={16} /><span>新建对话</span></Link>}

      <nav className={styles.primaryNav} aria-label="产品功能">
        <Link className={activeSection === "chats" ? styles.activeNavItem : ""} href="/chats"><MessageCircle size={16} /><span>Chats</span></Link>
        <Link className={activeSection === "chalkboard" ? styles.activeNavItem : ""} href="/chalkboard"><PanelTop size={16} /><span>Chalkboard</span></Link>
      </nav>

      <div className={styles.recentHeader}>
        <button className={styles.recentToggle} type="button" aria-expanded={recentOpen} onClick={() => { setRecentOpen((open) => !open); setGroupMenuOpen(false); }}><ChevronRight size={15} className={recentOpen ? styles.recentExpanded : ""} /><span>最近</span></button>
        <div className={styles.recentActions}>
          <button className={`${styles.groupByButton} ${groupByTime ? styles.groupByActive : ""}`} type="button" aria-label="按时间分组" title="按时间分组" aria-expanded={groupMenuOpen} onClick={() => { setGroupMenuOpen((open) => !open); setUserMenuOpen(false); }}><ListFilter size={15} /></button>
          {groupMenuOpen && <div className={styles.groupMenuPopover} role="menu">
            <button type="button" role="menuitemcheckbox" aria-checked={groupByTime} onClick={() => { setGroupByTime((active) => !active); setGroupMenuOpen(false); }}><span>按时间</span>{groupByTime && <Check size={14} />}</button>
          </div>}
        </div>
      </div>

      {recentOpen && <nav className={styles.conversationList} aria-label="最近对话">
        {conversationGroups.length ? conversationGroups.map(({ group, items }) => <section className={styles.conversationGroup} key={group ?? "all"}>
          {groupByTime && <h2>{group}</h2>}
          {items.map((conversation) => <div key={conversation.id} className={`${styles.conversationItem} ${selectedConversationId === conversation.id ? styles.selectedConversation : ""}`}>
            {renamingConversationId === conversation.id
              ? <input className={styles.conversationRename} value={renameValue} autoFocus aria-label="重命名会话" onChange={(event) => setRenameValue(event.target.value)} onBlur={() => commitRenameConversation(conversation.id)} onKeyDown={(event) => { if (event.key === "Enter") commitRenameConversation(conversation.id); if (event.key === "Escape") { setRenamingConversationId(null); setRenameValue(""); } }} />
              : onSelectConversation
                ? <button className={styles.conversationSelect} type="button" aria-current={selectedConversationId === conversation.id ? "page" : undefined} onClick={() => selectConversation(conversation.id)}><strong>{conversation.title}</strong></button>
                : <Link className={styles.conversationSelect} href={`/chat?conversation=${conversation.id}`}><strong>{conversation.title}</strong></Link>}
            <button className={styles.conversationMenu} type="button" aria-label={`${conversation.title} 的更多操作`} title="更多操作" aria-expanded={openConversationMenu === conversation.id} onClick={(event) => toggleConversationMenu(conversation.id, event.currentTarget)}><MoreHorizontal size={15} /></button>
            {openConversationMenu === conversation.id && <div className={`${styles.conversationMenuPopover} ${conversationMenuAbove ? styles.conversationPopoverAbove : ""}`} role="menu"><button type="button" role="menuitem" onClick={() => startRenameConversation(conversation)}><Pencil size={14} />重命名</button><button type="button" role="menuitem" onClick={() => { setOpenConversationMenu(null); setPendingDeleteId(conversation.id); }}><Trash2 size={14} />删除</button></div>}
            {pendingDeleteId === conversation.id && <div className={`${styles.deleteConfirm} ${conversationMenuAbove ? styles.conversationPopoverAbove : ""}`} role="alert"><span>删除此对话？</span><button type="button" onClick={() => setPendingDeleteId(null)}>取消</button><button type="button" onClick={() => deleteConversation(conversation.id)}>删除</button></div>}
          </div>)}
        </section>) : <p className={styles.emptyConversations}>暂无会话</p>}
      </nav>}

      <div className={styles.userArea}>
        {userMenuOpen && <div className={styles.userMenu} role="menu">
          <button type="button" role="menuitem" onClick={() => { setUserMenuOpen(false); setSettingsOpen(true); }}><Settings2 size={16} /><span>设置</span></button>
          <button type="button" role="menuitem" disabled title="帮助与反馈暂不可用"><CircleHelp size={16} /><span>帮助与反馈</span></button>
          <button type="button" role="menuitem" onClick={() => void logout()}><LogOut size={16} /><span>退出登录</span></button>
        </div>}
        <button className={styles.userButton} type="button" aria-expanded={userMenuOpen} aria-label="打开用户菜单" onClick={() => { setUserMenuOpen((open) => !open); setGroupMenuOpen(false); }}>
          <span className={styles.avatar}>林</span>
          <span className={styles.userCopy}><strong>林同学</strong><small>自学空间</small></span>
          <ChevronUp size={16} className={userMenuOpen ? styles.userChevronOpen : ""} />
        </button>
      </div>
    </aside>
    {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
  </>;
}
