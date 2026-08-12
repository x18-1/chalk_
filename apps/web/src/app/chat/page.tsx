/*
 * THESIS: A calm learning desk keeps the next mathematical thought in reach, instead of turning tutoring into a generic answer feed.
 * OWN-WORLD: Warm paper, charcoal ink, restrained clay focus, fine dividers, and a mostly unboxed reading transcript framed by two quiet rails.
 * STORY: The student recognizes the active problem, understands the tutor's reasoning and visible Agent work, then writes the next question.
 * FIRST VIEWPORT: 248px conversation rail, flexible 720px reading column, and 296px context rail; the composer is anchored below the transcript.
 * FORM: Warm Learning Desk, the committed three-region Operate layout, staged as a desktop workspace with live demo states and no decorative imagery.
 */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import {
  Activity,
  ArrowUp,
  BookOpen,
  BrainCircuit,
  Check,
  ChevronDown,
  FileText,
  LoaderCircle,
  Paperclip,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  Search,
  Sparkles,
  SquarePen,
  X,
} from "lucide-react";

import { AppSidebar, defaultSidebarConversations } from "../../components/app-sidebar";
import { SettingsDialog } from "../../components/settings-dialog";
import { chatApi, settingsApi, uploadsApi, type Conversation, type Model, type ModelSelection, type Provider, type ThinkingLevel } from "../../api";
import { conversationGroup, formatConversationTitle } from "../../lib/conversations";
import styles from "./chat.module.css";

type Role = "student" | "tutor";
type ToolState = "idle" | "running" | "approval" | "complete" | "error";

type ActiveTool = {
  toolCallId: string;
  toolName: string;
  label: string;
  state: Exclude<ToolState, "idle">;
};

type Message = {
  id: string;
  role: Role;
  text: string;
  time: string;
  attachment?: string;
};

type AttachedFile = { id?: string; name: string; status: "uploading" | "ready" };

function messageText(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((block) => {
    if (block && typeof block === "object" && "type" in block && block.type === "text" && "text" in block) return [String(block.text)];
    return [];
  }).join("");
}

function formatMessageTime(timestamp: unknown) {
  if (typeof timestamp !== "number") return "";
  return new Date(timestamp).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function defaultThinkingLevel(model: Model): ThinkingLevel {
  return model.thinkingLevels.includes("medium") ? "medium" : model.thinkingLevels[0] ?? "off";
}

function resolveModelSelection(models: Model[], requested: ModelSelection | null): ModelSelection | null {
  const requestedModel = requested
    ? models.find((model) => model.providerId === requested.providerId && model.id === requested.modelId)
    : undefined;
  if (requested && requestedModel) {
    return {
      providerId: requested.providerId,
      modelId: requested.modelId,
      thinkingLevel: requestedModel.thinkingLevels.includes(requested.thinkingLevel)
        ? requested.thinkingLevel
        : defaultThinkingLevel(requestedModel),
    };
  }
  const firstModel = models[0];
  return firstModel
    ? { providerId: firstModel.providerId, modelId: firstModel.id, thinkingLevel: defaultThinkingLevel(firstModel) }
    : null;
}

function thinkingLevelLabel(level: ThinkingLevel) {
  return ({ off: "关闭", minimal: "极简", low: "低", medium: "中", high: "高", xhigh: "极高", max: "最大" } as Record<ThinkingLevel, string>)[level];
}

const initialConversations: typeof defaultSidebarConversations = [];

export default function ChatPage() {
  const [conversations, setConversations] = useState(initialConversations);
  const [selectedId, setSelectedId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [selectedModel, setSelectedModel] = useState<ModelSelection | null>(null);
  const [modelOptions, setModelOptions] = useState<Model[]>([]);
  const [modelProviders, setModelProviders] = useState<Provider[]>([]);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [activeModelProviderId, setActiveModelProviderId] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeTool, setActiveTool] = useState<ActiveTool | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [attachedFile, setAttachedFile] = useState<AttachedFile | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [contextCollapsed, setContextCollapsed] = useState(false);
  const [showProblemSource, setShowProblemSource] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageViewportRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => {
    abortControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadWorkspace() {
      try {
        const [conversationData, providerData, modelData] = await Promise.all([
          chatApi.list(),
          settingsApi.providers(),
          settingsApi.models(),
        ]);
        if (cancelled) return;
        const nextConversations = conversationData.conversations.map((conversation) => ({ id: conversation.id, title: formatConversationTitle(conversation), group: conversationGroup(conversation.updatedAt) }));
        setConversations(nextConversations);
        const nextSelection = resolveModelSelection(modelData.models, providerData.defaultModel);
        setSelectedModel(nextSelection);
        setModelOptions(modelData.models);
        setModelProviders(providerData.providers);
        setActiveModelProviderId(nextSelection?.providerId ?? "");
        const queryId = new URLSearchParams(window.location.search).get("conversation");
        const nextId = queryId && nextConversations.some((conversation) => conversation.id === queryId) ? queryId : nextConversations[0]?.id ?? "";
        if (nextId) {
          setSelectedId(nextId);
          await loadConversationMessages(nextId);
        }
        if (new URLSearchParams(window.location.search).get("new") === "1") await startConversation();
      } catch (loadError) {
        if (!cancelled) setNotice(loadError instanceof Error ? loadError.message : "加载工作区失败");
      }
    }
    void loadWorkspace();
    return () => { cancelled = true; };
    // The initial workspace load intentionally runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!showModelMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!modelPickerRef.current?.contains(event.target as Node)) setShowModelMenu(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowModelMenu(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [showModelMenu]);

  useEffect(() => {
    const viewport = messageViewportRef.current;
    if (!viewport) return;
    let cancelled = false;
    const behavior = messages.length > 0 ? "smooth" : "auto";
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
  const selectedModelOption = modelOptions.find((option) => option.providerId === selectedModel?.providerId && option.id === selectedModel.modelId);
  const availableProviderGroups = useMemo(() => modelProviders
    .filter((provider) => provider.configured)
    .map((provider) => ({ provider, models: modelOptions.filter((model) => model.providerId === provider.id) }))
    .filter((group) => group.models.length > 0), [modelOptions, modelProviders]);
  const activeProviderGroup = availableProviderGroups.find((group) => group.provider.id === activeModelProviderId) ?? availableProviderGroups[0];
  const visibleModelOptions = useMemo(() => {
    const query = modelSearch.trim().toLocaleLowerCase();
    const models = activeProviderGroup?.models ?? [];
    return query ? models.filter((model) => `${model.name} ${model.id}`.toLocaleLowerCase().includes(query)) : models;
  }, [activeProviderGroup, modelSearch]);
  const latestStudentMessage = [...messages].reverse().find((message) => message.role === "student");
  const learningContext = {
    label: "数学 · 当前对话",
    problem: latestStudentMessage?.text || "把你正在思考的题目写下来，我们从已知条件开始。",
  };
  function resetTransientConversationState() {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsStreaming(false);
    setActiveTool(null);
    setAttachedFile(null);
    setShowModelMenu(false);
    setShowProblemSource(false);
    setDraft("");
    setNotice(null);
  }

  async function loadConversationMessages(id: string) {
    const data = await chatApi.messages(id);
    setMessages(data.messages.flatMap((message, index) => {
      const role = message.role === "user" ? "student" : message.role === "assistant" ? "tutor" : null;
      if (!role) return [];
      return [{ id: `${id}-${String(message.timestamp ?? index)}`, role, text: messageText(message.content), time: formatMessageTime(message.timestamp) } satisfies Message];
    }));
  }

  async function selectConversation(id: string) {
    resetTransientConversationState();
    setSelectedId(id);
    setMessages([]);
    setActiveTool(null);
    try { await loadConversationMessages(id); } catch (loadError) { setNotice(loadError instanceof Error ? loadError.message : "加载对话失败"); }
  }

  async function startConversation() {
    resetTransientConversationState();
    try {
      const data = await chatApi.create();
      const next = { id: data.conversation.id, title: formatConversationTitle(data.conversation), group: conversationGroup(data.conversation.updatedAt) };
      setConversations((current) => [next, ...current]);
      setSelectedId(next.id);
      setMessages([]);
      setActiveTool(null);
      window.history.replaceState(null, "", `/chat?conversation=${next.id}`);
      return next.id;
    } catch (createError) {
      setNotice(createError instanceof Error ? createError.message : "无法新建对话");
      return null;
    }
  }

  function stopStreaming() {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    if (selectedId) void chatApi.abort(selectedId).catch(() => undefined);
    setIsStreaming(false);
    setActiveTool(null);
  }

  async function sendMessage(event?: React.FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || isStreaming) return;
    if (attachedFile?.status === "uploading") {
      setNotice("附件仍在上传，请稍候");
      return;
    }
    let conversationId = selectedId;
    if (!conversationId) conversationId = (await startConversation()) ?? "";
    if (!conversationId) return;
    setNotice(null);
    const now = new Date();
    const time = now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    const studentMessage: Message = { id: `student-${Date.now()}`, role: "student", text, time, attachment: attachedFile?.name };
    setMessages((current) => [...current, studentMessage]);
    setDraft("");
    setAttachedFile(null);
    setIsStreaming(true);
    setActiveTool(null);
    const tutorId = `tutor-${Date.now()}`;
    setMessages((current) => [...current, { id: tutorId, role: "tutor", text: "", time }]);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    try {
      await chatApi.stream(conversationId, { message: text, model: selectedModel ?? undefined, attachmentIds: attachedFile?.id ? [attachedFile.id] : [] }, ({ type, data }) => {
        if (type === "text_delta") setMessages((current) => current.map((message) => message.id === tutorId ? { ...message, text: `${message.text}${String(data.delta ?? "")}` } : message));
        if (type === "tool_started") setActiveTool({ toolCallId: String(data.toolCallId ?? ""), toolName: String(data.toolName ?? "tool"), label: String(data.toolName ?? "工具"), state: "running" });
        if (type === "tool_pending") setActiveTool({ toolCallId: String(data.toolCallId ?? ""), toolName: String(data.toolName ?? "tool"), label: String(data.label ?? data.toolName ?? "工具"), state: "approval" });
        if (type === "tool_updated") {
          const update = data.update;
          if (update && typeof update === "object" && "details" in update && update.details && typeof update.details === "object" && "type" in update.details && update.details.type === "subagent_running") {
            setActiveTool((current) => current ? { ...current, state: "running" } : current);
          }
        }
        if (type === "tool_finished") setActiveTool((current) => current ? { ...current, state: data.isError ? "error" : "complete" } : current);
        if (type === "message_completed" && data.message?.role === "assistant") {
          const completedMessage = data.message;
          setMessages((current) => current.map((message) => message.id === tutorId ? { ...message, text: messageText(completedMessage.content) } : message));
        }
        if (type === "error") {
          setMessages((current) => current.filter((message) => message.id !== tutorId || message.text.trim()));
          setNotice("模型未能完成回答，请稍后重试");
        }
      }, controller.signal);
    } catch (streamError) {
      setMessages((current) => current.filter((message) => message.id !== tutorId || message.text.trim()));
      if (!controller.signal.aborted) setNotice("连接中断，请重新发送这条消息");
    } finally {
      abortControllerRef.current = null;
      setIsStreaming(false);
    }
  }

  async function handleAttachment(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";
    const conversationId = selectedId || await startConversation();
    if (!conversationId) return;
    setAttachedFile({ name: file.name, status: "uploading" });
    setNotice(`${file.name} 正在上传…`);
    try {
      const contentType = file.type === "application/pdf" ? "application/pdf" : file.type;
      if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(contentType)) throw new Error("仅支持 JPG、PNG、WebP 图片或 PDF 文件");
      const presign = await uploadsApi.presign({ conversationId, filename: file.name, contentType, size: file.size });
      await uploadsApi.upload(presign.uploadUrl, file, contentType);
      await uploadsApi.confirm(presign.attachmentId);
      setAttachedFile({ id: presign.attachmentId, name: file.name, status: "ready" });
      setNotice(`${file.name} 已添加到这条消息`);
    } catch (uploadError) {
      setAttachedFile(null);
      setNotice(uploadError instanceof Error ? uploadError.message : "文件上传失败");
    }
  }

  async function decideTool(approved: boolean) {
    if (!selectedId || !activeTool?.toolCallId) return;
    try {
      await chatApi.approve(selectedId, activeTool.toolCallId, approved);
      setActiveTool((current) => current ? { ...current, state: approved ? "running" : "error" } : current);
      setNotice(approved ? "已允许这次工具调用" : "已拒绝这次工具调用");
    } catch (approvalError) {
      setNotice(approvalError instanceof Error ? approvalError.message : "审批请求失败");
    }
  }

  async function steerMessage() {
    const text = draft.trim();
    if (!selectedId || !text || !isStreaming) return;
    try {
      await chatApi.steer(selectedId, text);
      setDraft("");
      setNotice("引导已加入当前运行");
    } catch (steerError) {
      setNotice(steerError instanceof Error ? steerError.message : "发送引导失败");
    }
  }

  function renameConversation(id: string, title: string) {
    void chatApi.rename(id, title).then(() => {
      setConversations((current) => current.map((conversation) => conversation.id === id ? { ...conversation, title } : conversation));
    }).catch((renameError) => setNotice(renameError instanceof Error ? renameError.message : "重命名失败"));
  }

  function deleteConversation(id: string) {
    void chatApi.delete(id).then(() => {
      const remaining = conversations.filter((conversation) => conversation.id !== id);
      setConversations(remaining);
      if (selectedId === id) {
        const next = remaining[0];
        setSelectedId(next?.id ?? "");
        setMessages([]);
        setActiveTool(null);
        if (next) void loadConversationMessages(next.id);
      }
    }).catch((deleteError) => setNotice(deleteError instanceof Error ? deleteError.message : "删除失败"));
  }

  function toggleModelMenu() {
    if (!modelOptions.length) {
      setSettingsOpen(true);
      return;
    }
    setShowModelMenu((open) => {
      if (!open) {
        setActiveModelProviderId(selectedModel?.providerId ?? availableProviderGroups[0]?.provider.id ?? "");
        setModelSearch("");
      }
      return !open;
    });
  }

  function selectModel(option: Model) {
    const selection = {
      providerId: option.providerId,
      modelId: option.id,
      thinkingLevel: defaultThinkingLevel(option),
    } satisfies ModelSelection;
    setSelectedModel(selection);
    setActiveModelProviderId(option.providerId);
    void settingsApi.saveDefaultModel(selection).catch((saveError) => {
      setNotice(saveError instanceof Error ? saveError.message : "保存模型选择失败");
    });
  }

  function selectModelThinking(option: Model, thinkingLevel: ThinkingLevel) {
    const selection = { providerId: option.providerId, modelId: option.id, thinkingLevel } satisfies ModelSelection;
    setSelectedModel(selection);
    setActiveModelProviderId(option.providerId);
    void settingsApi.saveDefaultModel(selection).catch((saveError) => {
      setNotice(saveError instanceof Error ? saveError.message : "保存思考强度失败");
    });
  }

  async function reloadModelCatalog() {
    setSettingsOpen(false);
    try {
      const [providerData, modelData] = await Promise.all([settingsApi.providers(), settingsApi.models()]);
      const nextSelection = resolveModelSelection(modelData.models, selectedModel ?? providerData.defaultModel);
      setModelProviders(providerData.providers);
      setModelOptions(modelData.models);
      setSelectedModel(nextSelection);
      setActiveModelProviderId(nextSelection?.providerId ?? "");
    } catch (loadError) {
      setNotice(loadError instanceof Error ? loadError.message : "刷新模型目录失败");
    }
  }

  return (
    <main className={`${styles.workspace} ${contextCollapsed ? styles.contextCollapsed : ""}`}>
      <AppSidebar activeSection="chats" conversations={conversations} selectedConversationId={selectedId} onNewConversation={() => { void startConversation(); }} onSelectConversation={(id) => { void selectConversation(id); }} onRenameConversation={renameConversation} onDeleteConversation={deleteConversation} />

      <section className={styles.chatSurface} aria-label="数学对话">
        <header className={styles.chatHeader}>
          <div><div className={styles.breadcrumb}><span>数学</span><span>/</span><strong>{selectedConversation?.title ?? "新的数学问题"}</strong></div></div>
          <div className={styles.headerActions}>{contextCollapsed && <button className={styles.iconButton} type="button" aria-label="展开学习上下文" title="展开学习上下文" onClick={() => setContextCollapsed(false)}><PanelRightOpen size={17} /></button>}</div>
        </header>

        <div ref={messageViewportRef} className={styles.messageViewport}>
          <div className={styles.messageColumn}>
            {messages.length === 0 && <div className={styles.emptyConversation}><div className={styles.emptyIcon}><SquarePen size={19} /></div><h1>把问题写下来</h1><p>从一道题、一个概念，或你卡住的某一步开始。</p></div>}
            {messages.map((message) => <MessageBubble key={message.id} message={message} />)}
            {isStreaming && <div className={styles.tutorMessage}><div className={styles.messageAuthor}><span className={styles.tutorAvatar}>C</span><strong>Chalk</strong><span>正在思考</span></div><div className={styles.thinkingLine}><LoaderCircle size={15} className={styles.spin} />正在整理下一步提示</div></div>}
            {activeTool && <div className={styles.inlineToolActivity}><ToolActivity state={activeTool.state} title={activeTool.label} onApprove={() => void decideTool(true)} onDeny={() => void decideTool(false)} /></div>}
          </div>
        </div>

        <div className={styles.composerDock}>
          {notice && <div className={styles.notice} role="status"><span>{notice}</span><button type="button" aria-label="关闭提示" onClick={() => setNotice(null)}><X size={14} /></button></div>}
          {attachedFile && <div className={styles.attachmentChip}><FileText size={14} /><span>{attachedFile.name}{attachedFile.status === "uploading" ? " · 上传中" : ""}</span><button type="button" aria-label="移除附件" onClick={() => setAttachedFile(null)}><X size={13} /></button></div>}
          <form className={styles.composer} onSubmit={sendMessage}>
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendMessage(); } }} placeholder="继续问 Chalk..." rows={2} aria-label="消息内容" />
            <div className={styles.composerToolbar}>
              <div className={styles.composerTools}>
                <input ref={fileInputRef} className="srOnly" type="file" accept="image/*,.pdf" onChange={handleAttachment} />
                <button className={styles.toolButton} type="button" aria-label="添加附件" title="添加附件" onClick={() => fileInputRef.current?.click()}><Paperclip size={16} /></button>
                <div ref={modelPickerRef} className={styles.modelPicker}>
                  <button className={styles.modelButton} type="button" aria-expanded={showModelMenu} onClick={toggleModelMenu}><Sparkles size={14} /><span>{selectedModelOption?.name ?? (modelOptions.length ? "选择模型" : "配置模型")}</span>{selectedModelOption?.reasoning && <small>{thinkingLevelLabel(selectedModel?.thinkingLevel ?? "off")}</small>}<ChevronDown size={14} /></button>
                  {showModelMenu && <div className={styles.modelMenu} role="dialog" aria-label="选择模型">
                    <label className={styles.modelSearch}><Search size={14} /><input value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="搜索模型" aria-label="搜索模型" autoFocus /></label>
                    <div className={styles.modelMenuBody}>
                      <nav className={styles.modelProviderList} aria-label="已配置 Provider">{availableProviderGroups.map((group) => <button key={group.provider.id} type="button" className={group.provider.id === activeProviderGroup?.provider.id ? styles.modelProviderActive : ""} onClick={() => setActiveModelProviderId(group.provider.id)}><span>{group.provider.name}</span><small>{group.models.length}</small></button>)}</nav>
                      <div className={styles.modelOptionList}>{visibleModelOptions.length ? visibleModelOptions.map((option) => { const selected = selectedModel?.providerId === option.providerId && selectedModel.modelId === option.id; const level = selected ? selectedModel.thinkingLevel : defaultThinkingLevel(option); return <article key={`${option.providerId}/${option.id}`} className={`${styles.modelOptionRow} ${selected ? styles.modelOptionActive : ""}`}><button type="button" className={styles.modelChoice} aria-pressed={selected} onClick={() => selectModel(option)}><span><strong>{option.name}</strong><small>{option.id}</small></span>{selected && <Check size={15} />}</button><select className={styles.modelReasoningSelect} value={level} onChange={(event) => selectModelThinking(option, event.target.value as ThinkingLevel)} disabled={!option.reasoning} aria-label={`${option.name} 思考强度`}>{option.thinkingLevels.map((thinkingLevel) => <option key={thinkingLevel} value={thinkingLevel}>{thinkingLevelLabel(thinkingLevel)}</option>)}</select></article>; }) : <p>没有匹配的模型</p>}</div>
                    </div>
                  </div>}
                </div>
              </div>
              {isStreaming ? <span className={styles.streamingActions}><button className={styles.steerButton} type="button" onClick={() => void steerMessage()} disabled={!draft.trim()}><ArrowUp size={14} />引导</button><button className={styles.stopButton} type="button" onClick={stopStreaming}><Pause size={15} />停止</button></span> : <button className={styles.sendButton} type="submit" disabled={!draft.trim()} aria-label="发送消息" title="发送消息"><ArrowUp size={17} /></button>}
            </div>
          </form>
          <p className={styles.composerFootnote}>Chalk 会先帮你找到思路，再一起完成步骤</p>
        </div>
      </section>

      <aside className={styles.contextRail} aria-label="学习上下文">
        <div className={styles.contextHeader}><div><span className={styles.railKicker}>学习上下文</span><h2>当前问题</h2></div><button className={styles.iconButton} type="button" aria-label="收起学习上下文" title="收起学习上下文" onClick={() => setContextCollapsed(true)}><PanelRightClose size={16} /></button></div>
        <section className={styles.problemSection}><div className={styles.problemTopline}><span className={styles.problemLabel}>{learningContext.label}</span><span className={styles.contextStatus}><span className={styles.statusDot}></span>{messages.length ? "进行中" : "待开始"}</span></div><p>{learningContext.problem}</p>{showProblemSource && <div className={styles.problemSource}><strong>当前题目</strong><span>{learningContext.problem}</span></div>}<div className={styles.contextActions}><button className={styles.textAction} type="button" onClick={() => setShowProblemSource((visible) => !visible)}><BookOpen size={14} />{showProblemSource ? "收起题目" : "查看题目"}</button></div></section>
      </aside>
      {settingsOpen && <SettingsDialog onClose={() => { void reloadModelCatalog(); }} />}
    </main>
  );
}

function MessageBubble({ message }: { message: Message }) {
  if (message.role === "student") return <div className={styles.studentMessage}><div className={styles.studentBubble}>{message.attachment && <div className={styles.attachmentPreview}><FileText size={14} /><span>{message.attachment}</span></div>}<p>{message.text}</p></div><time>{message.time}</time></div>;
  return <div className={styles.tutorMessage}><div className={styles.messageAuthor}><span className={styles.tutorAvatar}>C</span><strong>Chalk</strong><span>{message.time}</span></div><div className={styles.tutorCopy}><ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{message.text}</ReactMarkdown></div></div>;
}

function ToolActivity({ state, title, onApprove, onDeny }: { state: Exclude<ToolState, "idle">; title: string; onApprove: () => void; onDeny: () => void }) {
  const detail = state === "approval" ? "Chalk 正在等待你的确认。" : state === "error" ? "这次工具调用没有完成。" : state === "running" ? "正在处理当前学习任务。" : "工具调用已完成。";
  return <div className={`${styles.toolActivity} ${styles[`tool_${state}`]}`}><div className={styles.toolIcon}>{state === "running" ? <LoaderCircle size={15} className={styles.spin} /> : state === "error" ? <X size={15} /> : <Activity size={15} />}</div><div className={styles.toolCopy}><strong>{title}</strong><p>{detail}</p>{state === "approval" && <div className={styles.approvalActions}><button className={styles.approveButton} type="button" onClick={onApprove}><Check size={14} />允许</button><button className={styles.denyButton} type="button" onClick={onDeny}>拒绝</button></div>}</div></div>;
}
