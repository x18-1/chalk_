"use client";

import { useEffect, useMemo, useState } from "react";
import { AudioLines, CheckCircle2, ImageIcon, KeyRound, RefreshCw, Save, Trash2, Video } from "lucide-react";

import { mediaApi, settingsApi, type CapabilitySettings, type MediaCapability, type MediaProvider, type MediaProviders } from "../api";
import styles from "./app-sidebar.module.css";
import { SecretInput } from "./secret-input";
import { BrowserSpeechSettings } from "./browser-speech-settings";

const labels: Record<MediaCapability, string> = { tts: "文本转语音", asr: "语音识别", image: "图片生成", video: "视频生成" };
const icons: Record<MediaCapability, typeof AudioLines> = { tts: AudioLines, asr: AudioLines, image: ImageIcon, video: Video };

/** Provider configuration follows the same rail/detail contract as the model settings page. */
export function MediaProviderSettings({ capability }: { capability: MediaCapability }) {
  const [data, setData] = useState<MediaProviders | null>(null);
  const [capabilitySettings, setCapabilitySettings] = useState<CapabilitySettings | null>(null);
  const [providerId, setProviderId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [workflowCount, setWorkflowCount] = useState<number | null>(null);
  const [workflows, setWorkflows] = useState<Array<{ id: string; name: string }>>([]);
  const [workflowId, setWorkflowId] = useState("");
  const [modelId, setModelId] = useState("");
  const [voxBackend, setVoxBackend] = useState("vllm-omni");
  const [videoDuration, setVideoDuration] = useState(5);
  const [videoResolution, setVideoResolution] = useState<"720p" | "1080p">("720p");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      mediaApi.providers(),
      capability === "image" || capability === "video" ? settingsApi.capabilities() : Promise.resolve(null),
    ]).then(([next, settings]) => {
      if (!active) return;
      setData(next);
      if (settings) setCapabilitySettings(settings);
    }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "读取媒体 Provider 失败"); });
    return () => { active = false; };
  }, [capability]);

  const providers = useMemo(() => data?.[capability] ?? [], [capability, data]);
  const browserProviderId = capability === "tts" ? "browser-tts" : capability === "asr" ? "browser-asr" : null;
  const browserSelected = Boolean(browserProviderId && (!providerId || providerId === browserProviderId || providerId.startsWith("browser-")));
  const defaultSelection = capability === "image" ? capabilitySettings?.image : capability === "video" ? capabilitySettings?.video : null;
  const selected = browserSelected ? undefined : providers.find((item) => item.id === providerId)
    ?? providers.find((item) => item.id === defaultSelection?.providerId)
    ?? providers[0];

  useEffect(() => {
    if (browserProviderId && browserSelected && providerId !== browserProviderId) setProviderId(browserProviderId);
    else if (selected && selected.id !== providerId) setProviderId(selected.id);
  }, [browserProviderId, browserSelected, providerId, selected]);

  useEffect(() => {
    setApiKey("");
    setBaseUrl(selected?.baseUrl ?? selected?.defaultBaseUrl ?? "");
    setWorkflowId(selected?.settings?.workflowId ?? "");
    const selectedDefault = selected?.id === defaultSelection?.providerId ? defaultSelection?.modelId ?? null : null;
    const selectedVideo = capability === "video" ? capabilitySettings?.video ?? null : null;
    setModelId(selectedDefault ?? selected?.settings?.modelId ?? selected?.defaultModel ?? selected?.models[0]?.id ?? "");
    if (selectedVideo && selected && selectedVideo.providerId === selected.id) {
      setVideoDuration(selectedVideo.durationSeconds);
      setVideoResolution(selectedVideo.resolution);
    } else if (capability === "video") {
      setVideoDuration(selected?.durations?.[0] ?? 5);
      setVideoResolution(selected?.resolutions?.includes("720p") ? "720p" : "1080p");
    }
    setVoxBackend(selected?.settings?.backend ?? "vllm-omni");
    setWorkflowCount(null);
    setWorkflows([]);
    setMessage(null);
    setError(null);
    if (selected?.id === "comfyui" && capability === "image") {
      void mediaApi.comfyWorkflows().then((result) => { setWorkflows(result.workflows); setWorkflowCount(result.workflows.length); }).catch(() => setWorkflowCount(0));
    }
  }, [capability, capabilitySettings, defaultSelection?.modelId, defaultSelection?.providerId, selected]);

  async function save() {
    if (!selected || (!apiKey.trim() && selected.requiresApiKey && !selected.configured)) return;
    setBusy("save"); setError(null); setMessage(null);
    try {
      const settings = { ...(modelId ? { modelId } : {}), ...(selected.id === "comfyui" && workflowId ? { workflowId } : {}), ...(selected.id === "voxcpm" ? { backend: voxBackend } : {}) };
      const result = await mediaApi.saveCredential(capability, selected.id, { ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}), ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}), settings });
      const nextCapabilities = capability === "image"
        ? await settingsApi.saveCapabilities({ image: { providerId: selected.id, modelId: modelId || null } })
        : capability === "video"
          ? await settingsApi.saveCapabilities({ video: { providerId: selected.id, modelId: modelId || null, durationSeconds: videoDuration, resolution: videoResolution } })
          : capabilitySettings;
      setApiKey("");
      if (nextCapabilities) setCapabilitySettings(nextCapabilities);
      setData((current) => current ? { ...current, [capability]: current[capability].map((item) => item.id === selected.id ? { ...item, configured: result.configured, credentialSource: result.credentialSource, canRemoveCredential: result.canRemoveCredential, baseUrl: result.baseUrl, settings } : item) } : current);
      setMessage(`${selected.name} 配置已保存`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存凭据失败"); } finally { setBusy(null); }
  }

  async function remove() {
    if (!selected || !window.confirm(`移除 ${selected.name} 的凭据？`)) return;
    setBusy("remove"); setError(null); setMessage(null);
    try {
      const result = await mediaApi.removeCredential(capability, selected.id);
      setData((current) => current ? { ...current, [capability]: current[capability].map((item) => item.id === selected.id ? { ...item, configured: result.configured, credentialSource: result.credentialSource, canRemoveCredential: result.canRemoveCredential } : item) } : current);
      if (capability === "image" && capabilitySettings?.image?.providerId === selected.id) setCapabilitySettings((current) => current ? { ...current, image: null } : current);
      if (capability === "video" && capabilitySettings?.video?.providerId === selected.id) setCapabilitySettings((current) => current ? { ...current, video: null } : current);
      setMessage("凭据已移除");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "移除凭据失败"); } finally { setBusy(null); }
  }

  async function test() {
    if (!selected || !selected.configured) return;
    setBusy("test"); setError(null); setMessage(null);
    try { await mediaApi.test(capability, selected.id, modelId || undefined); setMessage(`${selected.name} 连接正常`); } catch (cause) { setError(cause instanceof Error ? cause.message : "连接测试失败"); } finally { setBusy(null); }
  }

  const Icon = icons[capability];
  return <div className={styles.providerWorkspace}>
    <aside className={styles.providerRail} aria-label={`${labels[capability]} Provider`}>
      <div className={styles.providerRailHeader}><span>Provider</span></div>
      <div className={styles.providerList}>
        {browserProviderId && <BrowserProviderRow capability={capability as "tts" | "asr"} selected={browserSelected} onSelect={() => setProviderId(browserProviderId)} />}
        {providers.map((provider) => <MediaProviderRow key={provider.id} provider={provider} selected={provider.id === selected?.id} onSelect={() => setProviderId(provider.id)} />)}
        {!browserProviderId && !providers.length && <p className={styles.emptySettings}>正在读取 Provider…</p>}
      </div>
    </aside>
    <section className={styles.providerDetail} aria-live="polite">
      {browserSelected ? <BrowserSpeechSettings capability={capability as "tts" | "asr"} /> : selected ? <>
          <div className={styles.providerDetailHeader}>
          <div><span className={styles.providerDetailIcon}><Icon size={17} /></span><div><h3>{selected.name}</h3></div></div>
          <span className={selected.configured ? styles.settingsStatus : styles.settingsStatusIdle}><span />{selected.configured ? (defaultSelection?.providerId === selected.id ? "当前默认" : selected.credentialSource === "environment" ? "环境配置" : "已配置") : "未配置"}</span>
        </div>

        <section className={styles.mediaConfigSection} aria-labelledby="media-credentials-title">
          <div className={styles.modelSectionHeader}><div><span id="media-credentials-title">连接配置</span></div></div>
          <div className={styles.mediaConfigGrid}>
            <div className={styles.settingsField}><label htmlFor="media-provider-api-key">API Key</label><SecretInput id="media-provider-api-key" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={selected.requiresApiKey ? (selected.credentialSource === "environment" ? "输入用户密钥以覆盖环境配置" : selected.configured ? "输入新密钥以替换" : "输入 API Key") : "无需密钥"} autoComplete="new-password" disabled={!selected.requiresApiKey} /></div>
            <label className={styles.settingsField}><span>Base URL</span><input type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="Provider Base URL" /></label>
          </div>
          <div className={styles.settingsFooter}><span>{message && <span className={styles.settingsNoticeInline} role="status"><CheckCircle2 size={14} />{message}</span>}{error && <span className={styles.settingsErrorInline} role="alert">{error}</span>}</span><span className={styles.settingsActions}>{selected.canRemoveCredential && <button className={styles.textButton} type="button" onClick={() => void remove()} disabled={Boolean(busy)}><Trash2 size={13} />移除用户配置</button>}<button className={styles.secondaryButton} type="button" onClick={() => void test()} disabled={!selected.configured || Boolean(busy)}><RefreshCw size={14} className={busy === "test" ? styles.spin : ""} />{busy === "test" ? "测试中…" : "测试连接"}</button><button className={styles.saveButton} type="button" onClick={() => void save()} disabled={(!apiKey.trim() && selected.requiresApiKey && !selected.configured) || !baseUrl.trim() || Boolean(busy)}><Save size={14} />{busy === "save" ? "保存中…" : "保存配置"}</button></span></div>
        </section>

        <section className={styles.mediaModelSection} aria-labelledby="media-model-title">
          <div className={styles.modelSectionHeader}><div><span id="media-model-title">模型目录</span><small>{selected.models.length ? `${selected.models.length} 个模型` : "暂无模型目录"}</small></div></div>
          {selected.models.length ? <div className={styles.mediaModelList}>{selected.models.map((model) => <MediaModelCard key={model.id} model={model} capability={capability} provider={selected} selected={model.id === modelId} onSelect={() => setModelId(model.id)} />)}</div> : <p className={styles.emptySettings}>此 Provider 使用动态模型或本地工作流。</p>}
        </section>

        {capability === "video" && <section className={styles.mediaModelSection} aria-labelledby="video-defaults-title"><div className={styles.modelSectionHeader}><div><span id="video-defaults-title">默认生成规格</span><small>Chalkboard 启用视频时继承</small></div></div><div className={styles.mediaConfigGrid}><label className={styles.settingsField}><span>时长</span><select value={videoDuration} onChange={(event) => setVideoDuration(Number(event.target.value))}>{(selected.durations?.length ? selected.durations : [5]).map((duration) => <option key={duration} value={duration}>{duration} 秒</option>)}</select></label><label className={styles.settingsField}><span>清晰度</span><select value={videoResolution} onChange={(event) => setVideoResolution(event.target.value as "720p" | "1080p")}>{(selected.resolutions ?? ["720p"]).filter((resolution): resolution is "720p" | "1080p" => resolution === "720p" || resolution === "1080p").map((resolution) => <option key={resolution} value={resolution}>{resolution}</option>)}</select></label></div></section>}

        {selected.id === "comfyui" && capability === "image" && <section className={styles.mediaModelSection} aria-labelledby="workflow-title"><div className={styles.modelSectionHeader}><div><span id="workflow-title">Provider 专有设置</span></div></div><label className={styles.settingsField}><span>Workflow</span><select value={workflowId} onChange={(event) => setWorkflowId(event.target.value)}><option value="">使用默认 workflow</option>{workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name} · {workflow.id}</option>)}</select></label><p className={styles.settingsHint}>{workflowCount === null ? "读取中…" : workflowCount > 0 ? `已发现 ${workflowCount} 个 workflow。` : "未发现 workflow。"}</p></section>}
        {selected.id === "voxcpm" && capability === "tts" && <section className={styles.mediaModelSection} aria-labelledby="backend-title"><div className={styles.modelSectionHeader}><div><span id="backend-title">Provider 专有设置</span></div></div><label className={styles.settingsField}><span>推理后端</span><select value={voxBackend} onChange={(event) => setVoxBackend(event.target.value)}><option value="vllm-omni">vLLM-Omni</option><option value="python-api">Python API</option><option value="nano-vllm">Nano-VLLM</option></select></label></section>}

      </> : <div className={styles.apiEmptyState}><KeyRound size={22} /><h3>正在读取 Provider</h3><p>可用的第三方服务会显示在这里。</p></div>}
    </section>
  </div>;
}

function BrowserProviderRow({ capability, selected, onSelect }: { capability: "tts" | "asr"; selected: boolean; onSelect: () => void }) {
  const name = capability === "tts" ? "本机语音" : "本机语音识别";
  return <button type="button" className={selected ? styles.providerListItemActive : ""} onClick={onSelect} aria-pressed={selected}><span className={styles.providerListIcon}><AudioLines size={14} /></span><span className={styles.providerListCopy}><strong>{name}</strong><small>浏览器原生 · 无需密钥</small></span><span className={`${styles.providerStatusDot} ${styles.providerStatusDotReady}`} /></button>;
}

function MediaProviderRow({ provider, selected, onSelect }: { provider: MediaProvider; selected: boolean; onSelect: () => void }) {
  const status = provider.configured ? provider.credentialSource === "environment" ? "环境配置" : "已配置" : "未配置";
  return <button type="button" className={`${styles.providerListItem} ${selected ? styles.providerListItemActive : ""}`} onClick={onSelect} aria-pressed={selected}><span className={styles.providerListIcon}><KeyRound size={14} /></span><span className={styles.providerListCopy}><strong>{provider.name}</strong><small>{status} · {provider.models.length ? `${provider.models.length} 个模型` : "动态模型"}</small></span><span className={`${styles.providerStatusDot} ${provider.configured ? styles.providerStatusDotReady : ""}`} /></button>;
}

function MediaModelCard({ model, capability, provider, selected, onSelect }: { model: MediaProvider["models"][number]; capability: MediaCapability; provider: MediaProvider; selected: boolean; onSelect: () => void }) {
  const formats = provider.formats?.join(" / ") || "-";
  const dimensions = provider.aspectRatios?.join(" / ") || "-";
  const duration = provider.durations?.length ? provider.durations.map((item) => `${item}s`).join(" / ") : "-";
  const details = capability === "tts" ? [{ label: "输出", value: formats }, { label: "音色", value: `${provider.voices?.length ?? 0} 个` }] : capability === "asr" ? [{ label: "输入", value: formats }, { label: "语言", value: "自动识别" }] : capability === "image" ? [{ label: "比例", value: dimensions }, { label: "输出", value: "图片" }] : [{ label: "比例", value: dimensions }, { label: "时长", value: duration }];
  return <article className={`${styles.mediaModelCard} ${selected ? styles.mediaModelCardSelected : ""}`}>
    <button className={styles.mediaModelCardButton} type="button" onClick={onSelect} aria-pressed={selected}>
      <span className={styles.mediaModelIdentity}><strong>{model.name}</strong><small>{model.id}</small></span>
    </button>
    <div className={styles.mediaModelFacts}>{details.map((detail) => <MediaModelFact key={detail.label} label={detail.label} value={detail.value} />)}</div>
  </article>;
}

function MediaModelFact({ label, value }: { label: string; value: string }) {
  return <span className={styles.mediaModelFact}><small>{label}</small><strong>{value}</strong></span>;
}
