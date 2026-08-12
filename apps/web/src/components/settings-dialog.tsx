"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  AudioLines,
  BrainCircuit,
  Globe2,
  ImageIcon,
  KeyRound,
  PlugZap,
  Plus,
  RefreshCw,
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
  type Skill,
  type Tool,
} from "../api";
import styles from "./app-sidebar.module.css";

type SettingsTab = "api" | "skills" | "mcp" | "tools";
type ApiSubtab = "models" | "voice" | "image" | "video" | "search";

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

type CustomProviderDraft = {
  id?: string;
  name: string;
  baseUrl: string;
  models: CustomModel[];
  apiKey: string;
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
  const [models, setModels] = useState<Model[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [diagnostics, setDiagnostics] = useState<Array<{ message: string; code: string }>>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
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
          </nav>
          <div className={styles.settingsContent}>
            {loading && <p>正在加载工作区配置…</p>}
            {error && <div className={styles.settingsAlert} role="alert"><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="关闭错误"><X size={14} /></button></div>}
            {notice && <div className={styles.settingsNotice} role="status"><span>{notice}</span><button type="button" onClick={() => setNotice(null)} aria-label="关闭提示"><X size={14} /></button></div>}
            {!loading && tab === "api" && <ApiSettings providers={providers} models={models} modelsLoading={modelsLoading} modelsError={modelsError} providerId={providerId} apiKey={apiKey} customDraft={customDraft} busy={busy} setProviderId={(value) => { setProviderId(value); setApiKey(""); setCustomDraft(null); }} setApiKey={setApiKey} setCustomDraft={setCustomDraft} onSave={saveApiSettings} onRemoveCredential={removeCredential} onTestConnection={testProviderConnection} onSaveCustom={saveCustomProvider} onDeleteCustom={deleteCustomProvider} />}
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
  models: Model[];
  modelsLoading: boolean;
  modelsError: string | null;
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
      <ApiSubtabButton active={subtab === "voice"} icon={<AudioLines size={15} />} label="语音" onClick={() => setSubtab("voice")} />
      <ApiSubtabButton active={subtab === "image"} icon={<ImageIcon size={15} />} label="生图" onClick={() => setSubtab("image")} />
      <ApiSubtabButton active={subtab === "video"} icon={<Video size={15} />} label="视频" onClick={() => setSubtab("video")} />
      <ApiSubtabButton active={subtab === "search"} icon={<Globe2 size={15} />} label="Web Search" onClick={() => setSubtab("search")} />
    </nav>
    {subtab !== "models" ? <ApiComingSoon type={subtab} /> : <div className={styles.providerWorkspace}>
      <aside className={styles.providerRail} aria-label="模型 Provider">
        <div className={styles.providerRailHeader}><span>Provider</span><button type="button" aria-label="添加自定义 Provider" title="添加自定义 Provider" onClick={() => props.setCustomDraft({ ...emptyCustomProviderDraft, models: [newCustomModel()] })}><Plus size={15} /></button></div>
        <div className={styles.providerList}>{props.providers.map((provider) => <button key={provider.id} type="button" className={provider.id === props.providerId && !props.customDraft ? styles.providerListItemActive : ""} onClick={() => props.setProviderId(provider.id)} aria-pressed={provider.id === props.providerId && !props.customDraft}><span className={styles.providerListIcon}>{provider.custom ? <PlugZap size={14} /> : <BrainCircuit size={14} />}</span><span className={styles.providerListCopy}><strong>{provider.name}</strong><small>{provider.configured ? "已配置" : "未配置"} · {provider.modelCount} 个模型</small></span><span className={`${styles.providerStatusDot} ${provider.configured ? styles.providerStatusDotReady : ""}`} aria-hidden="true" /></button>)}</div>
      </aside>
      <section className={styles.providerDetail} aria-live="polite">
        {props.customDraft ? <form className={styles.customProviderEditor} onSubmit={props.onSaveCustom}>
          <div className={styles.settingsTitle}><div><h3>{props.customDraft.id ? "编辑自定义 Provider" : "添加自定义 Provider"}</h3><p>作为普通 Provider 接入兼容 OpenAI Chat Completions 的模型服务。</p></div></div>
          <label className={styles.settingsField}><span>名称</span><input value={props.customDraft.name} onChange={(event) => props.setCustomDraft({ ...props.customDraft!, name: event.target.value })} required /></label>
          <label className={styles.settingsField}><span>Base URL</span><input type="url" value={props.customDraft.baseUrl} onChange={(event) => props.setCustomDraft({ ...props.customDraft!, baseUrl: event.target.value })} placeholder="https://example.com/v1" required /></label>
          <label className={styles.settingsField}><span>API Key{props.customDraft.id ? "（留空则保留原值）" : "（可选）"}</span><input type="password" value={props.customDraft.apiKey} onChange={(event) => props.setCustomDraft({ ...props.customDraft!, apiKey: event.target.value })} autoComplete="new-password" /></label>
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
            <label className={styles.settingsField}><span>API Key</span><input type="password" placeholder={selected.configured ? "输入新密钥以替换现有配置" : "输入 API Key"} value={props.apiKey} onChange={(event) => props.setApiKey(event.target.value)} autoComplete="new-password" /></label>
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

function ApiComingSoon({ type }: { type: Exclude<ApiSubtab, "models"> }) {
  const labels: Record<Exclude<ApiSubtab, "models">, string> = { voice: "语音", image: "生图", video: "视频", search: "Web Search" };
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

function SkillsSettings({ skills, diagnostics, busy, onToggle }: { skills: Skill[]; diagnostics: Array<{ message: string; code: string }>; busy: string | null; onToggle: (skill: Skill) => Promise<void> }) {
  return <div><div className={styles.settingsTitle}><div><h3>Skills</h3><p>启停已加载的能力；下一轮对话会使用最新配置。</p></div></div><div className={styles.settingsList}>{skills.length ? skills.map((skill) => <div className={styles.settingsRow} key={skill.name}><span className={styles.settingsRowIcon}><BrainCircuit size={15} /></span><span className={styles.settingsRowCopy}><strong>{skill.name}</strong><small>{skill.description} · {skill.source.label}</small></span><button className={styles.rowStatusButton} type="button" disabled={busy === `skill:${skill.name}`} onClick={() => void onToggle(skill)}>{busy === `skill:${skill.name}` ? "保存中…" : skill.enabled ? "已启用" : "已停用"}</button></div>) : <p className={styles.emptySettings}>当前没有加载到 Skill。</p>}</div>{diagnostics.length > 0 && <div className={styles.settingsDiagnostics}><strong>加载诊断</strong>{diagnostics.map((diagnostic, index) => <p key={`${diagnostic.code}-${index}`}>{diagnostic.code} · {diagnostic.message}</p>)}</div>}</div>;
}

function McpSettings(props: { servers: McpServer[]; draft: McpDraft | null; busy: string | null; onStartNew: () => void; onEdit: (server: McpServer) => void; onDraftChange: (draft: McpDraft | null) => void; onSave: (event: FormEvent) => Promise<void>; onCancel: () => void; onToggle: (server: McpServer) => Promise<void>; onTest: (server: McpServer) => Promise<void>; onDelete: (server: McpServer) => Promise<void> }) {
  return <div><div className={styles.settingsTitle}><div><h3>MCP 连接</h3><p>连接按需建立；写入型工具默认会等待你的批准。</p></div><button className={styles.secondaryButton} type="button" onClick={props.onStartNew}><Plus size={14} />添加</button></div>{props.draft && <form className={styles.mcpEditor} onSubmit={props.onSave}><div className={styles.inlineSettingsGrid}><label className={styles.settingsField}><span>名称</span><input value={props.draft.name} onChange={(event) => props.onDraftChange({ ...props.draft!, name: event.target.value })} required /></label><label className={styles.settingsField}><span>传输</span><select value={props.draft.transport} onChange={(event) => props.onDraftChange({ ...props.draft!, transport: event.target.value as McpServer["transport"] })}><option value="stdio">stdio</option><option value="sse">SSE</option><option value="http">Streamable HTTP</option></select></label></div>{props.draft.transport === "stdio" ? <><label className={styles.settingsField}><span>命令</span><input value={props.draft.command} onChange={(event) => props.onDraftChange({ ...props.draft!, command: event.target.value })} placeholder="例如 npx" required /></label><label className={styles.settingsField}><span>参数，每行一个</span><textarea value={props.draft.args} onChange={(event) => props.onDraftChange({ ...props.draft!, args: event.target.value })} rows={2} /></label></> : <label className={styles.settingsField}><span>URL</span><input type="url" value={props.draft.url} onChange={(event) => props.onDraftChange({ ...props.draft!, url: event.target.value })} required /></label>}<label className={styles.settingsField}><span>环境变量，每行 KEY=VALUE</span><textarea value={props.draft.env} onChange={(event) => props.onDraftChange({ ...props.draft!, env: event.target.value })} rows={2} /></label><div className={styles.settingsFooter}><span /><span className={styles.settingsActions}><button className={styles.textButton} type="button" onClick={props.onCancel}>取消</button><button className={styles.saveButton} type="submit" disabled={props.busy === "mcp"}><Save size={14} />保存</button></span></div></form>}<div className={styles.settingsList}>{props.servers.length ? props.servers.map((server) => <div className={styles.settingsRow} key={server.id}><span className={styles.settingsRowIcon}><Server size={15} /></span><span className={styles.settingsRowCopy}><strong>{server.name}</strong><small>{server.transport.toUpperCase()} · {server.configuredEnv ? "已保存环境变量" : "无环境变量"}</small></span><span className={styles.settingsActions}><button className={styles.iconActionButton} type="button" aria-label={`测试 ${server.name}`} title="测试连接" onClick={() => void props.onTest(server)} disabled={props.busy === `test:${server.id}`}><RefreshCw size={14} className={props.busy === `test:${server.id}` ? styles.spin : ""} /></button><button className={styles.rowStatusButton} type="button" onClick={() => void props.onToggle(server)} disabled={props.busy === `mcp:${server.id}`}>{server.enabled ? "已启用" : "已停用"}</button><button className={styles.iconActionButton} type="button" aria-label={`编辑 ${server.name}`} title="编辑" onClick={() => props.onEdit(server)}><Wrench size={14} /></button><button className={styles.iconActionButton} type="button" aria-label={`删除 ${server.name}`} title="删除" onClick={() => void props.onDelete(server)}><Trash2 size={14} /></button></span></div>) : <p className={styles.emptySettings}>还没有 MCP 连接。</p>}</div></div>;
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
