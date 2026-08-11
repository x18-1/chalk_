/*
 * THESIS: A calm learning desk keeps the next mathematical thought in reach, instead of turning tutoring into a generic answer feed.
 * OWN-WORLD: Warm paper, charcoal ink, restrained clay focus, fine dividers, and a mostly unboxed reading transcript framed by two quiet rails.
 * STORY: The student recognizes the active problem, understands the tutor's reasoning and visible Agent work, then writes the next question.
 * FIRST VIEWPORT: 248px conversation rail, flexible 720px reading column, and 296px context rail; the composer is anchored below the transcript.
 * FORM: Warm Learning Desk, the committed three-region Operate layout, staged as a desktop workspace with live demo states and no decorative imagery.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  FileText,
  LoaderCircle,
  MoreHorizontal,
  Paperclip,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Sparkles,
  SquarePen,
  X,
} from "lucide-react";

import { AppSidebar, defaultSidebarConversations } from "../../components/app-sidebar";
import styles from "./chat.module.css";

type Role = "student" | "tutor";
type ToolState = "idle" | "running" | "approval" | "complete" | "error";

type Message = {
  id: string;
  role: Role;
  text: string;
  time: string;
  attachment?: string;
};

const initialConversations = defaultSidebarConversations;

const initialMessages: Message[] = [
  {
    id: "student-1",
    role: "student",
    text: "这道题第二问为什么要连接 AC？我直接用勾股定理算不出来。",
    time: "10:42",
    attachment: "geometry-homework.jpg",
  },
  {
    id: "tutor-1",
    role: "tutor",
    text: "先看题目里已经给出的关系：AB = AD，∠BAC = ∠CAD。连接 AC 的作用，是把两个看起来分开的三角形放到同一个比较框架里。你能说说 △ABC 和 △ADC 目前有哪些对应条件吗？",
    time: "10:42",
  },
  {
    id: "student-2",
    role: "student",
    text: "它们有一条边相等，AC 是公共边，角也好像相等。这样就能证明全等？",
    time: "10:43",
  },
  {
    id: "tutor-2",
    role: "tutor",
    text: "对，正好是两边及其夹角分别相等（SAS）。注意这里的“夹角”必须是两条已知边的夹角，所以要把对应关系写完整：\n\nAB = AD，AC = AC，∠BAC = ∠DAC。\n\n因此 △ABC ≌ △ADC。由全等三角形的对应边相等，就能得到 BC = DC。",
    time: "10:43",
  },
];

const learningContexts: Record<string, { label: string; problem: string }> = {
  geometry: {
    label: "几何 · 三角形全等",
    problem: "在 △ABC 和 △ADC 中，已知 AB = AD，∠BAC = ∠DAC。证明 BC = DC。",
  },
  fractions: {
    label: "代数 · 分数方程",
    problem: "解方程 3/(x + 1) = 2/(x - 2)，并检验解是否满足定义域。",
  },
  quadratic: {
    label: "函数 · 二次函数",
    problem: "从 y = x² - 4x + 1 的表达式中，找出图像的顶点和对称轴。",
  },
  proof: {
    label: "几何 · 全等判定",
    problem: "比较 SAS、ASA 和 AAS 三种三角形全等判定方法的使用条件。",
  },
  vectors: {
    label: "向量 · 数量积",
    problem: "已知两个向量的长度和夹角，如何用数量积判断它们是否垂直？",
  },
};

export default function ChatPage() {
  const [conversations, setConversations] = useState(initialConversations);
  const [selectedId, setSelectedId] = useState("geometry");
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState("Chalk Tutor · Balanced");
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [toolState, setToolState] = useState<ToolState>("idle");
  const [isStreaming, setIsStreaming] = useState(false);
  const [attachedFile, setAttachedFile] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [contextCollapsed, setContextCollapsed] = useState(false);
  const [showProblemSource, setShowProblemSource] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageViewportRef = useRef<HTMLDivElement>(null);
  const streamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (streamTimerRef.current) clearTimeout(streamTimerRef.current);
  }, []);

  useEffect(() => {
    const viewport = messageViewportRef.current;
    if (!viewport) return;
    let cancelled = false;
    const behavior = messages.length > initialMessages.length ? "smooth" : "auto";
    const scrollToLatest = () => {
      if (!cancelled) viewport.scrollTo({ top: viewport.scrollHeight, behavior });
    };
    const frame = requestAnimationFrame(() => requestAnimationFrame(scrollToLatest));
    const timer = window.setTimeout(scrollToLatest, 150);
    void document.fonts?.ready.then(scrollToLatest);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [messages, isStreaming, selectedId]);

  const selectedConversation = conversations.find((conversation) => conversation.id === selectedId) ?? conversations[0];
  const learningContext = learningContexts[selectedId] ?? {
    label: "数学 · 新问题",
    problem: "把你正在思考的题目写下来，我们从已知条件开始。",
  };
  function resetTransientConversationState() {
    if (streamTimerRef.current) clearTimeout(streamTimerRef.current);
    streamTimerRef.current = null;
    setIsStreaming(false);
    setAttachedFile(null);
    setShowModelMenu(false);
    setShowProblemSource(false);
    setDraft("");
    setNotice(null);
  }

  function selectConversation(id: string) {
    resetTransientConversationState();
    setSelectedId(id);
    if (id !== "geometry") {
      setMessages([]);
      setToolState("idle");
    } else {
      setMessages(initialMessages);
      setToolState("idle");
    }
  }

  function startConversation() {
    resetTransientConversationState();
    const id = `new-${Date.now()}`;
    const next = { id, title: "新的数学问题", group: "今天" as const };
    setConversations((current) => [next, ...current]);
    setSelectedId(id);
    setMessages([]);
    setToolState("idle");
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("new") === "1") {
      startConversation();
      window.history.replaceState(null, "", "/chat");
      return;
    }
    const conversationId = params.get("conversation");
    if (conversationId && conversations.some((conversation) => conversation.id === conversationId)) selectConversation(conversationId);
    // The query is only an entry instruction; subsequent selection stays local to the workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopStreaming() {
    if (streamTimerRef.current) clearTimeout(streamTimerRef.current);
    streamTimerRef.current = null;
    setIsStreaming(false);
    setToolState("idle");
  }

  function sendMessage(event?: React.FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || isStreaming) return;
    const now = new Date();
    const time = now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    const studentMessage: Message = { id: `student-${Date.now()}`, role: "student", text, time, attachment: attachedFile ?? undefined };
    setMessages((current) => [...current, studentMessage]);
    setDraft("");
    setAttachedFile(null);
    setIsStreaming(true);
    setToolState("running");
    streamTimerRef.current = setTimeout(() => {
      setMessages((current) => [...current, {
        id: `tutor-${Date.now()}`,
        role: "tutor",
        text: "我先把这句话拆成一个更小的线索：题目要求你找的是关系，不是立刻算出一个数。试着指出已知条件里重复出现的对象，再告诉我你想从哪一步开始。",
        time,
      }]);
      setIsStreaming(false);
      setToolState("complete");
      streamTimerRef.current = null;
    }, 1500);
  }

  function handleAttachment(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setAttachedFile(file.name);
    setNotice(`${file.name} 已添加到这条消息`);
    event.target.value = "";
  }

  function approveTool() {
    setToolState("running");
    setNotice("已允许本次几何关系检查");
    streamTimerRef.current = setTimeout(() => {
      setToolState("complete");
      streamTimerRef.current = null;
    }, 850);
  }

  function denyTool() {
    setToolState("error");
    setNotice("已取消工具检查，你仍然可以继续提问");
  }

  function requestToolApproval() {
    setToolState("approval");
    setNotice("当前题目检查需要你的确认");
  }

  function renameConversation(id: string, title: string) {
    setConversations((current) => current.map((conversation) => conversation.id === id ? { ...conversation, title } : conversation));
  }

  function deleteConversation(id: string) {
    const remaining = conversations.filter((conversation) => conversation.id !== id);
    setConversations(remaining);
    if (selectedId === id) {
      const next = remaining[0];
      setSelectedId(next?.id ?? "");
      setMessages(next?.id === "geometry" ? initialMessages : []);
      setToolState("idle");
    }
  }

  return (
    <main className={`${styles.workspace} ${contextCollapsed ? styles.contextCollapsed : ""}`}>
      <AppSidebar conversations={conversations} selectedConversationId={selectedId} onNewConversation={startConversation} onSelectConversation={selectConversation} onRenameConversation={renameConversation} onDeleteConversation={deleteConversation} />

      <section className={styles.chatSurface} aria-label="数学对话">
        <header className={styles.chatHeader}>
          <div><div className={styles.breadcrumb}><span>数学</span><span>/</span><strong>{selectedConversation?.title ?? "新的数学问题"}</strong></div></div>
          <div className={styles.headerActions}><span className={styles.demoTag}><Sparkles size={14} />演示数据</span>{contextCollapsed && <button className={styles.iconButton} type="button" aria-label="展开学习上下文" title="展开学习上下文" onClick={() => setContextCollapsed(false)}><PanelRightOpen size={17} /></button>}<button className={styles.iconButton} type="button" aria-label="更多会话操作" title="更多会话操作暂不可用" disabled><MoreHorizontal size={17} /></button></div>
        </header>

        <div ref={messageViewportRef} className={styles.messageViewport}>
          <div className={styles.messageColumn}>
            {messages.length === 0 && <div className={styles.emptyConversation}><div className={styles.emptyIcon}><SquarePen size={19} /></div><h1>把问题写下来</h1><p>从一道题、一个概念，或你卡住的某一步开始。</p></div>}
            {messages.map((message) => <MessageBubble key={message.id} message={message} />)}
            {isStreaming && <div className={styles.tutorMessage}><div className={styles.messageAuthor}><span className={styles.tutorAvatar}>C</span><strong>Chalk</strong><span>正在思考</span></div><div className={styles.thinkingLine}><LoaderCircle size={15} className={styles.spin} />正在整理下一步提示</div></div>}
            {toolState !== "idle" && <div className={styles.inlineToolActivity}><ToolActivity state={toolState} title={selectedId === "geometry" ? "几何关系检查" : "解题步骤检查"} onApprove={approveTool} onDeny={denyTool} onRequestApproval={requestToolApproval} /></div>}
          </div>
        </div>

        <div className={styles.composerDock}>
          {notice && <div className={styles.notice} role="status"><span>{notice}</span><button type="button" aria-label="关闭提示" onClick={() => setNotice(null)}><X size={14} /></button></div>}
          {attachedFile && <div className={styles.attachmentChip}><FileText size={14} /><span>{attachedFile}</span><button type="button" aria-label="移除附件" onClick={() => setAttachedFile(null)}><X size={13} /></button></div>}
          <form className={styles.composer} onSubmit={sendMessage}>
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); } }} placeholder="继续问 Chalk..." rows={2} aria-label="消息内容" />
            <div className={styles.composerToolbar}>
              <div className={styles.composerTools}>
                <input ref={fileInputRef} className="srOnly" type="file" accept="image/*,.pdf" onChange={handleAttachment} />
                <button className={styles.toolButton} type="button" aria-label="添加附件" title="添加附件" onClick={() => fileInputRef.current?.click()}><Paperclip size={16} /></button>
                <div className={styles.modelPicker}><button className={styles.modelButton} type="button" aria-expanded={showModelMenu} onClick={() => setShowModelMenu((open) => !open)}><Sparkles size={14} /><span>{model}</span><ChevronDown size={14} /></button>{showModelMenu && <div className={styles.modelMenu}>{["Chalk Tutor · Balanced", "Chalk Tutor · Socratic", "Chalk Tutor · Concise"].map((option) => <button key={option} type="button" onClick={() => { setModel(option); setShowModelMenu(false); }}><span>{option}</span>{model === option && <Check size={14} />}</button>)}</div>}</div>
              </div>
              {isStreaming ? <button className={styles.stopButton} type="button" onClick={stopStreaming}><Pause size={15} />停止</button> : <button className={styles.sendButton} type="submit" disabled={!draft.trim()} aria-label="发送消息" title="发送消息"><ArrowUp size={17} /></button>}
            </div>
          </form>
          <p className={styles.composerFootnote}>Chalk 会先帮你找到思路，再一起完成步骤</p>
        </div>
      </section>

      <aside className={styles.contextRail} aria-label="学习上下文">
        <div className={styles.contextHeader}><div><span className={styles.railKicker}>学习上下文</span><h2>当前问题</h2></div><button className={styles.iconButton} type="button" aria-label="收起学习上下文" title="收起学习上下文" onClick={() => setContextCollapsed(true)}><PanelRightClose size={16} /></button></div>
        <section className={styles.problemSection}><div className={styles.problemTopline}><span className={styles.problemLabel}>{learningContext.label}</span><span className={styles.contextStatus}><span className={styles.statusDot}></span>{messages.length ? "进行中" : "待开始"}</span></div><p>{learningContext.problem}</p>{showProblemSource && <div className={styles.problemSource}><strong>题目原文</strong><span>{learningContext.problem}</span></div>}<div className={styles.contextActions}><button className={styles.textAction} type="button" onClick={() => setShowProblemSource((visible) => !visible)}><BookOpen size={14} />{showProblemSource ? "收起题目原文" : "打开题目原文"}</button><button className={styles.textAction} type="button" onClick={requestToolApproval} disabled={toolState === "approval" || toolState === "running"}>{toolState === "approval" ? "等待确认" : toolState === "running" ? "检查中" : "检查当前条件"}</button></div></section>
      </aside>
    </main>
  );
}

function MessageBubble({ message }: { message: Message }) {
  if (message.role === "student") return <div className={styles.studentMessage}><div className={styles.studentBubble}>{message.attachment && <div className={styles.attachmentPreview}><FileText size={14} /><span>{message.attachment}</span></div>}<p>{message.text}</p></div><time>{message.time}</time></div>;
  return <div className={styles.tutorMessage}><div className={styles.messageAuthor}><span className={styles.tutorAvatar}>C</span><strong>Chalk</strong><span>{message.time}</span></div><div className={styles.tutorCopy}>{message.text.split("\n").map((paragraph, index) => paragraph ? <p key={`${message.id}-${index}`}>{paragraph}</p> : <span key={`${message.id}-${index}`} className={styles.paragraphBreak} />)}</div></div>;
}

function ToolActivity({ state, title, onApprove, onDeny, onRequestApproval }: { state: ToolState; title: string; onApprove: () => void; onDeny: () => void; onRequestApproval: () => void }) {
  const detail = state === "idle" ? "还没有需要运行的检查。" : state === "approval" ? "Chalk 想读取当前题目中的条件，确认后继续。" : state === "error" ? "检查已取消，可以继续用文字描述你的想法。" : state === "running" ? "正在比对题目条件和解题关系。" : "已确认当前解题关系。";
  return <div className={`${styles.toolActivity} ${styles[`tool_${state}`]}`}><div className={styles.toolIcon}>{state === "running" ? <LoaderCircle size={15} className={styles.spin} /> : state === "error" ? <X size={15} /> : <Activity size={15} />}</div><div className={styles.toolCopy}><strong>{title}</strong><p>{detail}</p>{state === "approval" && <div className={styles.approvalActions}><button className={styles.approveButton} type="button" onClick={onApprove}><Check size={14} />允许</button><button className={styles.denyButton} type="button" onClick={onDeny}>取消</button></div>}{(state === "idle" || state === "complete" || state === "error") && <button className={styles.toolLink} type="button" onClick={onRequestApproval}>{state === "idle" ? "开始检查" : state === "complete" ? "再次检查" : "重新检查"}</button>}</div></div>;
}
