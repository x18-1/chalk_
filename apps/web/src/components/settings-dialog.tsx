"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  BrainCircuit,
  Check,
  KeyRound,
  PlugZap,
  Plus,
  RefreshCw,
  Save,
  Server,
  Trash2,
  Wrench,
  X,
} from "lucide-react";

import { apiJson, type ModelRef } from "../lib/client/api";
import styles from "./app-sidebar.module.css";

type SettingsTab = "api" | "skills" | "mcp" | "tools";

type Provider = {
  id: string;
  name: string;
  configured: boolean;
  modelCount: number;
  authSource?: string;
};

type CustomProvider = {
  id: string;
  name: string;
  baseUrl: string;
  api: string;
  modelIds: unknown;
  enabled: boolean;
  configured: boolean;
};

type Skill = {
  name: string;
  description: string;
  filePath: string;
  enabled: boolean;
  source: { id: string; label: string; trusted: boolean };
  disableModelInvocation: boolean;
};

type McpServer = {
  id: string;
  name: string;
  transport: "stdio" | "sse" | "http";
  command: string | null;
  args: unknown;
  url: string | null;
  enabled: boolean;
  configuredEnv: boolean;
};

type Tool = {
  name: string;
  label: string;
  description: string;
  source: string;
  requiresApproval: boolean;
  enabled: boolean;
  approval: "default" | "always" | "never";
};

type McpDraft = {
  id?: string;
  name: string;
  transport: McpServer["transport"];
  command: string;
  url: string;
  args: string;
  env: string;
  enabled: boolean;
};

const emptyMcpDraft: McpDraft = {
  name: "",
  transport: "stdio",
  command: "",
  url: "",
  args: "",
  env: "",
  enabled: true,
};

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  const [tab, setTab] = useState<SettingsTab>("api");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [customProviders, setCustomProviders] = useState<CustomProvider[]>([]);
  const [models, setModels] = useState<Array<{ id: string; name: string; providerId: string }>>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [diagnostics, setDiagnostics] = useState<Array<{ message: string; code: string }>>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [providerId, setProviderId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [defaultModel, setDefaultModel] = useState<ModelRef | null>(null);
  const [mcpDraft, setMcpDraft] = useState<McpDraft | null>(null);
  const [customDraft, setCustomDraft] = useState({ name: "", baseUrl: "", modelIds: "", apiKey: "" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
      const [providerData, skillData, mcpData, toolData] = await Promise.all([
        apiJson<{ providers: Provider[]; customProviders: CustomProvider[]; defaultModel: ModelRef | null }>("/api/providers"),
        apiJson<{ skills: Skill[]; diagnostics: Array<{ message: string; code: string }> }>("/api/skills"),
        apiJson<{ servers: McpServer[] }>("/api/mcp"),
        apiJson<{ tools: Tool[] }>("/api/tools"),
      ]);
      setProviders(providerData.providers);
      setCustomProviders(providerData.customProviders ?? []);
      setProviderId(providerData.defaultModel?.providerId ?? providerData.providers.find((provider) => provider.configured)?.id ?? "");
      setDefaultModel(providerData.defaultModel);
      setSkills(skillData.skills);
      setDiagnostics(skillData.diagnostics ?? []);
      setMcpServers(mcpData.servers);
      setTools(toolData.tools);
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
      return;
    }
    void apiJson<{ models: Array<{ id: string; name: string; providerId: string }> }>(`/api/models?provider=${encodeURIComponent(providerId)}`)
      .then((data) => setModels(data.models))
      .catch(() => setModels([]));
  }, [providerId]);

  async function saveApiSettings(event: FormEvent) {
    event.preventDefault();
    if (!providerId) return;
    setBusy("api");
    setError(null);
    try {
      if (apiKey.trim()) {
        await apiJson(`/api/providers/${encodeURIComponent(providerId)}/credential`, {
          method: "PUT",
          body: JSON.stringify({ apiKey: apiKey.trim() }),
        });
      }
      if (defaultModel) {
        await apiJson("/api/settings/model", { method: "PUT", body: JSON.stringify(defaultModel) });
      }
      setApiKey("");
      setProviders((current) => current.map((provider) => provider.id === providerId ? { ...provider, configured: true } : provider));
      setNotice("模型配置已保存");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存模型配置失败");
    } finally {
      setBusy(null);
    }
  }

  async function removeCredential() {
    if (!providerId) return;
    setBusy(`credential:${providerId}`);
    try {
      await apiJson(`/api/providers/${encodeURIComponent(providerId)}/credential`, { method: "DELETE" });
      setProviders((current) => current.map((provider) => provider.id === providerId ? { ...provider, configured: false } : provider));
      setNotice("API Key 已移除");
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "移除 API Key 失败");
    } finally {
      setBusy(null);
    }
  }

  async function createCustomProvider(event: FormEvent) {
    event.preventDefault();
    setBusy("custom");
    try {
      const data = await apiJson<{ provider: CustomProvider }>("/api/providers/custom", {
        method: "POST",
        body: JSON.stringify({
          name: customDraft.name,
          baseUrl: customDraft.baseUrl,
          modelIds: customDraft.modelIds.split(/[\n,]/).map((value) => value.trim()).filter(Boolean),
          ...(customDraft.apiKey ? { apiKey: customDraft.apiKey } : {}),
        }),
      });
      setCustomProviders((current) => [data.provider, ...current]);
      setCustomDraft({ name: "", baseUrl: "", modelIds: "", apiKey: "" });
      setNotice("自定义 Provider 已添加");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "添加自定义 Provider 失败");
    } finally {
      setBusy(null);
    }
  }

  async function deleteCustomProvider(id: string) {
    setBusy(`custom:${id}`);
    try {
      await apiJson(`/api/providers/custom/${id}`, { method: "DELETE" });
      setCustomProviders((current) => current.filter((provider) => provider.id !== id));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除 Provider 失败");
    } finally {
      setBusy(null);
    }
  }

  async function toggleSkill(skill: Skill) {
    setBusy(`skill:${skill.name}`);
    try {
      await apiJson("/api/skills", { method: "PATCH", body: JSON.stringify({ skillName: skill.name, enabled: !skill.enabled }) });
      setSkills((current) => current.map((item) => item.name === skill.name ? { ...item, enabled: !item.enabled } : item));
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "更新 Skill 失败");
    } finally {
      setBusy(null);
    }
  }

  async function saveMcp(event: FormEvent) {
    event.preventDefault();
    if (!mcpDraft) return;
    setBusy("mcp");
    try {
      const env = Object.fromEntries(mcpDraft.env.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
        const index = line.indexOf("=");
        return index > 0 ? [line.slice(0, index).trim(), line.slice(index + 1)] : [line, ""];
      }));
      const payload = {
        name: mcpDraft.name,
        transport: mcpDraft.transport,
        enabled: mcpDraft.enabled,
        ...(mcpDraft.transport === "stdio" ? {
          command: mcpDraft.command,
          args: mcpDraft.args.split("\n").map((value) => value.trim()).filter(Boolean),
        } : { url: mcpDraft.url }),
        ...(Object.keys(env).length ? { env } : {}),
      };
      const path = mcpDraft.id ? `/api/mcp/${mcpDraft.id}` : "/api/mcp";
      const data = await apiJson<{ server: McpServer }>(path, { method: mcpDraft.id ? "PATCH" : "POST", body: JSON.stringify(payload) });
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
      const data = await apiJson<{ server: McpServer }>(`/api/mcp/${server.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !server.enabled }) });
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
      const data = await apiJson<{ status: { state: string; toolCount: number } }>(`/api/mcp/${server.id}/test`, { method: "POST" });
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
      await apiJson(`/api/mcp/${server.id}`, { method: "DELETE" });
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
      await apiJson("/api/tools", { method: "PATCH", body: JSON.stringify({ toolName: tool.name, ...next }) });
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
          </nav>
          <div className={styles.settingsContent}>
            {loading && <p>正在加载工作区配置…</p>}
            {error && <div className={styles.settingsAlert} role="alert"><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="关闭错误"><X size={14} /></button></div>}
            {notice && <div className={styles.settingsNotice} role="status"><span>{notice}</span><button type="button" onClick={() => setNotice(null)} aria-label="关闭提示"><X size={14} /></button></div>}
            {!loading && tab === "api" && <ApiSettings providers={providers} customProviders={customProviders} models={models} providerId={providerId} apiKey={apiKey} defaultModel={defaultModel} customDraft={customDraft} busy={busy} setProviderId={(value) => { setProviderId(value); setDefaultModel(null); }} setApiKey={setApiKey} setDefaultModel={setDefaultModel} setCustomDraft={setCustomDraft} onSave={saveApiSettings} onRemoveCredential={removeCredential} onCreateCustom={createCustomProvider} onDeleteCustom={deleteCustomProvider} />}
            {!loading && tab === "skills" && <SkillsSettings skills={skills} diagnostics={diagnostics} busy={busy} onToggle={toggleSkill} />}
            {!loading && tab === "mcp" && <McpSettings servers={mcpServers} draft={mcpDraft} busy={busy} onStartNew={() => setMcpDraft(emptyMcpDraft)} onEdit={(server) => setMcpDraft(serverToDraft(server))} onDraftChange={setMcpDraft} onSave={saveMcp} onCancel={() => setMcpDraft(null)} onToggle={toggleMcp} onTest={testMcp} onDelete={deleteMcp} />}
            {!loading && tab === "tools" && <ToolsSettings tools={tools} busy={busy} onUpdate={updateTool} />}
          </div>
        </div>
      </section>
    </div>
  );
}

function SettingsTabButton({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return <button className={active ? styles.settingsTabActive : ""} type="button" role="tab" aria-selected={active} onClick={onClick}>{icon}<span>{label}</span></button>;
}

function ApiSettings(props: {
  providers: Provider[];
  customProviders: CustomProvider[];
  models: Array<{ id: string; name: string; providerId: string }>;
  providerId: string;
  apiKey: string;
  defaultModel: ModelRef | null;
  customDraft: { name: string; baseUrl: string; modelIds: string; apiKey: string };
  busy: string | null;
  setProviderId: (value: string) => void;
  setApiKey: (value: string) => void;
  setDefaultModel: (value: ModelRef | null) => void;
  setCustomDraft: (value: { name: string; baseUrl: string; modelIds: string; apiKey: string }) => void;
  onSave: (event: FormEvent) => Promise<void>;
  onRemoveCredential: () => Promise<void>;
  onCreateCustom: (event: FormEvent) => Promise<void>;
  onDeleteCustom: (id: string) => Promise<void>;
}) {
  const selected = props.providers.find((provider) => provider.id === props.providerId);
  return <div>
    <div className={styles.settingsTitle}><div><h3>模型连接</h3><p>API Key 只保存加密后的配置状态，永远不会回显。</p></div>{selected?.configured && <span className={styles.settingsStatus}><span />已配置</span>}</div>
    <form onSubmit={props.onSave}>
      <label className={styles.settingsField}><span>Provider</span><select value={props.providerId} onChange={(event) => props.setProviderId(event.target.value)}><option value="">选择模型服务</option>{props.providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} · {provider.modelCount} 个模型</option>)}</select></label>
      <label className={styles.settingsField}><span>API Key</span><input type="password" placeholder="输入新密钥" value={props.apiKey} onChange={(event) => props.setApiKey(event.target.value)} autoComplete="new-password" /></label>
      <label className={styles.settingsField}><span>默认模型</span><select value={props.defaultModel?.modelId ?? ""} onChange={(event) => props.setDefaultModel(event.target.value ? { providerId: props.providerId, modelId: event.target.value } : null)}><option value="">自动选择</option>{props.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
      <div className={styles.settingsFooter}><span>{selected?.authSource ? `来源：${selected.authSource}` : "运行时会按当前凭据选择可用模型。"}</span><span className={styles.settingsActions}><button className={styles.textButton} type="button" onClick={() => void props.onRemoveCredential()} disabled={!selected?.configured || Boolean(props.busy)}>移除 Key</button><button className={styles.saveButton} type="submit" disabled={props.busy === "api"}><Save size={14} />{props.busy === "api" ? "保存中…" : "保存设置"}</button></span></div>
    </form>
    <div className={styles.settingsSubsection}><div className={styles.settingsTitle}><div><h3>自定义 Provider</h3><p>兼容 OpenAI Chat Completions 的中转站或本地服务。</p></div></div><form className={styles.inlineSettingsForm} onSubmit={props.onCreateCustom}><input aria-label="Provider 名称" placeholder="名称" value={props.customDraft.name} onChange={(event) => props.setCustomDraft({ ...props.customDraft, name: event.target.value })} required /><input aria-label="Base URL" placeholder="Base URL" type="url" value={props.customDraft.baseUrl} onChange={(event) => props.setCustomDraft({ ...props.customDraft, baseUrl: event.target.value })} required /><input aria-label="模型 ID" placeholder="模型 ID，用逗号分隔" value={props.customDraft.modelIds} onChange={(event) => props.setCustomDraft({ ...props.customDraft, modelIds: event.target.value })} required /><input aria-label="自定义 Provider API Key" placeholder="API Key（可选）" type="password" value={props.customDraft.apiKey} onChange={(event) => props.setCustomDraft({ ...props.customDraft, apiKey: event.target.value })} autoComplete="new-password" /><button className={styles.iconActionButton} type="submit" aria-label="添加自定义 Provider" title="添加自定义 Provider" disabled={props.busy === "custom"}><Plus size={16} /></button></form><div className={styles.settingsList}>{props.customProviders.map((provider) => <div className={styles.settingsRow} key={provider.id}><span className={styles.settingsRowIcon}><PlugZap size={15} /></span><span className={styles.settingsRowCopy}><strong>{provider.name}</strong><small>{provider.baseUrl} · {provider.configured ? "已配置" : "未配置 Key"}</small></span><button className={styles.iconActionButton} type="button" aria-label={`删除 ${provider.name}`} title="删除 Provider" onClick={() => void props.onDeleteCustom(provider.id)}><Trash2 size={15} /></button></div>)}</div></div>
  </div>;
}

function SkillsSettings({ skills, diagnostics, busy, onToggle }: { skills: Skill[]; diagnostics: Array<{ message: string; code: string }>; busy: string | null; onToggle: (skill: Skill) => Promise<void> }) {
  return <div><div className={styles.settingsTitle}><div><h3>Skills</h3><p>启停已加载的能力；下一轮对话会使用最新配置。</p></div></div><div className={styles.settingsList}>{skills.length ? skills.map((skill) => <div className={styles.settingsRow} key={skill.name}><span className={styles.settingsRowIcon}><BrainCircuit size={15} /></span><span className={styles.settingsRowCopy}><strong>{skill.name}</strong><small>{skill.description} · {skill.source.label}</small></span><button className={styles.rowStatusButton} type="button" disabled={busy === `skill:${skill.name}`} onClick={() => void onToggle(skill)}>{busy === `skill:${skill.name}` ? "保存中…" : skill.enabled ? "已启用" : "已停用"}</button></div>) : <p className={styles.emptySettings}>当前没有加载到 Skill。</p>}</div>{diagnostics.length > 0 && <div className={styles.settingsDiagnostics}><strong>加载诊断</strong>{diagnostics.map((diagnostic, index) => <p key={`${diagnostic.code}-${index}`}>{diagnostic.code} · {diagnostic.message}</p>)}</div>}</div>;
}

function McpSettings(props: { servers: McpServer[]; draft: McpDraft | null; busy: string | null; onStartNew: () => void; onEdit: (server: McpServer) => void; onDraftChange: (draft: McpDraft | null) => void; onSave: (event: FormEvent) => Promise<void>; onCancel: () => void; onToggle: (server: McpServer) => Promise<void>; onTest: (server: McpServer) => Promise<void>; onDelete: (server: McpServer) => Promise<void> }) {
  return <div><div className={styles.settingsTitle}><div><h3>MCP 连接</h3><p>连接按需建立；写入型工具默认会等待你的批准。</p></div><button className={styles.secondaryButton} type="button" onClick={props.onStartNew}><Plus size={14} />添加</button></div>{props.draft && <form className={styles.mcpEditor} onSubmit={props.onSave}><div className={styles.inlineSettingsGrid}><label className={styles.settingsField}><span>名称</span><input value={props.draft.name} onChange={(event) => props.onDraftChange({ ...props.draft!, name: event.target.value })} required /></label><label className={styles.settingsField}><span>传输</span><select value={props.draft.transport} onChange={(event) => props.onDraftChange({ ...props.draft!, transport: event.target.value as McpServer["transport"] })}><option value="stdio">stdio</option><option value="sse">SSE</option><option value="http">Streamable HTTP</option></select></label></div>{props.draft.transport === "stdio" ? <><label className={styles.settingsField}><span>命令</span><input value={props.draft.command} onChange={(event) => props.onDraftChange({ ...props.draft!, command: event.target.value })} placeholder="例如 npx" required /></label><label className={styles.settingsField}><span>参数，每行一个</span><textarea value={props.draft.args} onChange={(event) => props.onDraftChange({ ...props.draft!, args: event.target.value })} rows={2} /></label></> : <label className={styles.settingsField}><span>URL</span><input type="url" value={props.draft.url} onChange={(event) => props.onDraftChange({ ...props.draft!, url: event.target.value })} required /></label>}<label className={styles.settingsField}><span>环境变量，每行 KEY=VALUE</span><textarea value={props.draft.env} onChange={(event) => props.onDraftChange({ ...props.draft!, env: event.target.value })} rows={2} /></label><div className={styles.settingsFooter}><span>密钥不会在读取接口中返回。</span><span className={styles.settingsActions}><button className={styles.textButton} type="button" onClick={props.onCancel}>取消</button><button className={styles.saveButton} type="submit" disabled={props.busy === "mcp"}><Save size={14} />保存</button></span></div></form>}<div className={styles.settingsList}>{props.servers.length ? props.servers.map((server) => <div className={styles.settingsRow} key={server.id}><span className={styles.settingsRowIcon}><Server size={15} /></span><span className={styles.settingsRowCopy}><strong>{server.name}</strong><small>{server.transport.toUpperCase()} · {server.configuredEnv ? "已保存环境变量" : "无环境变量"}</small></span><span className={styles.settingsActions}><button className={styles.iconActionButton} type="button" aria-label={`测试 ${server.name}`} title="测试连接" onClick={() => void props.onTest(server)} disabled={props.busy === `test:${server.id}`}><RefreshCw size={14} className={props.busy === `test:${server.id}` ? styles.spin : ""} /></button><button className={styles.rowStatusButton} type="button" onClick={() => void props.onToggle(server)} disabled={props.busy === `mcp:${server.id}`}>{server.enabled ? "已启用" : "已停用"}</button><button className={styles.iconActionButton} type="button" aria-label={`编辑 ${server.name}`} title="编辑" onClick={() => props.onEdit(server)}><Wrench size={14} /></button><button className={styles.iconActionButton} type="button" aria-label={`删除 ${server.name}`} title="删除" onClick={() => void props.onDelete(server)}><Trash2 size={14} /></button></span></div>) : <p className={styles.emptySettings}>还没有 MCP 连接。</p>}</div></div>;
}

function ToolsSettings({ tools, busy, onUpdate }: { tools: Tool[]; busy: string | null; onUpdate: (tool: Tool, patch: Partial<Pick<Tool, "enabled" | "approval">>) => Promise<void> }) {
  return <div><div className={styles.settingsTitle}><div><h3>Tools</h3><p>控制 Agent 可调用的工具和审批策略。</p></div></div><div className={styles.settingsList}>{tools.length ? tools.map((tool) => <div className={styles.settingsRow} key={tool.name}><span className={styles.settingsRowIcon}><Wrench size={15} /></span><span className={styles.settingsRowCopy}><strong>{tool.label}</strong><small>{tool.description} · {tool.source}</small></span><span className={styles.settingsActions}><select className={styles.approvalSelect} aria-label={`${tool.label} 审批策略`} value={tool.approval} onChange={(event) => void onUpdate(tool, { approval: event.target.value as Tool["approval"] })} disabled={busy === `tool:${tool.name}`}><option value="default">默认审批</option><option value="always">始终询问</option><option value="never">不询问</option></select><button className={styles.rowStatusButton} type="button" disabled={busy === `tool:${tool.name}`} onClick={() => void onUpdate(tool, { enabled: !tool.enabled })}>{tool.enabled ? "已启用" : "已停用"}</button></span></div>) : <p className={styles.emptySettings}>当前没有可用工具。</p>}</div></div>;
}

function serverToDraft(server: McpServer): McpDraft {
  return {
    id: server.id,
    name: server.name,
    transport: server.transport,
    command: server.command ?? "",
    url: server.url ?? "",
    args: Array.isArray(server.args) ? server.args.join("\n") : "",
    env: "",
    enabled: server.enabled,
  };
}
