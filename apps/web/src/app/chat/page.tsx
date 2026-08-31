/*
 * THESIS: A calm learning desk keeps the next mathematical thought in reach, instead of turning tutoring into a generic answer feed.
 * OWN-WORLD: Warm paper, charcoal ink, restrained clay focus, fine dividers, and a mostly unboxed reading transcript framed by two quiet rails.
 * STORY: The student recognizes the active problem, understands the tutor's reasoning and visible Agent work, then writes the next question.
 * FIRST VIEWPORT: 248px conversation rail, flexible 720px reading column, and 296px context rail; the composer is anchored below the transcript.
 * FORM: Warm Learning Desk, the committed three-region Operate layout, staged as a desktop workspace with live demo states and no decorative imagery.
 */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import {
  Activity,
  AlertCircle,
  AudioLines,
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  FileText,
  LoaderCircle,
  Paperclip,
  PanelRightClose,
  PanelRightOpen,
  Pause,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  SquarePen,
  X,
} from "lucide-react";

import { AppSidebar, defaultSidebarConversations } from "../../components/app-sidebar";
import { SettingsDialog } from "../../components/settings-dialog";
import { ApiRequestError, chatApi, mediaApi, settingsApi, uploadsApi, type CapabilitySettings, type MediaCapability, type MediaProvider, type MediaProviders, type Model, type ModelSelection, type Provider, type ThinkingLevel } from "../../api";
import { conversationGroup, formatConversationTitle } from "../../lib/conversations";
import type { SceneView } from "@chalk/chalkboard";
import { InlineChalkboard } from "../../features/chat/components/inline-chalkboard";
import styles from "./chat.module.css";

type Role = "student" | "tutor";
type ToolState = "running" | "approval" | "complete" | "error" | "rejected";

type MessageTool = {
  toolCallId: string;
  toolName: string;
  label: string;
  state: ToolState;
  result?: string;
  chalkboard?: SceneView;
};

type Message = {
  id: string;
  role: Role;
  text: string;
  time: string;
  attachment?: string;
  thinking?: "running";
  tools?: MessageTool[];
  runStatus?: "aborted" | "failed";
};

type AttachedFile = { id?: string; name: string; status: "uploading" | "ready" };
type FailureKind = "provider" | "tool" | "mcp" | "approval" | "network";
type ChatFailure = {
  kind: FailureKind;
  title: string;
  detail: string;
  action: "retry" | "settings" | "reload";
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function messageText(content: unknown) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((block) => {
    if (block && typeof block === "object" && "type" in block && block.type === "text" && "text" in block) return [String(block.text)];
    return [];
  }).join("");
}

function toolCalls(content: unknown): MessageTool[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => {
    const value = objectValue(block);
    if (value?.type !== "toolCall" || typeof value.id !== "string" || typeof value.name !== "string") return [];
    return [{
      toolCallId: value.id,
      toolName: value.name,
      label: toolLabel(value.name),
      state: "running" as const,
    }];
  });
}

function toolLabel(name: string) {
  const labels: Record<string, string> = {
    run_subagent: "专项分析",
    render_chalkboard: "Chalkboard Scene",
    search_learning_resources: "搜索学习资料",
    read_resource: "读取资源",
    read_uploaded_file: "读取附件",
    read_skill: "Read Skill",
    rename_current_conversation: "更新会话标题",
  };
  if (labels[name]) return labels[name];
  if (name.startsWith("mcp__")) {
    const displayName = name.split("__").filter(Boolean).at(-1)?.replaceAll("_", " ") ?? "工具";
    return `MCP · ${displayName}`;
  }
  return name.replaceAll("_", " ");
}

function toolResultText(content: unknown) {
  const text = messageText(content).trim();
  return text.length > 360 ? `${text.slice(0, 357)}...` : text;
}

function chalkboardDetails(value: unknown): SceneView | undefined {
  const details = objectValue(value);
  if (details?.type !== "scene") return undefined;
  const scene = objectValue(details.scene);
  if (!scene || typeof scene.id !== "string" || typeof scene.title !== "string" || typeof scene.type !== "string") return undefined;
  const content = objectValue(scene.content);
  if (!content || content.type !== scene.type) return undefined;
  return {
    id: scene.id,
    title: scene.title,
    order: typeof scene.order === "number" ? scene.order : 0,
    type: scene.type as SceneView["type"],
    actionCount: 0,
    content,
  };
}

function isStudentRejectedTool(content: unknown) {
  return toolResultText(content).includes("学生拒绝了这次工具调用");
}

function mergeTools(current: MessageTool[] = [], incoming: MessageTool[]) {
  const merged = [...current];
  for (const tool of incoming) {
    const index = merged.findIndex((item) => item.toolCallId === tool.toolCallId);
    if (index < 0) merged.push(tool);
    else {
      const existing = merged[index]!;
      merged[index] = {
        ...existing,
        ...tool,
        state: existing.state === "rejected" || tool.state === "rejected"
          ? "rejected"
          : tool.state === "running" && existing.state !== "running"
            ? existing.state
            : tool.state,
      };
    }
  }
  return merged;
}

function temporaryConversationTitle(message: string) {
  const trimmed = message.trim();
  const firstSentence = trimmed.split(/[。！？!?\r\n]/, 1)[0]?.trim();
  return (firstSentence || trimmed).slice(0, 80);
}

function historyMessages(conversationId: string, rawMessages: Array<Record<string, unknown>>) {
  const parsed: Message[] = [];
  let currentTutor: Message | undefined;
  rawMessages.forEach((raw, index) => {
    if (raw.role === "user") {
      currentTutor = undefined;
      parsed.push({
        id: `${conversationId}-${String(raw.timestamp ?? index)}`,
        role: "student",
        text: messageText(raw.content),
        time: formatMessageTime(raw.timestamp),
      });
      return;
    }
    if (raw.role === "assistant") {
      const text = messageText(raw.content).trim();
      if (!currentTutor) {
        currentTutor = {
          id: `${conversationId}-${String(raw.timestamp ?? index)}`,
          role: "tutor",
          text: "",
          time: formatMessageTime(raw.timestamp),
          tools: [],
        };
        parsed.push(currentTutor);
      }
      if (text) currentTutor.text = [currentTutor.text, text].filter(Boolean).join("\n\n");
      currentTutor.tools = mergeTools(currentTutor.tools, toolCalls(raw.content));
      if (raw.stopReason === "aborted" || raw.stopReason === "error") {
        currentTutor.runStatus = raw.stopReason === "aborted" ? "aborted" : "failed";
      }
      return;
    }
    if (raw.role === "toolResult" && typeof raw.toolCallId === "string") {
      if (!currentTutor) {
        currentTutor = {
          id: `${conversationId}-tool-${String(raw.timestamp ?? index)}`,
          role: "tutor",
          text: "",
          time: formatMessageTime(raw.timestamp),
          tools: [],
        };
        parsed.push(currentTutor);
      }
      const toolName = typeof raw.toolName === "string" ? raw.toolName : "tool";
        currentTutor.tools = mergeTools(currentTutor.tools, [{
        toolCallId: raw.toolCallId,
        toolName,
        label: toolLabel(toolName),
        state: isStudentRejectedTool(raw.content)
          ? "rejected"
          : raw.isError === true ? "error" : "complete",
          result: raw.isError === true ? undefined : toolResultText(raw.content),
          chalkboard: chalkboardDetails(raw.details),
        }]);
    }
  });
  return parsed;
}

function classifyFailure(error: unknown, fallback: FailureKind = "network"): ChatFailure {
  const structured = objectValue(error);
  const message = error instanceof Error
    ? error.message
    : typeof structured?.error === "string" ? structured.error : String(error || "未知错误");
  const code = error instanceof ApiRequestError
    ? error.code ?? ""
    : typeof structured?.code === "string" ? structured.code : "";
  const haystack = `${code} ${message}`.toLowerCase();
  const structuredCategory = typeof structured?.category === "string"
    && ["provider", "tool", "mcp", "approval", "network"].includes(structured.category)
    ? structured.category as FailureKind
    : undefined;
  const kind: FailureKind = structuredCategory ?? (haystack.includes("mcp")
    ? "mcp"
    : haystack.includes("approval") || haystack.includes("approve")
      ? "approval"
      : haystack.includes("tool")
        ? "tool"
        : haystack.includes("provider") || haystack.includes("model") || haystack.includes("credential") || haystack.includes("api key")
          ? "provider"
          : fallback);
  const copy: Record<FailureKind, Omit<ChatFailure, "kind">> = {
    provider: { title: "模型服务未完成回答", detail: `${message}。检查模型凭据或切换模型后再试。`, action: "settings" },
    tool: { title: "这一步暂时没有完成", detail: "可以稍后重试，或换一种方式描述你的问题。", action: "retry" },
    mcp: { title: "这一步暂时没有完成", detail: "相关服务没有及时响应，可以稍后重试。", action: "retry" },
    approval: { title: "工具审批没有生效", detail: `${message}。审批可能已超时或被处理，请重新发起这一步。`, action: "retry" },
    network: { title: "连接已中断", detail: `${message}。确认网络恢复后重新发送。`, action: "retry" },
  };
  return { kind, ...copy[kind] };
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

function mediaCapabilityLabel(capability: MediaCapability) {
  return ({ tts: "TTS", asr: "ASR", image: "生图", video: "视频" } as const)[capability];
}

type MediaSelection = { providerId: string; modelId: string | null } | null | undefined;

function preferredMediaModel(provider: MediaProvider, selection: MediaSelection) {
  const candidates = [
    selection?.providerId === provider.id ? selection.modelId : null,
    provider.settings?.modelId,
    provider.defaultModel,
    provider.models[0]?.id,
  ];
  return candidates.find((candidate) => provider.models.some((model) => model.id === candidate)) ?? "";
}

function MediaProviderChoice({
  provider,
  selection,
  onSelect,
}: {
  provider: MediaProvider;
  selection?: MediaSelection;
  onSelect?: (provider: MediaProvider, modelId: string) => void;
}) {
  const preferredModel = preferredMediaModel(provider, selection);
  const [modelId, setModelId] = useState(preferredModel);

  useEffect(() => setModelId(preferredModel), [preferredModel]);

  const active = selection?.providerId === provider.id;
  return <article className={`${styles.mediaProviderCard} ${active ? styles.mediaProviderCardActive : ""}`}>
    {onSelect
      ? <label className={styles.mediaProviderSelection}>
          <input
            type="radio"
            name={`${provider.capability}-provider`}
            checked={active}
            onChange={() => onSelect(provider, modelId)}
          />
          <strong>{provider.name}</strong>
        </label>
      : <span className={styles.mediaProviderIdentity}><strong>{provider.name}</strong></span>}
    <span className={styles.mediaProviderControls}>
      <select
        className={styles.mediaProviderSelect}
        aria-label={`${provider.name} 模型`}
        value={modelId}
        onChange={(event) => {
          setModelId(event.target.value);
          onSelect?.(provider, event.target.value);
        }}
      >
        {provider.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
      </select>
      {(active || !onSelect) && <span className={styles.mediaProviderStatus}>{active ? <><Check size={13} />当前使用</> : "已配置"}</span>}
    </span>
  </article>;
}

const initialConversations: typeof defaultSidebarConversations = [];
const emptyConversationMessages: Message[] = [];

export default function ChatPage() {
  const [conversations, setConversations] = useState(initialConversations);
  const [selectedId, setSelectedId] = useState("");
  const [messagesByConversation, setMessagesByConversation] = useState<Record<string, Message[]>>({});
  const [runningConversationIds, setRunningConversationIds] = useState<ReadonlySet<string>>(() => new Set());
  const [conversationFailures, setConversationFailures] = useState<Record<string, ChatFailure | undefined>>({});
  const [draft, setDraft] = useState("");
  const [selectedModel, setSelectedModel] = useState<ModelSelection | null>(null);
  const [modelOptions, setModelOptions] = useState<Model[]>([]);
  const [modelProviders, setModelProviders] = useState<Provider[]>([]);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [activeModelProviderId, setActiveModelProviderId] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [mediaProviders, setMediaProviders] = useState<MediaProviders | null>(null);
  const [capabilitySettings, setCapabilitySettings] = useState<CapabilitySettings | null>(null);
  const [mediaCapability, setMediaCapability] = useState<MediaCapability>("tts");
  const [showMediaMenu, setShowMediaMenu] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [attachedFile, setAttachedFile] = useState<AttachedFile | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<ChatFailure | null>(null);
  const [contextCollapsed, setContextCollapsed] = useState(false);
  const [isDraftConversation, setIsDraftConversation] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageViewportRef = useRef<HTMLDivElement>(null);
  const runControllersRef = useRef(new Map<string, AbortController>());
  const rejectedToolCallsRef = useRef(new Map<string, Set<string>>());
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const mediaPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => {
    for (const controller of runControllersRef.current.values()) controller.abort();
    runControllersRef.current.clear();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadWorkspace() {
      try {
        const [conversationData, providerData, modelData, mediaData, capabilities] = await Promise.all([
          chatApi.list(),
          settingsApi.providers(),
          settingsApi.models(),
          mediaApi.providers(),
          settingsApi.capabilities(),
        ]);
        if (cancelled) return;
        const nextConversations = conversationData.conversations.map((conversation) => ({ id: conversation.id, title: formatConversationTitle(conversation), group: conversationGroup(conversation.updatedAt) }));
        setConversations(nextConversations);
        const nextSelection = resolveModelSelection(modelData.models, providerData.defaultModel);
        setSelectedModel(nextSelection);
        setModelOptions(modelData.models);
        setModelProviders(providerData.providers);
        setMediaProviders(mediaData);
        setCapabilitySettings(capabilities);
        setActiveModelProviderId(nextSelection?.providerId ?? "");
        const query = new URLSearchParams(window.location.search);
        const isNewConversation = query.get("new") === "1";
        const queryId = query.get("conversation");
        const nextId = !isNewConversation && queryId && nextConversations.some((conversation) => conversation.id === queryId) ? queryId : nextConversations[0]?.id ?? "";
        if (nextId) {
          setIsDraftConversation(false);
          setSelectedId(nextId);
          await loadConversationMessages(nextId);
        }
        if (isNewConversation) prepareNewConversation();
      } catch (loadError) {
        if (!cancelled) setFailure({
          kind: "network",
          title: "工作区没有加载完成",
          detail: `${loadError instanceof Error ? loadError.message : "加载工作区失败"}。检查连接后重新加载。`,
          action: "reload",
        });
      }
    }
    void loadWorkspace();
    return () => { cancelled = true; };
    // The initial workspace load intentionally runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!showModelMenu && !showMediaMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!modelPickerRef.current?.contains(target)) setShowModelMenu(false);
      if (!mediaPickerRef.current?.contains(target)) setShowMediaMenu(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowModelMenu(false);
        setShowMediaMenu(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [showMediaMenu, showModelMenu]);

  const messages = selectedId ? messagesByConversation[selectedId] ?? emptyConversationMessages : emptyConversationMessages;
  const isStreaming = Boolean(selectedId && runningConversationIds.has(selectedId));
  const visibleFailure = (selectedId ? conversationFailures[selectedId] : undefined) ?? failure;

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
  const configuredMediaProviders = useMemo(() => {
    if (!mediaProviders) return [];
    return (Object.entries(mediaProviders) as Array<[MediaCapability, MediaProviders[MediaCapability]]>)
      .flatMap(([capability, providers]) => providers.filter((provider) => provider.configured && provider.models.length).map((provider) => ({ capability, provider })));
  }, [mediaProviders]);
  const visibleMediaProviders = configuredMediaProviders.filter((item) => item.capability === mediaCapability);
  function resetComposerState() {
    setAttachedFile(null);
    setShowModelMenu(false);
    setDraft("");
    setNotice(null);
    setFailure(null);
  }

  function updateConversationMessages(id: string, update: (messages: Message[]) => Message[]) {
    setMessagesByConversation((current) => ({
      ...current,
      [id]: update(current[id] ?? []),
    }));
  }

  function setConversationRunning(id: string, running: boolean) {
    setRunningConversationIds((current) => {
      const next = new Set(current);
      if (running) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function setConversationFailure(id: string, nextFailure: ChatFailure | undefined) {
    setConversationFailures((current) => ({ ...current, [id]: nextFailure }));
  }

  async function loadConversationMessages(id: string) {
    const data = await chatApi.messages(id);
    if (runControllersRef.current.has(id)) return;
    setMessagesByConversation((current) => ({
      ...current,
      [id]: historyMessages(id, data.messages),
    }));
  }

  async function selectConversation(id: string) {
    resetComposerState();
    setIsDraftConversation(false);
    setSelectedId(id);
    window.history.replaceState(window.history.state, "", `/chat?conversation=${id}`);
    if (messagesByConversation[id] !== undefined || runControllersRef.current.has(id)) return;
    try {
      await loadConversationMessages(id);
    } catch (loadError) {
      setConversationFailure(id, {
        kind: "network",
        title: "对话记录没有加载完成",
        detail: `${loadError instanceof Error ? loadError.message : "加载对话失败"}。检查连接后重新加载这段对话。`,
        action: "reload",
      });
    }
  }

  async function startConversation() {
    resetComposerState();
    try {
      const data = await chatApi.create();
      const next = { id: data.conversation.id, title: formatConversationTitle(data.conversation), group: conversationGroup(data.conversation.updatedAt) };
      setConversations((current) => [next, ...current]);
      setIsDraftConversation(false);
      setSelectedId(next.id);
      setMessagesByConversation((current) => ({ ...current, [next.id]: [] }));
      window.history.replaceState(null, "", `/chat?conversation=${next.id}`);
      return next.id;
    } catch (createError) {
      setFailure(classifyFailure(createError));
      return null;
    }
  }

  async function syncConversationTitle(conversationId: string, remainingAttempts = 3): Promise<void> {
    const { conversation } = await chatApi.get(conversationId);
    setConversations((current) => current.map((item) => item.id === conversationId
      ? { ...item, title: formatConversationTitle(conversation), group: conversationGroup(conversation.updatedAt) }
      : item));
    if (conversation.titleSource === 'fallback' && remainingAttempts > 0) {
      window.setTimeout(() => {
        void syncConversationTitle(conversationId, remainingAttempts - 1).catch(() => undefined);
      }, 1_500);
    }
  }

  function prepareNewConversation() {
    resetComposerState();
    setIsDraftConversation(true);
    setSelectedId("");
    if (window.location.pathname !== "/chat" || window.location.search !== "?new=1") {
      window.history.replaceState(window.history.state, "", "/chat?new=1");
    }
  }

  function stopStreaming() {
    if (!selectedId) return;
    runControllersRef.current.get(selectedId)?.abort();
    runControllersRef.current.delete(selectedId);
    void chatApi.abort(selectedId).catch(() => undefined);
    setConversationRunning(selectedId, false);
    updateConversationMessages(selectedId, (current) => current.map((message, index) => index === current.length - 1 && message.role === "tutor"
      ? {
          ...message,
          runStatus: "aborted",
          thinking: undefined,
        }
      : message));
  }

  async function sendMessage(event?: React.FormEvent, retryText?: string) {
    event?.preventDefault();
    const text = (retryText ?? draft).trim();
    if (!text) return;
    if (attachedFile?.status === "uploading") {
      setNotice("附件仍在上传，请稍候");
      return;
    }
    let conversationId = selectedId;
    if (!conversationId) conversationId = (await startConversation()) ?? "";
    if (!conversationId) return;
    if (runControllersRef.current.has(conversationId)) return;
    setConversations((current) => current.map((conversation) => conversation.id === conversationId
      ? { ...conversation, title: temporaryConversationTitle(text) || conversation.title }
      : conversation));
    setNotice(null);
    setFailure(null);
    setConversationFailure(conversationId, undefined);
    const now = new Date();
    const time = now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    const studentMessage: Message = { id: `student-${Date.now()}`, role: "student", text, time, attachment: attachedFile?.name };
    updateConversationMessages(conversationId, (current) => [...current, studentMessage]);
    setDraft("");
    setAttachedFile(null);
    setConversationRunning(conversationId, true);
    const tutorId = `tutor-${Date.now()}`;
    updateConversationMessages(conversationId, (current) => [...current, {
      id: tutorId,
      role: "tutor",
      text: "",
      time,
      tools: [],
    }]);
    const controller = new AbortController();
    runControllersRef.current.set(conversationId, controller);
    try {
      await chatApi.stream(conversationId, { message: text, model: selectedModel ?? undefined, attachmentIds: attachedFile?.id ? [attachedFile.id] : [] }, ({ type, data }) => {
        if (type === "text_delta") updateConversationMessages(conversationId, (current) => current.map((message) => message.id === tutorId ? {
          ...message,
          text: `${message.text}${String(data.delta ?? "")}`,
          thinking: undefined,
        } : message));
        if (type === "thinking_delta") updateConversationMessages(conversationId, (current) => current.map((message) => message.id === tutorId && !message.text
          ? { ...message, thinking: "running" }
          : message));
        if (type === "tool_started" || type === "tool_pending") {
          const toolCallId = String(data.toolCallId ?? "");
          const toolName = String(data.toolName ?? "tool");
          flushSync(() => {
            updateConversationMessages(conversationId, (current) => current.map((message) => message.id === tutorId ? {
              ...message,
              tools: mergeTools(message.tools, [{
                toolCallId,
                toolName,
                label: type === "tool_pending" ? String(data.label ?? toolLabel(toolName)) : toolLabel(toolName),
                state: type === "tool_pending" ? "approval" : "running",
              }]),
            } : message));
          });
        }
        if (type === "tool_updated") {
          const update = data.update;
          if (update && typeof update === "object" && "details" in update && update.details && typeof update.details === "object" && "type" in update.details && update.details.type === "subagent_running") {
            const toolCallId = String(data.toolCallId ?? "");
            updateConversationMessages(conversationId, (current) => current.map((message) => message.id === tutorId ? {
              ...message,
              tools: (message.tools ?? []).map((tool) => tool.toolCallId === toolCallId ? { ...tool, state: "running" } : tool),
            } : message));
          }
        }
        if (type === "tool_finished") {
          const toolCallId = String(data.toolCallId ?? "");
          const toolName = String(data.toolName ?? "tool");
          const result = objectValue(data.result);
          const resultText = toolResultText(result?.content);
          const rejected = rejectedToolCallsRef.current.get(conversationId)?.has(toolCallId) === true
            || isStudentRejectedTool(result?.content);
          updateConversationMessages(conversationId, (current) => current.map((message) => message.id === tutorId ? {
            ...message,
            tools: mergeTools(message.tools, [{
              toolCallId,
              toolName,
              label: message.tools?.find((tool) => tool.toolCallId === toolCallId)?.label ?? toolLabel(toolName),
              state: rejected ? "rejected" : data.isError ? "error" : "complete",
              result: data.isError || rejected ? undefined : resultText,
              chalkboard: chalkboardDetails(result?.details),
            }]),
          } : message));
          rejectedToolCallsRef.current.get(conversationId)?.delete(toolCallId);
        }
        if (type === "message_completed" && data.message?.role === "assistant") {
          const completedMessage = data.message;
          updateConversationMessages(conversationId, (current) => current.map((message) => message.id === tutorId ? {
            ...message,
            text: messageText(completedMessage.content) || message.text,
            thinking: undefined,
            tools: mergeTools(message.tools, toolCalls(completedMessage.content)),
            runStatus: completedMessage.stopReason === "aborted"
              ? "aborted"
              : completedMessage.stopReason === "error" ? "failed" : message.runStatus,
          } : message));
        }
        if (type === "error") {
          updateConversationMessages(conversationId, (current) => current.map((message) => message.id === tutorId ? { ...message, runStatus: "failed" } : message));
          setConversationFailure(conversationId, classifyFailure(data, "provider"));
        }
      }, controller.signal);
    } catch (streamError) {
      updateConversationMessages(conversationId, (current) => current.map((message) => message.id === tutorId ? { ...message, runStatus: controller.signal.aborted ? "aborted" : "failed" } : message));
      if (!controller.signal.aborted) setConversationFailure(conversationId, classifyFailure(streamError));
    } finally {
      if (runControllersRef.current.get(conversationId) === controller) {
        runControllersRef.current.delete(conversationId);
        setConversationRunning(conversationId, false);
      }
      updateConversationMessages(conversationId, (current) => current.map((message) => message.id === tutorId ? { ...message, thinking: undefined } : message));
      void syncConversationTitle(conversationId).catch(() => undefined);
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

  async function decideTool(toolCallId: string, approved: boolean) {
    if (!selectedId || !toolCallId) return;
    const conversationId = selectedId;
    setFailure(null);
    setConversationFailure(conversationId, undefined);
    if (!approved) {
      const rejected = rejectedToolCallsRef.current.get(conversationId) ?? new Set<string>();
      rejected.add(toolCallId);
      rejectedToolCallsRef.current.set(conversationId, rejected);
    }
    updateConversationMessages(conversationId, (current) => current.map((message) => ({
      ...message,
      tools: message.tools?.map((tool) => tool.toolCallId === toolCallId
        ? { ...tool, state: approved ? "running" : "rejected" }
        : tool),
    })));
    try {
      await chatApi.approve(conversationId, toolCallId, approved);
      updateConversationMessages(conversationId, (current) => current.map((message) => ({
        ...message,
        tools: message.tools?.map((tool) => {
          if (tool.toolCallId !== toolCallId) return tool;
          if (!approved) return { ...tool, state: "rejected" };
          if (tool.state === "complete" || tool.state === "error" || tool.state === "rejected") return tool;
          return { ...tool, state: "running" };
        }),
      })));
      setNotice(approved ? "已允许这次工具调用" : "已拒绝这次工具调用");
    } catch (approvalError) {
      rejectedToolCallsRef.current.get(conversationId)?.delete(toolCallId);
      updateConversationMessages(conversationId, (current) => current.map((message) => ({
        ...message,
        tools: message.tools?.map((tool) => tool.toolCallId === toolCallId
          ? { ...tool, state: "error" }
          : tool),
      })));
      setConversationFailure(conversationId, classifyFailure(approvalError, "approval"));
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
    runControllersRef.current.get(id)?.abort();
    runControllersRef.current.delete(id);
    setConversationRunning(id, false);
    void chatApi.delete(id).then(() => {
      const remaining = conversations.filter((conversation) => conversation.id !== id);
      setConversations(remaining);
      setMessagesByConversation((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setConversationFailures((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      rejectedToolCallsRef.current.delete(id);
      if (selectedId === id) {
        const next = remaining[0];
        setSelectedId(next?.id ?? "");
        if (next && messagesByConversation[next.id] === undefined) void loadConversationMessages(next.id);
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

  function toggleMediaMenu() {
    setShowModelMenu(false);
    setShowMediaMenu((open) => !open);
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

  async function selectMediaCapability(provider: MediaProvider, modelId: string) {
    const previousSettings = capabilitySettings;
    const videoSelection = provider.capability === "video" ? {
      providerId: provider.id,
      modelId,
      durationSeconds: capabilitySettings?.video?.providerId === provider.id
        ? capabilitySettings.video.durationSeconds
        : provider.durations?.[0] ?? 5,
      resolution: capabilitySettings?.video?.providerId === provider.id
        ? capabilitySettings.video.resolution
        : provider.resolutions?.includes("720p") ? "720p" as const : "1080p" as const,
    } : null;

    if (capabilitySettings && provider.capability === "image") {
      setCapabilitySettings({ ...capabilitySettings, image: { providerId: provider.id, modelId } });
    } else if (capabilitySettings && videoSelection) {
      setCapabilitySettings({ ...capabilitySettings, video: videoSelection });
    }

    try {
      const next = provider.capability === "image"
        ? await settingsApi.saveCapabilities({ image: { providerId: provider.id, modelId } })
        : videoSelection
          ? await settingsApi.saveCapabilities({ video: videoSelection })
          : null;
      if (next) {
        setCapabilitySettings(next);
        setNotice(`${provider.name} 已设为默认${provider.capability === "image" ? "生图" : "视频"}能力`);
      }
    } catch (saveError) {
      setCapabilitySettings(previousSettings);
      setNotice(saveError instanceof Error ? saveError.message : "保存媒体模型选择失败");
    }
  }

  async function reloadModelCatalog() {
    setSettingsOpen(false);
    try {
      const [providerData, modelData, mediaData, capabilities] = await Promise.all([settingsApi.providers(), settingsApi.models(), mediaApi.providers(), settingsApi.capabilities()]);
      const nextSelection = resolveModelSelection(modelData.models, selectedModel ?? providerData.defaultModel);
      setModelProviders(providerData.providers);
      setModelOptions(modelData.models);
      setSelectedModel(nextSelection);
      setActiveModelProviderId(nextSelection?.providerId ?? "");
      setMediaProviders(mediaData);
      setCapabilitySettings(capabilities);
    } catch (loadError) {
      setNotice(loadError instanceof Error ? loadError.message : "刷新模型目录失败");
    }
  }

  async function recoverFailure() {
    if (!visibleFailure) return;
    if (visibleFailure.action === "settings") {
      setFailure(null);
      if (selectedId) setConversationFailure(selectedId, undefined);
      setSettingsOpen(true);
      return;
    }
    if (visibleFailure.action === "reload") {
      if (selectedId) await selectConversation(selectedId);
      else window.location.reload();
      return;
    }
    const retryMessage = [...messages].reverse().find((message) => message.role === "student");
    setFailure(null);
    if (selectedId) setConversationFailure(selectedId, undefined);
    if (retryMessage) await sendMessage(undefined, retryMessage.text);
  }

  return (
    <main className={`${styles.workspace} ${contextCollapsed ? styles.contextCollapsed : ""}`}>
      <AppSidebar historyMode="chat" activeSection={isDraftConversation ? "new" : undefined} conversations={conversations} selectedConversationId={selectedId} runningConversationIds={runningConversationIds} onNewConversation={prepareNewConversation} onSelectConversation={(id) => { void selectConversation(id); }} onRenameConversation={renameConversation} onDeleteConversation={deleteConversation} />

      <section className={styles.chatSurface} aria-label="数学对话">
        <header className={styles.chatHeader}>
          <div><div className={styles.breadcrumb}><span>数学</span><span>/</span><strong>{selectedConversation?.title ?? "新的数学问题"}</strong></div></div>
          <div className={styles.headerActions}>{contextCollapsed && <button className={styles.iconButton} type="button" aria-label="展开学习上下文" title="展开学习上下文" onClick={() => setContextCollapsed(false)}><PanelRightOpen size={17} /></button>}</div>
        </header>

        <div ref={messageViewportRef} className={styles.messageViewport}>
          <div className={styles.messageColumn}>
            {messages.length === 0 && <div className={styles.emptyConversation}><div className={styles.emptyIcon}><SquarePen size={19} /></div><h1>把问题写下来</h1><p>从一道题、一个概念，或你卡住的某一步开始。</p></div>}
            {messages.map((message, index) => <MessageBubble
              key={message.id}
              message={message}
              pending={isStreaming && index === messages.length - 1 && message.role === "tutor" && !message.text && !message.thinking && !message.tools?.length}
              onDecideTool={(toolCallId, approved) => void decideTool(toolCallId, approved)}
            />)}
          </div>
        </div>

        <div className={styles.composerDock}>
          {visibleFailure && <div className={`${styles.failureBanner} ${styles[`failure_${visibleFailure.kind}`]}`} role="alert">
            <AlertCircle size={17} />
            <div><strong>{visibleFailure.title}</strong><p>{visibleFailure.detail}</p></div>
            <button className={styles.failureAction} type="button" onClick={() => void recoverFailure()}>
              {visibleFailure.action === "settings" ? <Settings2 size={14} /> : <RefreshCw size={14} />}
              {visibleFailure.action === "settings" ? "打开设置" : visibleFailure.action === "reload" ? "重新加载" : "重试"}
            </button>
            <button className={styles.failureDismiss} type="button" aria-label="关闭错误提示" onClick={() => { setFailure(null); if (selectedId) setConversationFailure(selectedId, undefined); }}><X size={14} /></button>
          </div>}
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
                <div ref={mediaPickerRef} className={styles.mediaPicker}>
                  <button className={styles.mediaButton} type="button" aria-expanded={showMediaMenu} onClick={toggleMediaMenu}><AudioLines size={14} /><span>媒体</span><ChevronDown size={14} /></button>
                  {showMediaMenu && <div className={styles.mediaMenu} role="dialog" aria-label="选择媒体模型">
                    <nav className={styles.mediaCapabilityList} aria-label="媒体能力">{(["tts", "asr", "image", "video"] as MediaCapability[]).map((capability) => <button key={capability} type="button" className={capability === mediaCapability ? styles.mediaCapabilityActive : ""} onClick={() => setMediaCapability(capability)}>{mediaCapabilityLabel(capability)}<small>{(capability === "tts" || capability === "asr" ? 1 : 0) + configuredMediaProviders.filter((item) => item.capability === capability).length}</small></button>)}</nav>
                    <div className={styles.mediaProviderCards}>
                      {mediaCapability === "tts" && <article className={`${styles.mediaProviderCard} ${styles.mediaProviderCardActive}`}><span className={styles.mediaProviderIdentity}><strong>本机语音</strong><small>{capabilitySettings?.speech.voiceUri ? "已选择本机声音" : "跟随浏览器默认声音"} · {capabilitySettings?.speech.language ?? "zh-CN"}</small></span><span className={styles.mediaProviderStatus}><Check size={13} />当前使用</span></article>}
                      {mediaCapability === "asr" && <article className={`${styles.mediaProviderCard} ${styles.mediaProviderCardActive}`}><span className={styles.mediaProviderIdentity}><strong>本机语音识别</strong><small>浏览器原生 · {capabilitySettings?.speech.language ?? "zh-CN"} · 无需 API Key</small></span><span className={styles.mediaProviderStatus}>本机能力</span></article>}
                      {visibleMediaProviders.map(({ provider }) => <MediaProviderChoice
                        key={`${provider.capability}/${provider.id}`}
                        provider={provider}
                        selection={provider.capability === "image" ? capabilitySettings?.image : provider.capability === "video" ? capabilitySettings?.video : undefined}
                        onSelect={provider.capability === "image" || provider.capability === "video" ? (selectedProvider, modelId) => { void selectMediaCapability(selectedProvider, modelId); } : undefined}
                      />)}
                      {!visibleMediaProviders.length && mediaCapability !== "tts" && mediaCapability !== "asr" && <p>暂无已配置模型，请先前往设置。</p>}
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
        <div className={styles.contextHeader}><div><span className={styles.railKicker}>学习上下文</span><h2>参考资料</h2></div><button className={styles.iconButton} type="button" aria-label="收起学习上下文" title="收起学习上下文" onClick={() => setContextCollapsed(true)}><PanelRightClose size={16} /></button></div>
        <section className={styles.contextEmpty} aria-live="polite"><BookOpen size={18} /><p>本次对话还没有搜索或引用资料。</p></section>
      </aside>
      {settingsOpen && <SettingsDialog onClose={() => { void reloadModelCatalog(); }} />}
    </main>
  );
}

function MessageBubble({
  message,
  pending = false,
  onDecideTool,
}: {
  message: Message;
  pending?: boolean;
  onDecideTool: (toolCallId: string, approved: boolean) => void;
}) {
  if (message.role === "student") return <div className={styles.studentMessage}><div className={styles.studentBubble}>{message.attachment && <div className={styles.attachmentPreview}><FileText size={14} /><span>{message.attachment}</span></div>}<p>{message.text}</p></div><time>{message.time}</time></div>;
  return <div className={styles.tutorMessage}>
    <div className={styles.messageAuthor}>
      <span className={styles.tutorAvatar}>C</span><strong>Chalk</strong>
      <span>{message.time}</span>
      {message.runStatus && <span className={`${styles.runStatus} ${styles[`run_${message.runStatus}`]}`}>{message.runStatus === "aborted" ? "已停止" : "未完成"}</span>}
    </div>
    {(pending || message.thinking === "running") && <div className={styles.thinkingLine}><LoaderCircle size={15} className={styles.spin} />Thinking…</div>}
    {!!message.tools?.length && <div className={styles.messageTools}>{message.tools.map((tool) => <ToolActivity
      key={tool.toolCallId}
      tool={tool}
      onApprove={() => onDecideTool(tool.toolCallId, true)}
      onDeny={() => onDecideTool(tool.toolCallId, false)}
    />)}</div>}
    {message.tools?.map((tool) => tool.chalkboard ? <InlineChalkboard key={`${tool.toolCallId}-chalkboard`} scene={tool.chalkboard} /> : null)}
    {message.text && <div className={styles.tutorCopy}><ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        table: ({ children }) => <div className={styles.tableScroll} role="region" aria-label="表格内容" tabIndex={0}><table>{children}</table></div>,
      }}
    >{message.text}</ReactMarkdown></div>}
  </div>;
}

function ToolActivity({ tool, onApprove, onDeny }: { tool: MessageTool; onApprove: () => void; onDeny: () => void }) {
  const detail = tool.state === "approval"
    ? "等待你的确认。"
    : tool.state === "error"
      ? "这一步暂时没有完成。"
      : tool.state === "rejected"
        ? "这一步已跳过。"
        : tool.state === "running"
          ? `正在调用 ${tool.label}…`
          : `${tool.label}已完成。`;
  return <div className={`${styles.toolActivity} ${styles[`tool_${tool.state}`]}`}>
    <div className={styles.toolIcon}>{tool.state === "running" ? <LoaderCircle size={15} className={styles.spin} /> : tool.state === "error" || tool.state === "rejected" ? <X size={15} /> : tool.state === "complete" ? <Check size={15} /> : <Activity size={15} />}</div>
    <div className={styles.toolCopy}>
      <strong title={tool.label}>{tool.label}</strong>
      <p>{detail}</p>
      {tool.result && <details className={styles.toolResult}>
        <summary>查看结果<ChevronDown size={13} /></summary>
        <p>{tool.result}</p>
      </details>}
      {tool.state === "approval" && <div className={styles.approvalActions}><button className={styles.approveButton} type="button" onClick={onApprove}><Check size={14} />允许</button><button className={styles.denyButton} type="button" onClick={onDeny}>拒绝</button></div>}
    </div>
  </div>;
}
