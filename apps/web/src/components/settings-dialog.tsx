"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  AudioLines,
  Archive,
  BrainCircuit,
  Database,
  Check,
  Eye,
  Globe2,
  ImageIcon,
  KeyRound,
  PlugZap,
  Plus,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  Server,
  Trash2,
  Video,
  Wrench,
  X,
} from "lucide-react";

import {
  settingsApi,
  type CustomModel,
  type McpServer,
  type Model,
  type Provider,
  type RagSettings as RagSettingsData,
  type Skill,
  type SkillDetails,
  type Tool,
} from "../api";
import { memoryApi, type MemoryEntry } from "../api";
import styles from "./app-sidebar.module.css";
import { MediaProviderSettings } from "./media-provider-settings";
import { SecretInput } from "./secret-input";

type SettingsTab = "api" | "skills" | "mcp" | "tools" | "memory";
type ApiSubtab = "models" | "rag" | "voice" | "image" | "video" | "search";

type McpDraft = {
  id?: string;
  name: string;
  url: string;
  bearerToken: string;
  enabled: boolean;
};

type CustomProviderDraft = {
  id?: string;
  name: string;
  baseUrl: string;
  models: CustomModel[];
  apiKey: string;
};

type UserSkillDraft = {
  id?: string;
  name: string;
  description: string;
  content: string;
  version: string;
  references: string;
};

const emptyCustomProviderDraft: CustomProviderDraft = {
  name: "",
  baseUrl: "",
  models: [newCustomModel()],
  apiKey: "",
};

function newCustomModel(): CustomModel {
  return {
    id: "",
    name: "",
    reasoning: false,
    input: ["text"],
    contextWindow: 128_000,
    maxTokens: 16_000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

const emptyMcpDraft: McpDraft = {
  name: "",
  url: "",
  bearerToken: "",
  enabled: true,
};

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  const [tab, setTab] = useState<SettingsTab>("api");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [diagnostics, setDiagnostics] = useState<Array<{ message: string; code: string }>>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [ragSettings, setRagSettings] = useState<RagSettingsData | null>(null);
  const [memoryEntries, setMemoryEntries] = useState<MemoryEntry[]>([]);
  const [memoryInjectionEnabled, setMemoryInjectionEnabled] = useState(true);
  const [showArchivedMemory, setShowArchivedMemory] = useState(false);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memoryEditing, setMemoryEditing] = useState<string | null>(null);
  const [memoryDraft, setMemoryDraft] = useState("");
  const [providerId, setProviderId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [mcpDraft, setMcpDraft] = useState<McpDraft | null>(null);
  const [customDraft, setCustomDraft] = useState<CustomProviderDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [skillDraft, setSkillDraft] = useState<UserSkillDraft | null>(null);
  const [skillDetail, setSkillDetail] = useState<SkillDetails | null>(null);
  const [skillDetailLoading, setSkillDetailLoading] = useState<string | null>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  async function loadSettings() {
    setLoading(true);
    setError(null);
    try {
      const data = await settingsApi.load();
      setProviders(data.providers);
      setProviderId((current) => data.providers.some((provider) => provider.id === current)
        ? current
        : data.defaultModel?.providerId ?? data.providers.find((provider) => provider.configured)?.id ?? data.providers[0]?.id ?? "");
      setSkills(data.skills);
      setDiagnostics(data.diagnostics ?? []);
      setMcpServers(data.servers);
      setTools(data.tools);
      setRagSettings(await settingsApi.rag());
      setMemoryInjectionEnabled(data.memoryInjectionEnabled);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载工作区配置失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSettings();
  }, []);

  useEffect(() => {
    if (!providerId) {
      setModels([]);
      setModelsLoading(false);
      setModelsError(null);
      return;
    }
    let cancelled = false;
    setModelsLoading(true);
    setModelsError(null);
    void settingsApi.models(providerId)
      .then((data) => {
        if (!cancelled) setModels(data.models);
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        setModels([]);
        setModelsError(loadError instanceof Error ? loadError.message : "读取模型目录失败");
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });
    return () => { cancelled = true; };
  }, [providerId]);

  useEffect(() => {
    if (tab !== "memory") return;
    setMemoryLoading(true);
    setError(null);
    void memoryApi.list({ layer: "L3", includeArchived: showArchivedMemory })
      .then((result) => setMemoryEntries(result.entries))
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : "加载学习记忆失败"))
      .finally(() => setMemoryLoading(false));
  }, [tab, showArchivedMemory]);

  async function updateMemory(id: string, input: { text?: string; status?: "active" | "archived" }) {
    try {
      const result = await memoryApi.update(id, input);
      setMemoryEntries((current) => showArchivedMemory || input.status !== "archived"
        ? current.map((entry) => entry.id === id ? result.entry : entry)
        : current.filter((entry) => entry.id !== id));
      setMemoryEditing(null);
      setNotice(input.status ? (input.status === "archived" ? "记忆已归档" : "记忆已恢复") : "记忆已更新");
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "更新学习记忆失败");
    }
  }

  async function toggleMemoryInjection() {
    const next = !memoryInjectionEnabled;
    setBusy("memory-injection");
    setError(null);
    try {
      const result = await settingsApi.setMemoryEnabled(next);
      setMemoryInjectionEnabled(result.memoryInjectionEnabled);
      setNotice(next ? "已开启记忆注入" : "已关闭记忆注入");
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "更新记忆设置失败");
    } finally {
      setBusy(null);
    }
  }

  async function updateMemoryConsolidation() {
    setBusy("memory-update");
    setError(null);
    try {
      const result = await memoryApi.consolidate();
      const refreshed = await memoryApi.list({ layer: "L3", includeArchived: showArchivedMemory });
      setMemoryEntries(refreshed.entries);
      setNotice(`记忆已更新：处理 ${result.run.processed} 条活动，新增 ${result.run.added} 条记忆`);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "更新学习记忆失败");
    } finally {
      setBusy(null);
    }
  }

  async function saveApiSettings(event: FormEvent) {
    event.preventDefault();
    if (!providerId) return;
    setBusy("api");
    setError(null);
    try {
      if (apiKey.trim()) {
        await settingsApi.saveCredential(providerId, apiKey.trim());
      }
      setApiKey("");
      if (apiKey.trim()) {
        setProviders((current) => current.map((provider) => provider.id === providerId ? { ...provider, configured: true, canRemoveCredential: true } : provider));
      }
      setNotice("Provider 配置已保存");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存模型配置失败");
    } finally {
      setBusy(null);
    }
  }

  async function removeCredential() {
    if (!providerId) return;
    const provider = providers.find((item) => item.id === providerId);
    if (!provider || !window.confirm(`移除 ${provider.name} 的凭据？移除后将无法调用该 Provider，重新保存凭据后可恢复。`)) return;
    setBusy(`credential:${providerId}`);
    setError(null);
    setNotice(null);
    try {
      let configured = false;
      if (provider.custom) {
        const result = await settingsApi.updateCustomProvider(providerId, {
          name: provider.name,
          baseUrl: provider.baseUrl ?? "",
          models: provider.models ?? [],
          apiKey: "",
        });
        configured = result.provider.configured;
      } else {
        const result = await settingsApi.removeCredential(providerId);
        configured = result.configured;
      }
      setProviders((current) => current.map((item) => item.id === providerId ? { ...item, configured, canRemoveCredential: false } : item));
      setNotice("凭据已移除");
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "移除凭据失败");
    } finally {
      setBusy(null);
    }
  }

  async function testProviderConnection() {
    const model = models.find((item) => item.providerId === providerId);
    if (!providerId || !model) return;
    setBusy(`test:${providerId}`);
    setError(null);
    setNotice(null);
    try {
      const result = await settingsApi.testProvider(providerId, model.id);
      if (!result.ok) throw new Error(result.error ?? "模型服务拒绝了连接测试");
      setNotice(`连接正常，${result.durationMs ?? 0} ms`);
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : "连接测试失败");
    } finally {
      setBusy(null);
    }
  }

  async function saveCustomProvider(event: FormEvent) {
    event.preventDefault();
    if (!customDraft) return;
    setBusy("custom");
    setError(null);
    try {
      const input = {
        name: customDraft.name,
        baseUrl: customDraft.baseUrl,
        models: customDraft.models.map((model) => ({
          ...model,
          id: model.id.trim(),
          name: model.name.trim(),
        })),
        ...(customDraft.apiKey ? { apiKey: customDraft.apiKey } : {}),
      };
      const data = customDraft.id
        ? await settingsApi.updateCustomProvider(customDraft.id, input)
        : await settingsApi.createCustomProvider(input);
      const providerData = await settingsApi.providers();
      setProviders(providerData.providers);
      setProviderId(data.provider.id);
      setCustomDraft(null);
      setNotice(customDraft.id ? "自定义 Provider 已更新" : "自定义 Provider 已添加");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "保存自定义 Provider 失败");
    } finally {
      setBusy(null);
    }
  }

  async function deleteCustomProvider(id: string) {
    setBusy(`custom:${id}`);
    try {
      await settingsApi.deleteCustomProvider(id);
      const providerData = await settingsApi.providers();
      setProviders(providerData.providers);
      setProviderId(providerData.providers.find((provider) => provider.configured)?.id ?? providerData.providers[0]?.id ?? "");
      setCustomDraft(null);
      setNotice("自定义 Provider 已删除");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除 Provider 失败");
    } finally {
      setBusy(null);
    }
  }

  async function toggleSkill(skill: Skill) {
    setBusy(`skill:${skill.name}`);
    try {
      await settingsApi.setSkillEnabled(skill.name, !skill.enabled);
      setSkills((current) => current.map((item) => item.name === skill.name ? { ...item, enabled: !item.enabled } : item));
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "更新 Skill 失败");
    } finally {
      setBusy(null);
    }
  }

  async function saveUserSkill(event: FormEvent) {
    event.preventDefault();
    if (!skillDraft) return;
    setBusy('user-skill');
    setError(null);
    try {
      const references: Record<string, string> = {};
      for (const line of skillDraft.references.split('\n')) {
        const separator = line.indexOf('::');
        if (separator <= 0) continue;
        const path = line.slice(0, separator).trim();
        if (path) references[path] = line.slice(separator + 2);
      }
      const input = { name: skillDraft.name.trim(), description: skillDraft.description.trim(), content: skillDraft.content, version: skillDraft.version.trim() || '1.0.0', references };
      const response = skillDraft.id
        ? await settingsApi.updateUserSkill(skillDraft.id, input)
        : await settingsApi.createUserSkill(input);
      setSkillDraft(null);
      setNotice(skillDraft.id ? 'Skill 已更新' : 'Skill 已创建');
      await loadSettings();
      void response;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存 Skill 失败');
    } finally {
      setBusy(null);
    }
  }

  async function deleteUserSkill(skill: Skill) {
    const id = skill.source.id.startsWith('user-skill-') ? skill.source.id.slice('user-skill-'.length) : undefined;
    if (!id || !window.confirm(`确定删除 Skill「${skill.name}」吗？`)) return;
    setBusy(`delete-skill:${id}`);
    try {
      await settingsApi.deleteUserSkill(id);
      setSkills((current) => current.filter((item) => item.name !== skill.name));
      setNotice('Skill 已删除');
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除 Skill 失败');
    } finally {
      setBusy(null);
    }
  }

  async function editUserSkill(skill: Skill) {
    const id = skill.source.id.startsWith('user-skill-') ? skill.source.id.slice('user-skill-'.length) : undefined;
    if (!id) return;
    setSkillDetail(null);
    setBusy(`edit-skill:${id}`);
    try {
      const { skill: full } = await settingsApi.getUserSkill(id);
      setSkillDraft({ id, name: full.name, description: full.description, content: full.content, version: full.version, references: Object.entries(full.references ?? {}).map(([path, content]) => `${path}::${content}`).join('\n') });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取 Skill 失败');
    } finally {
      setBusy(null);
    }
  }

  async function viewSkill(skill: Skill) {
    setSkillDetailLoading(skill.name);
    setError(null);
    try {
      const { skill: details } = await settingsApi.getSkill(skill.name);
      setSkillDetail(details);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取 Skill 失败');
    } finally {
      setSkillDetailLoading(null);
    }
  }

  async function saveMcp(event: FormEvent) {
    event.preventDefault();
    if (!mcpDraft) return;
    setBusy("mcp");
    try {
      const payload = {
        name: mcpDraft.name,
        transport: "http",
        enabled: mcpDraft.enabled,
        url: mcpDraft.url,
        ...(mcpDraft.bearerToken.trim() ? { bearerToken: mcpDraft.bearerToken.trim() } : {}),
      };
      const data = await settingsApi.saveMcp(payload, mcpDraft.id);
      setMcpServers((current) => mcpDraft.id ? current.map((server) => server.id === data.server.id ? data.server : server) : [data.server, ...current]);
      setMcpDraft(null);
      setNotice("MCP 配置已保存");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存 MCP 配置失败");
    } finally {
      setBusy(null);
    }
  }

  async function toggleMcp(server: McpServer) {
    setBusy(`mcp:${server.id}`);
    try {
      const data = await settingsApi.toggleMcp(server.id, !server.enabled);
      setMcpServers((current) => current.map((item) => item.id === server.id ? data.server : item));
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "更新 MCP 状态失败");
    } finally {
      setBusy(null);
    }
  }

  async function testMcp(server: McpServer) {
    setBusy(`test:${server.id}`);
    try {
      const data = await settingsApi.testMcp(server.id);
      setNotice(`${server.name} 已连接，发现 ${data.status.toolCount} 个工具`);
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : `${server.name} 连接失败`);
    } finally {
      setBusy(null);
    }
  }

  async function deleteMcp(server: McpServer) {
    setBusy(`delete:${server.id}`);
    try {
      await settingsApi.deleteMcp(server.id);
      setMcpServers((current) => current.filter((item) => item.id !== server.id));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除 MCP 配置失败");
    } finally {
      setBusy(null);
    }
  }

  async function updateTool(tool: Tool, patch: Partial<Pick<Tool, "enabled" | "approval">>) {
    setBusy(`tool:${tool.name}`);
    try {
      const next = { enabled: patch.enabled ?? tool.enabled, approval: patch.approval ?? tool.approval };
      await settingsApi.updateTool(tool.name, next);
      setTools((current) => current.map((item) => item.name === tool.name ? { ...item, ...next } : item));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "更新工具设置失败");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.settingsOverlay} role="presentation" onMouseDown={onClose}>
      <section ref={dialogRef} className={styles.settingsDialog} role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
        <header className={styles.settingsHeader}>
          <div><span>工作区配置</span><h2 id="settings-title">设置</h2></div>
          <button className={styles.closeButton} type="button" aria-label="关闭设置" title="关闭设置" onClick={onClose}><X size={18} /></button>
        </header>
        <div className={styles.settingsBody}>
          <nav className={styles.settingsNav} aria-label="设置分类">
            <SettingsTabButton active={tab === "api"} icon={<KeyRound size={16} />} label="API" onClick={() => setTab("api")} />
            <SettingsTabButton active={tab === "skills"} icon={<BrainCircuit size={16} />} label="Skills" onClick={() => setTab("skills")} />
            <SettingsTabButton active={tab === "mcp"} icon={<Server size={16} />} label="MCP" onClick={() => setTab("mcp")} />
            <SettingsTabButton active={tab === "tools"} icon={<Wrench size={16} />} label="Tools" onClick={() => setTab("tools")} />
            <SettingsTabButton active={tab === "memory"} icon={<BrainCircuit size={16} />} label="记忆" onClick={() => setTab("memory")} />
          </nav>
          <div className={styles.settingsContent}>
            {loading && <p>正在加载工作区配置…</p>}
            {error && <div className={styles.settingsAlert} role="alert"><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="关闭错误"><X size={14} /></button></div>}
            {notice && <div className={styles.settingsNotice} role="status"><span>{notice}</span><button type="button" onClick={() => setNotice(null)} aria-label="关闭提示"><X size={14} /></button></div>}
            {!loading && tab === "api" && <ApiSettings providers={providers} models={models} modelsLoading={modelsLoading} modelsError={modelsError} ragSettings={ragSettings} providerId={providerId} apiKey={apiKey} customDraft={customDraft} busy={busy} setProviderId={(value) => { setProviderId(value); setApiKey(""); setCustomDraft(null); }} setApiKey={setApiKey} setCustomDraft={setCustomDraft} onSave={saveApiSettings} onRemoveCredential={removeCredential} onTestConnection={testProviderConnection} onSaveCustom={saveCustomProvider} onDeleteCustom={deleteCustomProvider} />}
            {!loading && tab === "skills" && <SkillsSettings skills={skills} diagnostics={diagnostics} busy={busy} draft={skillDraft} detail={skillDetail} detailLoading={skillDetailLoading} onDraftChange={(draft) => { setSkillDraft(draft); if (draft) setSkillDetail(null); }} onSave={saveUserSkill} onToggle={toggleSkill} onEdit={editUserSkill} onDelete={deleteUserSkill} onView={viewSkill} onCloseDetail={() => setSkillDetail(null)} />}
            {!loading && tab === "mcp" && <McpSettings servers={mcpServers} draft={mcpDraft} busy={busy} onStartNew={() => setMcpDraft(emptyMcpDraft)} onEdit={(server) => setMcpDraft(serverToDraft(server))} onDraftChange={setMcpDraft} onSave={saveMcp} onCancel={() => setMcpDraft(null)} onToggle={toggleMcp} onTest={testMcp} onDelete={deleteMcp} />}
            {!loading && tab === "tools" && <ToolsSettings tools={tools} busy={busy} onUpdate={updateTool} />}
            {tab === "memory" && <MemorySettings entries={memoryEntries} loading={memoryLoading} memoryInjectionEnabled={memoryInjectionEnabled} memoryInjectionBusy={busy === "memory-injection"} memoryUpdateBusy={busy === "memory-update"} onToggleMemoryInjection={() => void toggleMemoryInjection()} onUpdateMemory={() => void updateMemoryConsolidation()} showArchived={showArchivedMemory} onToggleArchived={() => setShowArchivedMemory((value) => !value)} editingId={memoryEditing} draft={memoryDraft} onBeginEdit={(entry) => { setMemoryEditing(entry.id); setMemoryDraft(entry.text); }} onDraftChange={setMemoryDraft} onCancelEdit={() => setMemoryEditing(null)} onSave={(id) => updateMemory(id, { text: memoryDraft.trim() })} onArchive={(id, status) => updateMemory(id, { status })} />}
          </div>
        </div>
      </section>
    </div>
  );
}

function SettingsTabButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return <button className={active ? styles.settingsTabActive : ""} type="button" role="tab" aria-selected={active} onClick={onClick}>{icon}<span>{label}</span></button>;
}

function RagSettings({ settings }: { settings: RagSettingsData }) {
  const [subtab, setSubtab] = useState<"embedding" | "rerank" | "pdf">("embedding");
  const [draft, setDraft] = useState(settings);
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tabs = [
    ["embedding", "Embedding"],
    ["rerank", "Rerank"],
    ["pdf", "PDF"],
  ] as const;
  return <div>
    <div className={styles.voiceSubnav} role="tablist" aria-label="RAG 配置分类">
      {tabs.map(([id, label]) => <ApiSubtabButton key={id} active={subtab === id} icon={<Database size={14} />} label={label} onClick={() => setSubtab(id)} />)}
    </div>
    {message && <div className={styles.settingsNotice} role="status">{message}</div>}
    {error && <div className={styles.settingsAlert} role="alert">{error}</div>}
    {subtab === "embedding" && <RagEditablePanel title="Embedding" description="LightRAG 使用的向量模型。" configured={draft.embedding.configured} fields={<><label className={styles.settingsField}><span>模型</span><input value={draft.embedding.model} onChange={(e) => setDraft({ ...draft, embedding: { ...draft.embedding, model: e.target.value } })} /></label><label className={styles.settingsField}><span>Base URL</span><input type="url" value={draft.embedding.baseUrl} onChange={(e) => setDraft({ ...draft, embedding: { ...draft.embedding, baseUrl: e.target.value } })} /></label></>} secret={secret} setSecret={setSecret} saving={saving} onSave={async () => { setSaving(true); setError(null); try { const next = await settingsApi.saveRag({ embedding: { model: draft.embedding.model, baseUrl: draft.embedding.baseUrl, ...(secret ? { apiKey: secret } : {}) } }); setDraft(next); setSecret(""); setMessage("Embedding 配置已保存"); } catch (e) { setError(e instanceof Error ? e.message : "保存失败"); } finally { setSaving(false); } }} />}
    {subtab === "rerank" && <RagEditablePanel title="Rerank" description="检索候选结果的二次排序服务。" configured={draft.rerank.configured} fields={<><label className={styles.settingsField}><span>模型</span><input value={draft.rerank.model} onChange={(e) => setDraft({ ...draft, rerank: { ...draft.rerank, model: e.target.value } })} /></label><label className={styles.settingsField}><span>Endpoint</span><input type="url" value={draft.rerank.url} onChange={(e) => setDraft({ ...draft, rerank: { ...draft.rerank, url: e.target.value } })} /></label></>} secret={secret} setSecret={setSecret} saving={saving} onSave={async () => { setSaving(true); setError(null); try { const next = await settingsApi.saveRag({ rerank: { model: draft.rerank.model, url: draft.rerank.url, ...(secret ? { apiKey: secret } : {}) } }); setDraft(next); setSecret(""); setMessage("Rerank 配置已保存"); } catch (e) { setError(e instanceof Error ? e.message : "保存失败"); } finally { setSaving(false); } }} />}
    {subtab === "pdf" && <RagEditablePanel title="PDF 解析" description="文档进入 LightRAG 前由 Python sidecar 执行。" configured={draft.pdf.engine !== "mineru" || draft.pdf.mode === "cloud" || draft.pdf.mode === "local"} fields={<><label className={styles.settingsField}><span>解析器</span><select value={draft.pdf.engine} onChange={(e) => setDraft({ ...draft, pdf: { ...draft.pdf, engine: e.target.value } })}><option value="mineru">MinerU</option><option value="markitdown">MarkItDown</option><option value="text_only">Text only</option></select></label><label className={styles.settingsField}><span>模式</span><select value={draft.pdf.mode} onChange={(e) => setDraft({ ...draft, pdf: { ...draft.pdf, mode: e.target.value } })}><option value="cloud">云端 API</option><option value="local">本地 CLI</option></select></label><label className={styles.settingsField}><span>模型版本</span><input value={draft.pdf.modelVersion} onChange={(e) => setDraft({ ...draft, pdf: { ...draft.pdf, modelVersion: e.target.value } })} /></label><label className={styles.settingsField}><span>语言</span><input value={draft.pdf.language} onChange={(e) => setDraft({ ...draft, pdf: { ...draft.pdf, language: e.target.value } })} /></label><label><input type="checkbox" checked={draft.pdf.ocr} onChange={(e) => setDraft({ ...draft, pdf: { ...draft.pdf, ocr: e.target.checked } })} /> OCR</label><label><input type="checkbox" checked={draft.pdf.formula} onChange={(e) => setDraft({ ...draft, pdf: { ...draft.pdf, formula: e.target.checked } })} /> 公式</label><label><input type="checkbox" checked={draft.pdf.table} onChange={(e) => setDraft({ ...draft, pdf: { ...draft.pdf, table: e.target.checked } })} /> 表格</label></>} secret={secret} setSecret={setSecret} saving={saving} onSave={async () => { setSaving(true); setError(null); try { const next = await settingsApi.saveRag({ pdf: { ...draft.pdf, ...(secret ? { apiToken: secret } : {}) } }); setDraft(next); setSecret(""); setMessage("PDF 配置已保存"); } catch (e) { setError(e instanceof Error ? e.message : "保存失败"); } finally { setSaving(false); } }} />}
    <p className={styles.ragSettingsHint}>保存后新的文档或“重新索引”会使用新配置。`.env` 仍作为重新部署后的默认配置来源。</p>
  </div>;
}

function RagEditablePanel({ title, description, configured, fields, secret, setSecret, saving, onSave }: { title: string; description: string; configured: boolean; fields: ReactNode; secret: string; setSecret: (value: string) => void; saving: boolean; onSave: () => Promise<void> }) {
  return <section className={styles.ragPanel}><div className={styles.settingsTitle}><div><h4>{title}</h4><p>{description}</p></div><span className={configured ? styles.ragConfigured : styles.ragUnconfigured}>{configured ? "已配置" : "未配置"}</span></div>{fields}<div className={styles.settingsField}><label>密钥（留空则保留现有值）</label><SecretInput value={secret} onChange={(event) => setSecret(event.target.value)} autoComplete="new-password" /></div><div className={styles.settingsFooter}><span>修改后新的索引任务会使用此配置</span><button className={styles.saveButton} type="button" onClick={() => void onSave()} disabled={saving}><Save size={14} />{saving ? "保存中…" : "保存配置"}</button></div></section>;
}

function RagConfigPanel({ title, description, configured, rows }: { title: string; description: string; configured: boolean; rows: Array<[string, string]> }) {
  return <section className={styles.ragPanel} aria-labelledby={`rag-${title}`}><div className={styles.settingsTitle}><div><h4 id={`rag-${title}`}>{title}</h4><p>{description}</p></div><span className={configured ? styles.ragConfigured : styles.ragUnconfigured}>{configured ? "已配置" : "未配置"}</span></div><dl className={styles.ragFacts}>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={value}>{value}</dd></div>)}</dl></section>;
}

function ApiSettings(props: {
  providers: Provider[];
  models: Model[];
  modelsLoading: boolean;
  modelsError: string | null;
  ragSettings: RagSettingsData | null;
  providerId: string;
  apiKey: string;
  customDraft: CustomProviderDraft | null;
  busy: string | null;
  setProviderId: (value: string) => void;
  setApiKey: (value: string) => void;
  setCustomDraft: (value: CustomProviderDraft | null) => void;
  onSave: (event: FormEvent) => Promise<void>;
  onRemoveCredential: () => Promise<void>;
  onTestConnection: () => Promise<void>;
  onSaveCustom: (event: FormEvent) => Promise<void>;
  onDeleteCustom: (id: string) => Promise<void>;
}) {
  const [subtab, setSubtab] = useState<ApiSubtab>("models");
  const [voiceCapability, setVoiceCapability] = useState<"tts" | "asr">("tts");
  const selected = props.providers.find((provider) => provider.id === props.providerId);
  const modelOptions = props.models.filter((model) => model.providerId === props.providerId);
  const editSelectedCustomProvider = () => {
    if (!selected?.custom) return;
    props.setCustomDraft({
      id: selected.id,
      name: selected.name,
      baseUrl: selected.baseUrl ?? "",
      models: selected.models?.length ? selected.models : modelOptions.map((model) => ({
        id: model.id,
        name: model.name,
        reasoning: model.reasoning,
        input: model.input.filter((value): value is "text" | "image" => value === "text" || value === "image"),
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        cost: model.cost,
      })),
      apiKey: "",
    });
  };
  const updateCustomModel = (index: number, next: CustomModel) => {
    if (!props.customDraft) return;
    props.setCustomDraft({
      ...props.customDraft,
      models: props.customDraft.models.map((model, modelIndex) => modelIndex === index ? next : model),
    });
  };
  return <div>
    <nav className={styles.apiSubnav} aria-label="API 类型" role="tablist">
      <ApiSubtabButton active={subtab === "models"} icon={<BrainCircuit size={15} />} label="大模型" onClick={() => setSubtab("models")} />
      <ApiSubtabButton active={subtab === "rag"} icon={<Database size={15} />} label="RAG" onClick={() => setSubtab("rag")} />
      <ApiSubtabButton active={subtab === "voice"} icon={<AudioLines size={15} />} label="语音" onClick={() => setSubtab("voice")} />
      <ApiSubtabButton active={subtab === "image"} icon={<ImageIcon size={15} />} label="生图" onClick={() => setSubtab("image")} />
      <ApiSubtabButton active={subtab === "video"} icon={<Video size={15} />} label="视频" onClick={() => setSubtab("video")} />
      <ApiSubtabButton active={subtab === "search"} icon={<Globe2 size={15} />} label="Web Search" onClick={() => setSubtab("search")} />
    </nav>
    {subtab === "rag" ? props.ragSettings ? <RagSettings settings={props.ragSettings} /> : <p className={styles.emptySettings}>正在读取 RAG 配置…</p> : subtab === "voice" ? <div>
      <div className={styles.voiceSubnav} role="tablist" aria-label="语音能力">
        <ApiSubtabButton active={voiceCapability === "tts"} icon={<AudioLines size={14} />} label="TTS 文本转语音" onClick={() => setVoiceCapability("tts")} />
        <ApiSubtabButton active={voiceCapability === "asr"} icon={<AudioLines size={14} />} label="ASR 语音识别" onClick={() => setVoiceCapability("asr")} />
      </div>
      <MediaProviderSettings capability={voiceCapability} />
    </div> : subtab === "image" || subtab === "video" ? <MediaProviderSettings capability={subtab} /> : subtab === "search" ? <ApiComingSoon type={subtab} /> : <div className={styles.providerWorkspace}>
      <aside className={styles.providerRail} aria-label="模型 Provider">
        <div className={styles.providerRailHeader}><span>Provider</span><button type="button" aria-label="添加自定义 Provider" title="添加自定义 Provider" onClick={() => props.setCustomDraft({ ...emptyCustomProviderDraft, models: [newCustomModel()] })}><Plus size={15} /></button></div>
        <div className={styles.providerList}>{props.providers.map((provider) => <button key={provider.id} type="button" className={provider.id === props.providerId && !props.customDraft ? styles.providerListItemActive : ""} onClick={() => props.setProviderId(provider.id)} aria-pressed={provider.id === props.providerId && !props.customDraft}><span className={styles.providerListIcon}>{provider.custom ? <PlugZap size={14} /> : <BrainCircuit size={14} />}</span><span className={styles.providerListCopy}><strong>{provider.name}</strong><small>{provider.configured ? "已配置" : "未配置"} · {provider.modelCount} 个模型</small></span><span className={`${styles.providerStatusDot} ${provider.configured ? styles.providerStatusDotReady : ""}`} aria-hidden="true" /></button>)}</div>
      </aside>
      <section className={styles.providerDetail} aria-live="polite">
        {props.customDraft ? <form className={styles.customProviderEditor} onSubmit={props.onSaveCustom}>
          <div className={styles.settingsTitle}><div><h3>{props.customDraft.id ? "编辑自定义 Provider" : "添加自定义 Provider"}</h3><p>作为普通 Provider 接入兼容 OpenAI Chat Completions 的模型服务。</p></div></div>
          <label className={styles.settingsField}><span>名称</span><input value={props.customDraft.name} onChange={(event) => props.setCustomDraft({ ...props.customDraft!, name: event.target.value })} required /></label>
          <label className={styles.settingsField}><span>Base URL</span><input type="url" value={props.customDraft.baseUrl} onChange={(event) => props.setCustomDraft({ ...props.customDraft!, baseUrl: event.target.value })} placeholder="https://example.com/v1" required /></label>
          <div className={styles.settingsField}><label htmlFor="custom-provider-api-key">API Key{props.customDraft.id ? "（留空则保留原值）" : "（可选）"}</label><SecretInput id="custom-provider-api-key" value={props.customDraft.apiKey} onChange={(event) => props.setCustomDraft({ ...props.customDraft!, apiKey: event.target.value })} autoComplete="new-password" /></div>
          <section className={styles.customModels} aria-labelledby="custom-models-title"><header><div><h4 id="custom-models-title">模型</h4><p>每个模型独立配置能力、容量和价格。</p></div><button className={styles.secondaryButton} type="button" onClick={() => props.setCustomDraft({ ...props.customDraft!, models: [...props.customDraft!.models, newCustomModel()] })}><Plus size={14} />添加模型</button></header><div className={styles.customModelList}>{props.customDraft.models.map((model, index) => <section className={styles.customModelRow} key={index} aria-labelledby={`custom-model-${index}`}>
            <header className={styles.customModelRowHeader}><div><strong id={`custom-model-${index}`}>模型 {index + 1}</strong><small>{model.name || model.id || "未命名模型"}</small></div><button className={styles.removeCustomModel} type="button" aria-label={`移除模型 ${model.name || index + 1}`} title="移除模型" disabled={props.customDraft!.models.length === 1} onClick={() => props.setCustomDraft({ ...props.customDraft!, models: props.customDraft!.models.filter((_, modelIndex) => modelIndex !== index) })}><Trash2 size={15} /></button></header>
            <div className={styles.customModelIdentityFields}><label><span>显示名称</span><input value={model.name} onChange={(event) => updateCustomModel(index, { ...model, name: event.target.value })} placeholder="例如 GPT-5" required /></label><label><span>模型 ID</span><input value={model.id} onChange={(event) => updateCustomModel(index, { ...model, id: event.target.value })} placeholder="例如 gpt-5" required /></label></div>
            <div className={styles.customModelCapacityFields}><label><span>上下文窗口</span><input type="number" min={1024} step={1024} value={model.contextWindow} onChange={(event) => updateCustomModel(index, { ...model, contextWindow: Number(event.target.value) })} required /></label><label><span>最大输出 Token</span><input type="number" min={1} value={model.maxTokens} onChange={(event) => updateCustomModel(index, { ...model, maxTokens: Number(event.target.value) })} required /></label></div>
            <div className={styles.customModelCapabilities}><label><input type="checkbox" checked={model.reasoning} onChange={(event) => updateCustomModel(index, { ...model, reasoning: event.target.checked })} /><span>支持思考强度</span></label><label><input type="checkbox" checked={model.input.includes("image")} onChange={(event) => updateCustomModel(index, { ...model, input: event.target.checked ? ["text", "image"] : ["text"] })} /><span>支持图片输入</span></label></div>
            <fieldset className={styles.customModelPrices}><legend>价格（美元 / 百万 Token）</legend><div><label><span>输入</span><input type="number" min={0} step="any" value={model.cost.input} onChange={(event) => updateCustomModel(index, { ...model, cost: { ...model.cost, input: Number(event.target.value) } })} /></label><label><span>输出</span><input type="number" min={0} step="any" value={model.cost.output} onChange={(event) => updateCustomModel(index, { ...model, cost: { ...model.cost, output: Number(event.target.value) } })} /></label><label><span>缓存读取</span><input type="number" min={0} step="any" value={model.cost.cacheRead} onChange={(event) => updateCustomModel(index, { ...model, cost: { ...model.cost, cacheRead: Number(event.target.value) } })} /></label><label><span>缓存写入</span><input type="number" min={0} step="any" value={model.cost.cacheWrite} onChange={(event) => updateCustomModel(index, { ...model, cost: { ...model.cost, cacheWrite: Number(event.target.value) } })} /></label></div></fieldset>
          </section>)}</div></section>
          <div className={styles.settingsFooter}><span /><span className={styles.settingsActions}><button className={styles.textButton} type="button" onClick={() => props.setCustomDraft(null)}>取消</button><button className={styles.saveButton} type="submit" disabled={props.busy === "custom"}><Save size={14} />{props.busy === "custom" ? "保存中…" : "保存 Provider"}</button></span></div>
        </form> : selected ? <>
          <div className={styles.providerDetailHeader}><div><span className={styles.providerDetailIcon}>{selected.custom ? <PlugZap size={17} /> : <BrainCircuit size={17} />}</span><div><h3>{selected.name}</h3><p>{selected.custom ? selected.baseUrl : `${selected.modelCount} 个模型`}</p></div></div><span className={selected.configured ? styles.settingsStatus : styles.settingsStatusIdle}><span />{selected.configured ? "已配置" : "未配置"}</span></div>
          {selected.custom ? <div className={styles.customProviderActions}><button className={styles.secondaryButton} type="button" onClick={editSelectedCustomProvider}><Wrench size={14} />编辑配置</button><button className={styles.secondaryButton} type="button" onClick={() => void props.onTestConnection()} disabled={!selected.configured || !modelOptions.length || Boolean(props.busy)}><RefreshCw size={14} className={props.busy === `test:${selected.id}` ? styles.spin : ""} />{props.busy === `test:${selected.id}` ? "正在测试" : "测试连接"}</button>{selected.canRemoveCredential && <button className={styles.textButton} type="button" onClick={() => void props.onRemoveCredential()} disabled={Boolean(props.busy)}>移除凭据</button>}<button className={styles.deleteProviderButton} type="button" onClick={() => void props.onDeleteCustom(selected.id)} disabled={props.busy === `custom:${selected.id}`}><Trash2 size={14} />删除 Provider</button></div> : <form onSubmit={props.onSave}>
            <div className={styles.settingsField}><label htmlFor="model-provider-api-key">API Key</label><SecretInput id="model-provider-api-key" placeholder={selected.configured ? "输入新密钥以替换现有配置" : "输入 API Key"} value={props.apiKey} onChange={(event) => props.setApiKey(event.target.value)} autoComplete="new-password" /></div>
            <div className={styles.settingsFooter}><span /><span className={styles.settingsActions}>{selected.canRemoveCredential && <button className={styles.textButton} type="button" onClick={() => void props.onRemoveCredential()} disabled={Boolean(props.busy)}>移除凭据</button>}<button className={styles.secondaryButton} type="button" onClick={() => void props.onTestConnection()} disabled={!selected.configured || !modelOptions.length || Boolean(props.busy)}><RefreshCw size={14} className={props.busy === `test:${selected.id}` ? styles.spin : ""} />{props.busy === `test:${selected.id}` ? "正在测试" : "测试连接"}</button><button className={styles.saveButton} type="submit" disabled={!props.apiKey.trim() || props.busy === "api"}><Save size={14} />{props.busy === "api" ? "保存中…" : "保存凭据"}</button></span></div>
          </form>}
          <div className={styles.modelSectionHeader}><div><span>模型目录</span><small>{modelOptions.length ? `${modelOptions.length} 个模型` : "暂无模型"}</small></div></div>
          {props.modelsLoading ? <p className={styles.emptySettings}>正在读取模型目录…</p> : props.modelsError ? <p className={styles.modelLoadError} role="alert">{props.modelsError}</p> : modelOptions.length ? <div className={styles.providerModelList}>{modelOptions.map((model) => <article key={model.id}><span className={styles.providerModelIdentity}><strong>{model.name}</strong><small>{model.id}</small></span><div className={styles.providerModelDetails}><div className={styles.providerModelFacts}><ModelFact label="输入" value={model.input.includes("image") ? "文本 + 图片" : "文本"} /><ModelFact label="思考强度" value={formatThinkingLevels(model.thinkingLevels)} /><ModelFact label="上下文" value={formatTokenCount(model.contextWindow)} /><ModelFact label="最大输出" value={formatTokenCount(model.maxTokens)} /></div><div className={styles.providerModelPrices}><ModelFact label="输入价格" value={formatModelCost(model.cost.input)} /><ModelFact label="输出价格" value={formatModelCost(model.cost.output)} /><ModelFact label="缓存读取" value={formatModelCost(model.cost.cacheRead)} /><ModelFact label="缓存写入" value={formatModelCost(model.cost.cacheWrite)} /></div></div></article>)}</div> : <p className={styles.emptySettings}>当前 Provider 没有模型。配置模型后，它才会出现在对话选择器中。</p>}
        </> : <div className={styles.apiEmptyState}><BrainCircuit size={22} /><h3>选择 Provider</h3><p>从左侧选择一个模型服务，或添加自定义 Provider。</p></div>}
      </section>
    </div>}
  </div>;
}

function ApiSubtabButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return <button className={`${styles.apiSubtab} ${active ? styles.apiSubtabActive : ""}`} type="button" role="tab" aria-selected={active} onClick={onClick}>{icon}<span>{label}</span></button>;
}

function ApiComingSoon({ type }: { type: Exclude<ApiSubtab, "models" | "rag"> }) {
  const labels: Record<Exclude<ApiSubtab, "models" | "rag">, string> = { voice: "语音", image: "生图", video: "视频", search: "Web Search" };
  return <div className={styles.apiEmptyState}><Globe2 size={22} /><h3>{labels[type]} API</h3><p>该 API 类型尚未接入。二级导航已预留，接入后会在这里管理 Provider 和调用参数。</p></div>;
}

function formatTokenCount(value: number) {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`;
  return String(value);
}

function formatModelCost(value: number) {
  return `$${Number(value.toFixed(4))}/M`;
}

function formatThinkingLevels(levels: Model["thinkingLevels"]) {
  const labels = { off: "关闭", minimal: "极低", low: "低", medium: "中", high: "高", xhigh: "极高", max: "最高" } as const;
  const available = levels.filter((level) => level !== "off");
  return available.length ? available.map((level) => labels[level]).join(" / ") : "不支持";
}

function ModelFact({ label, value }: { label: string; value: string }) {
  return <span className={styles.providerModelFact}><small>{label}</small><strong>{value}</strong></span>;
}

function SkillsSettings({ skills, diagnostics, busy, draft, detail, detailLoading, onDraftChange, onSave, onToggle, onEdit, onDelete, onView, onCloseDetail }: {
  skills: Skill[];
  diagnostics: Array<{ message: string; code: string }>;
  busy: string | null;
  draft: UserSkillDraft | null;
  detail: SkillDetails | null;
  detailLoading: string | null;
  onDraftChange: (draft: UserSkillDraft | null) => void;
  onSave: (event: FormEvent) => Promise<void>;
  onToggle: (skill: Skill) => Promise<void>;
  onEdit: (skill: Skill) => Promise<void>;
  onDelete: (skill: Skill) => Promise<void>;
  onView: (skill: Skill) => Promise<void>;
  onCloseDetail: () => void;
}) {
  return <div>
    <div className={styles.settingsTitle}>
      <div><h3>Skills</h3><p>内置 Skill 和你的 Skill 共用一个目录；停用后下一轮对话生效。</p></div>
      <button className={styles.secondaryButton} type="button" onClick={() => onDraftChange({ name: '', description: '', content: '', version: '1.0.0', references: '' })}><Plus size={14} />新建 Skill</button>
    </div>
    {draft && <form className={styles.mcpEditor} onSubmit={onSave}>
      <div className={styles.inlineSettingsGrid}>
        <label className={styles.settingsField}><span>名称</span><input value={draft.name} onChange={(event) => onDraftChange({ ...draft, name: event.target.value })} pattern="[a-z0-9][a-z0-9-]{0,63}" required disabled={Boolean(draft.id)} /></label>
        <label className={styles.settingsField}><span>版本</span><input value={draft.version} onChange={(event) => onDraftChange({ ...draft, version: event.target.value })} maxLength={64} required /></label>
      </div>
      <label className={styles.settingsField}><span>用途描述</span><input value={draft.description} onChange={(event) => onDraftChange({ ...draft, description: event.target.value })} maxLength={500} required /></label>
      <label className={styles.settingsField}><span>SKILL.md 正文</span><textarea value={draft.content} onChange={(event) => onDraftChange({ ...draft, content: event.target.value })} rows={8} maxLength={65536} placeholder="写给 Agent 的指导文本；不会执行其中的命令。" required /></label>
      <label className={styles.settingsField}><span>References（每行：references/file.md::内容）</span><textarea value={draft.references} onChange={(event) => onDraftChange({ ...draft, references: event.target.value })} rows={3} maxLength={65536} placeholder="references/guide.md::补充说明" /></label>
      <div className={styles.settingsFooter}><span /><span className={styles.settingsActions}><button className={styles.textButton} type="button" onClick={() => onDraftChange(null)}>取消</button><button className={styles.saveButton} type="submit" disabled={busy === 'user-skill'}><Save size={14} />{busy === 'user-skill' ? '保存中…' : '保存 Skill'}</button></span></div>
    </form>}
    {detail && <article className={styles.skillDetail} aria-live="polite">
      <header className={styles.skillDetailHeader}>
        <div><div className={styles.skillDetailTitle}><h4>{detail.name}</h4><span className={`${styles.skillSourceBadge} ${detail.source.scope === 'builtin' ? styles.skillSourceBadgeBuiltin : styles.skillSourceBadgeUser}`}>{detail.source.scope === 'builtin' ? '内置' : '我的'}</span></div><p>{detail.description}</p></div>
        <button className={styles.iconActionButton} type="button" aria-label="关闭 Skill 详情" title="关闭" onClick={onCloseDetail}><X size={14} /></button>
      </header>
      <pre className={styles.skillDetailContent}>{detail.content}</pre>
      {Object.keys(detail.references).length > 0 && <details className={styles.skillReferences}><summary>References（{Object.keys(detail.references).length}）</summary>{Object.entries(detail.references).map(([path, content]) => <section key={path}><strong>{path}</strong><pre>{content}</pre></section>)}</details>}
    </article>}
    <div className={styles.settingsList}>{skills.length ? skills.map((skill) => {
      const isUserSkill = skill.source.scope === 'user' || skill.source.id.startsWith('user-skill-');
      const userId = skill.source.id.startsWith('user-skill-') ? skill.source.id.slice('user-skill-'.length) : undefined;
      return <div className={styles.settingsRow} key={skill.name}>
        <span className={styles.settingsRowIcon}><BrainCircuit size={15} /></span>
        <span className={styles.settingsRowCopy}><span className={styles.settingsRowName}><strong>{skill.name}</strong><span className={`${styles.skillSourceBadge} ${isUserSkill ? styles.skillSourceBadgeUser : styles.skillSourceBadgeBuiltin}`}>{isUserSkill ? '我的' : '内置'}</span></span><small>{skill.description}</small>{skill.version && <span className={styles.settingsMeta}>v{skill.version}</span>}</span>
        <span className={styles.settingsActions}>
          <button className={`${styles.settingsSwitch} ${skill.enabled ? styles.settingsSwitchOn : ''}`} type="button" role="switch" aria-checked={skill.enabled} aria-label={`${skill.name}${skill.enabled ? '已启用' : '已停用'}`} disabled={busy === `skill:${skill.name}`} onClick={() => void onToggle(skill)}><span /></button>
          <button className={styles.iconActionButton} type="button" aria-label={`查看 ${skill.name}`} title="查看内容" onClick={() => void onView(skill)} disabled={detailLoading === skill.name}><Eye size={14} className={detailLoading === skill.name ? styles.spin : ''} /></button>
          {isUserSkill && userId && <><button className={styles.iconActionButton} type="button" aria-label={`编辑 ${skill.name}`} title="编辑" onClick={() => void onEdit(skill)} disabled={busy === `edit-skill:${userId}`}><Wrench size={14} /></button><button className={styles.iconActionButton} type="button" aria-label={`删除 ${skill.name}`} title="删除" onClick={() => void onDelete(skill)} disabled={busy === `delete-skill:${userId}`}><Trash2 size={14} /></button></>}
        </span>
      </div>;
    }) : <p className={styles.emptySettings}>当前没有加载到 Skill。</p>}</div>
    {diagnostics.length > 0 && <div className={styles.settingsDiagnostics}><strong>加载诊断</strong>{diagnostics.map((diagnostic, index) => <p key={`${diagnostic.code}-${index}`}>{diagnostic.code} · {diagnostic.message}</p>)}</div>}
  </div>;
}

function McpSettings(props: { servers: McpServer[]; draft: McpDraft | null; busy: string | null; onStartNew: () => void; onEdit: (server: McpServer) => void; onDraftChange: (draft: McpDraft | null) => void; onSave: (event: FormEvent) => Promise<void>; onCancel: () => void; onToggle: (server: McpServer) => Promise<void>; onTest: (server: McpServer) => Promise<void>; onDelete: (server: McpServer) => Promise<void> }) {
  return <div><div className={styles.settingsTitle}><div><h3>MCP 连接</h3><p>只连接 HTTPS 服务；每次调用远程工具前都会请求批准。</p></div><button className={styles.secondaryButton} type="button" onClick={props.onStartNew}><Plus size={14} />添加</button></div>{props.draft && <form className={styles.mcpEditor} onSubmit={props.onSave}><label className={styles.settingsField}><span>名称</span><input value={props.draft.name} onChange={(event) => props.onDraftChange({ ...props.draft!, name: event.target.value })} maxLength={100} required /></label><label className={styles.settingsField}><span>Streamable HTTP 地址</span><input type="url" inputMode="url" value={props.draft.url} onChange={(event) => props.onDraftChange({ ...props.draft!, url: event.target.value })} placeholder="https://example.com/mcp" pattern="https://.*" required /></label><div className={styles.settingsField}><label htmlFor="mcp-bearer-token">Bearer Token{props.draft.id ? "（留空则保留原值）" : "（可选）"}</label><SecretInput id="mcp-bearer-token" secretLabel=" Bearer Token" value={props.draft.bearerToken} onChange={(event) => props.onDraftChange({ ...props.draft!, bearerToken: event.target.value })} autoComplete="new-password" maxLength={4096} /></div><div className={styles.settingsFooter}><span /><span className={styles.settingsActions}><button className={styles.textButton} type="button" onClick={props.onCancel}>取消</button><button className={styles.saveButton} type="submit" disabled={props.busy === "mcp"}><Save size={14} />保存</button></span></div></form>}<div className={styles.settingsList}>{props.servers.length ? props.servers.map((server) => <div className={styles.settingsRow} key={server.id}><span className={styles.settingsRowIcon}><Server size={15} /></span><span className={styles.settingsRowCopy}><strong>{server.name}</strong><small>HTTPS · {server.configuredBearer ? "已配置 Bearer Token" : "无认证"}</small></span><span className={styles.settingsActions}><button className={styles.iconActionButton} type="button" aria-label={`测试 ${server.name}`} title="测试连接" onClick={() => void props.onTest(server)} disabled={props.busy === `test:${server.id}`}><RefreshCw size={14} className={props.busy === `test:${server.id}` ? styles.spin : ""} /></button><button className={styles.rowStatusButton} type="button" onClick={() => void props.onToggle(server)} disabled={props.busy === `mcp:${server.id}`}>{server.enabled ? "已启用" : "已停用"}</button><button className={styles.iconActionButton} type="button" aria-label={`编辑 ${server.name}`} title="编辑" onClick={() => props.onEdit(server)}><Wrench size={14} /></button><button className={styles.iconActionButton} type="button" aria-label={`删除 ${server.name}`} title="删除" onClick={() => void props.onDelete(server)}><Trash2 size={14} /></button></span></div>) : <p className={styles.emptySettings}>还没有 MCP 连接。</p>}</div></div>;
}

function ToolsSettings({ tools, busy, onUpdate }: { tools: Tool[]; busy: string | null; onUpdate: (tool: Tool, patch: Partial<Pick<Tool, "enabled" | "approval">>) => Promise<void> }) {
  return <div><div className={styles.settingsTitle}><div><h3>Tools</h3><p>控制 Agent 可调用的工具和审批策略。平台要求的审批不能被关闭。</p></div></div><div className={styles.settingsList}>{tools.length ? tools.map((tool) => {
    const approvalLocked = tool.approvalPolicy !== "none";
    const limitText = `${Math.round(tool.limits.timeoutMs / 1000)} 秒 · ${tool.limits.maxResultCharacters.toLocaleString()} 字符上限`;
    const effectText = tool.effects.join("、");
    return <div className={styles.settingsRow} key={tool.name}><span className={styles.settingsRowIcon}><Wrench size={15} /></span><span className={styles.settingsRowCopy}><strong>{tool.label}</strong><small>{tool.description}</small><span className={styles.settingsMeta}>{tool.source} · {effectText} · {tool.executionMode === "parallel" ? "可并行" : "串行"} · {limitText}</span></span><span className={styles.settingsActions}><select className={styles.approvalSelect} aria-label={`${tool.label} 审批策略`} value={tool.approval} onChange={(event) => void onUpdate(tool, { approval: event.target.value as Tool["approval"] })} disabled={busy === `tool:${tool.name}`}><option value="default">默认</option><option value="always">总是询问</option><option value="never" disabled={approvalLocked}>不询问</option></select><button className={`${styles.settingsSwitch} ${tool.enabled ? styles.settingsSwitchOn : ''}`} type="button" role="switch" aria-checked={tool.enabled} aria-label={`${tool.label}${tool.enabled ? "已启用" : "已停用"}`} disabled={busy === `tool:${tool.name}`} onClick={() => void onUpdate(tool, { enabled: !tool.enabled })}><span /></button></span></div>;
  }) : <p className={styles.emptySettings}>当前没有可用工具。</p>}</div></div>;
}

const memorySlots = ["profile", "preferences", "scope", "recent"] as const;
const memorySlotLabels: Record<(typeof memorySlots)[number], string> = {
  profile: "关于你",
  preferences: "学习偏好",
  scope: "学习范围",
  recent: "最近学习",
};

function MemorySettings(props: {
  entries: MemoryEntry[];
  loading: boolean;
  memoryInjectionEnabled: boolean;
  memoryInjectionBusy: boolean;
  memoryUpdateBusy: boolean;
  onToggleMemoryInjection: () => void;
  onUpdateMemory: () => void;
  showArchived: boolean;
  onToggleArchived: () => void;
  editingId: string | null;
  draft: string;
  onBeginEdit: (entry: MemoryEntry) => void;
  onDraftChange: (value: string) => void;
  onCancelEdit: () => void;
  onSave: (id: string) => void;
  onArchive: (id: string, status: "active" | "archived") => void;
}) {
  const grouped = Object.fromEntries(memorySlots.map((slot) => [slot, props.entries.filter((entry) => entry.slot === slot)])) as Record<(typeof memorySlots)[number], MemoryEntry[]>;
  return <div>
    <div className={styles.settingsTitle}>
      <div><h3>学习记忆</h3><p>查看和修改 Chalk 为你整理的长期学习偏好与上下文。</p></div>
      <button className={`${styles.settingsSwitch} ${props.memoryInjectionEnabled ? styles.settingsSwitchOn : ""}`} type="button" role="switch" aria-checked={props.memoryInjectionEnabled} aria-label="自动注入学习记忆" onClick={props.onToggleMemoryInjection} disabled={props.memoryInjectionBusy}><span /></button>
      <button className={styles.secondaryButton} type="button" onClick={props.onUpdateMemory} disabled={props.memoryUpdateBusy || props.loading}><RefreshCw size={14} className={props.memoryUpdateBusy ? styles.spin : ""} />{props.memoryUpdateBusy ? "更新中…" : "立即 Update"}</button>
      <button className={styles.secondaryButton} type="button" onClick={props.onToggleArchived}>{props.showArchived ? "隐藏已归档" : "查看已归档"}</button>
    </div>
    <p className={styles.memoryHint}>{props.memoryInjectionEnabled ? "已开启：每次对话都会将 active L3 记忆注入教学上下文。" : "已关闭：记忆仍会保存，但不会自动提供给 Agent。"}</p>
    {props.loading ? <p className={styles.emptySettings}>正在加载学习记忆…</p> : <div className={styles.settingsList}>
      {memorySlots.map((slot) => <section key={slot} className={styles.memorySection}>
        <div className={styles.memorySectionHeader}><strong>{memorySlotLabels[slot]}</strong><span>{grouped[slot].length}</span></div>
        {grouped[slot].length ? grouped[slot].map((entry) => <div className={`${styles.settingsRow} ${entry.status === "archived" ? styles.memoryArchived : ""}`} key={entry.id}>
          {props.editingId === entry.id
            ? <div className={styles.memoryEditor}><textarea value={props.draft} maxLength={240} autoFocus onChange={(event) => props.onDraftChange(event.target.value)} /><div className={styles.settingsActions}><button className={styles.textButton} type="button" onClick={props.onCancelEdit}>取消</button><button className={styles.saveButton} type="button" disabled={!props.draft.trim()} onClick={() => props.onSave(entry.id)}><Check size={14} />保存</button></div></div>
            : <><span className={styles.settingsRowIcon}><BrainCircuit size={15} /></span><span className={styles.settingsRowCopy}><strong>{entry.text}</strong><small>更新于 {new Date(entry.updatedAt).toLocaleDateString("zh-CN")} · 来源 {entry.refs.length} 条{entry.status === "archived" ? " · 已归档" : ""}</small></span><span className={styles.settingsActions}><button className={styles.iconActionButton} type="button" aria-label="编辑记忆" title="编辑" onClick={() => props.onBeginEdit(entry)}><Pencil size={14} /></button>{entry.status === "archived" ? <button className={styles.iconActionButton} type="button" aria-label="恢复记忆" title="恢复" onClick={() => props.onArchive(entry.id, "active")}><RotateCcw size={14} /></button> : <button className={styles.iconActionButton} type="button" aria-label="归档记忆" title="归档" onClick={() => props.onArchive(entry.id, "archived")}><Archive size={14} /></button>}</span></>}
        </div>) : <p className={styles.emptySettings}>还没有内容</p>}
      </section>)}
    </div>}
    {!props.loading && <p className={styles.memoryFootnote}><RotateCcw size={14} />记忆只用于帮助教学，不代表对知识掌握度的判定。</p>}
  </div>;
}

function serverToDraft(server: McpServer): McpDraft {
  return {
    id: server.id,
    name: server.name,
    url: server.url,
    bearerToken: "",
    enabled: server.enabled,
  };
}
