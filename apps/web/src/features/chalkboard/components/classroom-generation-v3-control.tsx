"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  CircleDashed,
  Eye,
  GripVertical,
  LoaderCircle,
  Plus,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";

import {
  classroomGenerationApi,
  classroomGenerationErrorMessage,
  mediaApi,
  settingsApi,
  type CapabilitySettings,
  type ClassroomGenerationRun,
  type ClassroomOutlineStreamEvent,
  type ClassroomSceneOutline,
  type MediaProvider,
} from "../../../api";
import styles from "../chalkboard.module.css";

type ClassroomGenerationControlProps = {
  compact?: boolean;
  embedded?: boolean;
  resumeRunId?: string;
  onCreated?(classroomId: string): void;
  onPublished(classroomId: string): void;
  onPreviewReady?(runId: string): void;
};

type ClassroomOutline = NonNullable<ClassroomGenerationRun["outline"]>;
type GenerationImageSelection = { providerId: string; modelId: string };
type GenerationVideoSelection = GenerationImageSelection & { durationSeconds: number; resolution: "720p" | "1080p" };

export function ClassroomGenerationControl({
  compact = false,
  embedded = false,
  resumeRunId,
  onCreated,
  onPublished,
  onPreviewReady,
}: ClassroomGenerationControlProps) {
  const requirementsRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const idempotencyKeys = useRef(new Map<string, string>());
  const lastOutlineEventId = useRef<{ runId: string; id?: string } | null>(null);
  const confirmingRunId = useRef<string | null>(null);
  const openedPreviewRuns = useRef(new Set<string>());
  const generationEngaged = useRef(false);
  const [open, setOpen] = useState(embedded);
  const [requirements, setRequirements] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<ClassroomGenerationRun | null>(null);
  const [streamedOutline, setStreamedOutline] = useState<ClassroomOutline | null>(null);
  const [editableOutline, setEditableOutline] = useState<ClassroomOutline | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [imageProviders, setImageProviders] = useState<MediaProvider[]>([]);
  const [videoProviders, setVideoProviders] = useState<MediaProvider[]>([]);
  const [imageSelection, setImageSelection] = useState<GenerationImageSelection | null>(null);
  const [videoSelection, setVideoSelection] = useState<GenerationVideoSelection | null>(null);
  const [imageEnabled, setImageEnabled] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(false);

  const active = run?.status === "queued" || run?.status === "running";
  const outlineStreaming = run?.stage === "outline" && active;
  const progressive = run?.stage === "progressive";
  const outlineStreamRunId = run?.stage === "outline" && active ? run.id : null;
  const triggerLabel = "生成课堂";
  const displayOutline = editableOutline ?? run?.outline ?? streamedOutline;

  const confirmOutline = useCallback(async (outline = editableOutline) => {
    if (!run || run.stage !== "outline" || !outline || !run.candidateVersion || confirmingRunId.current === run.id) return;
    confirmingRunId.current = run.id;
    setBusy(true);
    setRequestError(null);
    try {
      const key = idempotencyKeys.current.get(run.id) ?? crypto.randomUUID();
      idempotencyKeys.current.set(run.id, key);
      const result = await classroomGenerationApi.confirmOutline(run.id, {
        idempotencyKey: key,
        candidateVersion: run.candidateVersion,
        outline: normalizeOutline(outline),
      });
      setRun(result.generationRun);
      setReviewOpen(false);
    } catch (error) {
      confirmingRunId.current = null;
      setRequestError(classroomGenerationErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [editableOutline, run]);

  useEffect(() => {
    if (!resumeRunId) return;
    const controller = new AbortController();
    setOpen(true);
    void classroomGenerationApi.get(resumeRunId, controller.signal).then((result) => {
      setRun(result.generationRun);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setRequestError(classroomGenerationErrorMessage(error));
    });
    return () => controller.abort();
  }, [resumeRunId]);

  useEffect(() => {
    if (!run?.outline || run.stage !== "outline" || run.status !== "completed") return;
    setStreamedOutline(run.outline);
    setEditableOutline((existing) => existing ?? run.outline);
  }, [run?.id, run?.outline, run?.stage, run?.status]);

  useEffect(() => {
    if (!outlineStreamRunId) return;
    const controller = new AbortController();
    if (lastOutlineEventId.current?.runId !== outlineStreamRunId) {
      lastOutlineEventId.current = { runId: outlineStreamRunId };
      setStreamedOutline(null);
      setEditableOutline(null);
    }
    void classroomGenerationApi.streamOutline(
      outlineStreamRunId,
      (event, eventId) => {
        lastOutlineEventId.current = { runId: outlineStreamRunId, id: eventId };
        applyOutlineEvent(event, setStreamedOutline, setEditableOutline);
      },
      controller.signal,
      lastOutlineEventId.current.id,
    ).catch((error: unknown) => {
      if (!controller.signal.aborted) setRequestError(classroomGenerationErrorMessage(error));
    });
    return () => controller.abort();
  }, [outlineStreamRunId]);

  useEffect(() => {
    if (!run?.id || !active) return;
    const controller = new AbortController();
    let polling = false;
    const refresh = async () => {
      if (polling) return;
      polling = true;
      try {
        const result = await classroomGenerationApi.get(run.id, controller.signal);
        setRun(result.generationRun);
        setRequestError(null);
      } catch (error) {
        if (!controller.signal.aborted) setRequestError(classroomGenerationErrorMessage(error));
      } finally {
        polling = false;
      }
    };
    const timer = window.setInterval(() => void refresh(), 700);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [active, run?.id]);

  useEffect(() => {
    if (!run?.previewReady || !onPreviewReady || (!embedded && !generationEngaged.current) || openedPreviewRuns.current.has(run.id)) return;
    openedPreviewRuns.current.add(run.id);
    setOpen(false);
    onPreviewReady(run.id);
  }, [embedded, onPreviewReady, run?.id, run?.previewReady]);

  useEffect(() => {
    if (!open || embedded) return;
    if (!run) requirementsRef.current?.focus();
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyboard);
    return () => {
      window.removeEventListener("keydown", handleKeyboard);
      returnFocusRef.current?.focus();
    };
  }, [embedded, open, run]);

  useEffect(() => {
    if (!open) return;
    let mounted = true;
    void Promise.all([mediaApi.providers(), settingsApi.capabilities()]).then(([providers, capabilities]) => {
      if (!mounted) return;
      const images = providers.image.filter((provider) => provider.configured);
      const videos = providers.video.filter((provider) => provider.configured);
      setImageProviders(images);
      setVideoProviders(videos);
      setImageSelection(initialImageSelection(images, capabilities.image));
      setVideoSelection(initialVideoSelection(videos, capabilities.video));
    }).catch((error: unknown) => {
      if (mounted) setRequestError(classroomGenerationErrorMessage(error));
    });
    return () => { mounted = false; };
  }, [open]);

  async function generate() {
    const text = requirements.trim();
    if (!text) {
      setRequestError("请先说明想学习的知识点、对象或期望的课堂方式。");
      requirementsRef.current?.focus();
      return;
    }
    setBusy(true);
    setRequestError(null);
    try {
      const result = await classroomGenerationApi.create({
        requirements: text,
        ...(sourceText.trim() ? { context: { sourceText: sourceText.trim() } } : {}),
        ...(imageEnabled || videoEnabled ? { media: {
          ...(imageEnabled ? providerGenerationConfig(imageProviders, imageSelection, "image") : {}),
          ...(videoEnabled ? providerGenerationConfig(videoProviders, videoSelection, "video") : {}),
        } } : {}),
      });
      setRun(result.generationRun);
      setReviewOpen(false);
      if (result.generationRun.classroomId) {
        setOpen(false);
        onCreated?.(result.generationRun.classroomId);
      }
    } catch (error) {
      setRequestError(classroomGenerationErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    if (!run) return;
    confirmingRunId.current = null;
    await perform(() => classroomGenerationApi.retry(run.id));
  }

  async function abort() {
    if (run) await perform(() => classroomGenerationApi.abort(run.id));
  }

  async function publish() {
    if (!run) return;
    setBusy(true);
    setRequestError(null);
    try {
      const result = await classroomGenerationApi.publish(run.id);
      setRun(null);
      setOpen(false);
      onPublished(result.classroom.id);
    } catch (error) {
      setRequestError(classroomGenerationErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function perform(action: () => Promise<{ generationRun: ClassroomGenerationRun }>) {
    setBusy(true);
    setRequestError(null);
    try {
      const result = await action();
      setRun(result.generationRun);
    } catch (error) {
      setRequestError(classroomGenerationErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const canPublish = Boolean(run?.publishReady || (run?.stage === "media_tasks" && run.status === "completed"));

  const panel = <section
    ref={dialogRef}
    className={`${styles.generationPanel} ${embedded ? styles.generationWorkspacePanel : ""}`}
    data-generation-view={!run ? "requirements" : displayOutline ? "content" : "waiting"}
    role={embedded ? "region" : "dialog"}
    aria-modal={embedded ? undefined : true}
    aria-labelledby="generation-title"
  >
    <header className={styles.generationHeader}>
      <div>
        <span><Sparkles size={14} />{progressive ? "渐进课堂" : outlineStreaming ? "实时大纲" : "课堂草稿"}</span>
        <h2 id="generation-title">{displayOutline?.courseTitle || (outlineStreaming ? "正在搭建课堂大纲" : "生成一堂可学习的课")}</h2>
      </div>
      {!embedded ? <button type="button" aria-label="关闭课堂生成" onClick={() => setOpen(false)}><X size={17} /></button> : null}
    </header>

    {!run ? <GenerationRequirementsForm
      busy={busy}
      requirements={requirements}
      requirementsRef={requirementsRef}
      sourceText={sourceText}
      imageEnabled={imageEnabled}
      videoEnabled={videoEnabled}
      imageProviders={imageProviders}
      videoProviders={videoProviders}
      imageSelection={imageSelection}
      videoSelection={videoSelection}
      requestError={requestError}
      onRequirementsChange={setRequirements}
      onSourceTextChange={setSourceText}
      onImageEnabledChange={setImageEnabled}
      onVideoEnabledChange={setVideoEnabled}
      onImageSelectionChange={setImageSelection}
      onVideoSelectionChange={setVideoSelection}
      onClose={() => setOpen(false)}
      onSubmit={() => void generate()}
    /> : displayOutline ? <div className={styles.outlinePreview}>
      <div className={styles.outlineSummary}>
        <div><BookOpen size={17} /><span>{outlineStreaming ? "已收到" : "共"} {displayOutline.outlines.length} 个场景</span></div>
        <p>{displayOutline.languageDirective || "正在判断最适合这堂课的讲解语言…"}</p>
      </div>

      {run.stage === "outline" ? <OutlineReview
        outline={displayOutline}
        streaming={outlineStreaming}
        reviewing={reviewOpen}
        busy={busy}
        onOpenReview={() => setReviewOpen(true)}
        onCloseReview={() => setReviewOpen(false)}
        onChange={setEditableOutline}
      /> : <ProgressiveScenes run={run} outline={displayOutline} />}

      {requestError ? <p className={styles.generationRequestError} role="alert">{requestError}</p> : null}
      <div className={styles.generationActions}>
        {!embedded ? <button type="button" onClick={() => setOpen(false)}>关闭面板</button> : null}
        {active ? <button type="button" disabled={busy || run.cancelRequested} onClick={() => void abort()}>
          {busy ? <LoaderCircle className={styles.importSpinner} size={15} /> : <Square size={13} />}
          {run.cancelRequested ? "正在停止…" : "停止生成"}
        </button> : null}
        {run.stage === "outline" && run.status === "completed" && !reviewOpen ? <button type="button" onClick={() => setReviewOpen(true)}>
          <Eye size={15} />审阅大纲
        </button> : null}
        {run.stage === "outline" && run.status === "completed" && reviewOpen ? <button
          className={styles.generationPrimary}
          type="button"
          disabled={busy || displayOutline.outlines.length === 0 || displayOutline.outlines.some((scene) => !scene.title.trim())}
          onClick={() => void confirmOutline()}
        >
          {busy ? <LoaderCircle className={styles.importSpinner} size={15} /> : <Sparkles size={15} />}
          {busy ? "正在创建课堂角色与版本…" : "确认并生成整堂课"}
        </button> : null}
        {run.status === "failed" ? <button className={styles.generationPrimary} type="button" disabled={busy} onClick={() => void retry()}>
          {busy ? <LoaderCircle className={styles.importSpinner} size={15} /> : <RotateCcw size={15} />}
          {busy ? "正在重试…" : run.stage === "outline" ? "重试大纲" : "补生成未完成场景"}
        </button> : null}
        {canPublish ? <button className={styles.generationPrimary} type="button" disabled={busy} onClick={() => void publish()}>
          {busy ? <LoaderCircle className={styles.importSpinner} size={15} /> : <BookOpen size={15} />}
          {busy ? "正在校验并发布…" : "校验并发布课堂"}
        </button> : null}
      </div>
    </div> : <div className={styles.generationWaiting}>
      <LoaderCircle className={styles.importSpinner} size={22} />
      <div><strong>{run.status === "queued" ? "任务已进入队列" : "模型正在整理教学顺序"}</strong><p>完整对象会逐条出现；离开当前课堂不会中断数据库中的任务。</p></div>
      {requestError ? <p className={styles.generationRequestError} role="alert">{requestError}</p> : null}
      <div className={styles.generationActions}>{!embedded ? <button type="button" onClick={() => setOpen(false)}>关闭面板</button> : null}<button type="button" onClick={() => void abort()}>停止生成</button></div>
    </div>}
  </section>;

  return <>
    {!embedded ? <button
      className={compact ? styles.generateCompactButton : styles.generateActionButton}
      type="button"
      aria-label={compact ? triggerLabel : undefined}
      title={compact ? triggerLabel : undefined}
      onClick={(event) => {
        returnFocusRef.current = event.currentTarget;
        generationEngaged.current = true;
        setOpen(true);
      }}
    >
      <Sparkles size={15} />
      {!compact ? <span>{triggerLabel}</span> : null}
    </button> : null}

    {open ? embedded
      ? panel
      : <div className={styles.generationBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>{panel}</div>
      : null}
  </>;
}

function OutlineReview({
  outline,
  streaming,
  reviewing,
  busy,
  onOpenReview,
  onCloseReview,
  onChange,
}: {
  outline: ClassroomOutline;
  streaming: boolean;
  reviewing: boolean;
  busy: boolean;
  onOpenReview(): void;
  onCloseReview(): void;
  onChange(outline: ClassroomOutline): void;
}) {
  if (!reviewing) return <>
    <ol className={styles.outlineList} aria-live="polite">
      {outline.outlines.map((scene) => <li key={scene.id}>
        <span>{String(scene.order).padStart(2, "0")}</span>
        <div><div><strong>{scene.title}</strong><small>{outlineTypeLabel(scene.type)}</small></div><p>{scene.description}</p><ul>{scene.keyPoints.map((point) => <li key={point}>{point}</li>)}</ul></div>
      </li>)}
    </ol>
    <div className={styles.outlineReviewPrompt} data-streaming={streaming || undefined}>
      {streaming ? <LoaderCircle className={styles.importSpinner} size={16} /> : <Check size={16} />}
      <div>
        <strong>{streaming ? "大纲仍在生成" : "大纲等待你的确认"}</strong>
        <span>{streaming ? "可以先展开查看；生成结束前保持只读。" : "先检查教学顺序和内容；只有你明确确认后，才会开始生成 Scene。"}</span>
      </div>
      <button type="button" onClick={onOpenReview}><Eye size={14} />{streaming ? "展开只读审阅" : "审阅与编辑"}</button>
    </div>
  </>;

  const updateScene = (index: number, patch: Partial<ClassroomSceneOutline>) => {
    onChange(normalizeOutline({ ...outline, outlines: outline.outlines.map((scene, sceneIndex) => sceneIndex === index ? { ...scene, ...patch } : scene) }));
  };
  const moveScene = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= outline.outlines.length) return;
    const scenes = [...outline.outlines];
    [scenes[index], scenes[target]] = [scenes[target]!, scenes[index]!];
    onChange(normalizeOutline({ ...outline, outlines: scenes }));
  };
  const removeScene = (index: number) => onChange(normalizeOutline({ ...outline, outlines: outline.outlines.filter((_, sceneIndex) => sceneIndex !== index) }));
  const addScene = () => onChange(normalizeOutline({
    ...outline,
    outlines: [...outline.outlines, {
      id: crypto.randomUUID(),
      type: "slide",
      title: `新场景 ${outline.outlines.length + 1}`,
      description: "补充这个场景的教学目标与呈现方式。",
      keyPoints: ["待补充知识点"],
      order: outline.outlines.length + 1,
    }],
  }));

  return <section className={styles.outlineEditor} aria-label="课堂大纲编辑器">
    <div className={styles.outlineEditorIntro}>
      <div><strong>{streaming ? "只读审阅" : "确认生成版本"}</strong><span>{streaming ? "新场景仍会继续加入；完成后才可编辑。" : "确认后会生成不可变 Revision，并自动跑完内容、动作和媒体。"}</span></div>
      {!streaming ? <button type="button" onClick={onCloseReview}>收起审阅</button> : null}
    </div>
    <ol>
      {outline.outlines.map((scene, index) => <li key={scene.id}>
        <div className={styles.outlineEditorOrder}>
          <GripVertical size={14} aria-hidden="true" />
          <span>{String(index + 1).padStart(2, "0")}</span>
          <button type="button" aria-label={`上移“${scene.title}”`} disabled={streaming || busy || index === 0} onClick={() => moveScene(index, -1)}><ChevronUp size={14} /></button>
          <button type="button" aria-label={`下移“${scene.title}”`} disabled={streaming || busy || index === outline.outlines.length - 1} onClick={() => moveScene(index, 1)}><ChevronDown size={14} /></button>
        </div>
        <div className={styles.outlineEditorFields}>
          <label>标题<input value={scene.title} maxLength={240} disabled={streaming || busy} onChange={(event) => updateScene(index, { title: event.target.value })} /></label>
          <label>类型<select value={scene.type} disabled={streaming || busy} onChange={(event) => updateScene(index, changeSceneType(scene, event.target.value as ClassroomSceneOutline["type"]))}><option value="slide">讲解</option><option value="quiz">小测</option><option value="interactive">互动</option></select></label>
          <label className={styles.outlineEditorWide}>说明<textarea value={scene.description} maxLength={4_000} disabled={streaming || busy} rows={2} onChange={(event) => updateScene(index, { description: event.target.value })} /></label>
          <label className={styles.outlineEditorWide}>知识点（每行一个）<textarea value={scene.keyPoints.join("\n")} disabled={streaming || busy} rows={2} onChange={(event) => updateScene(index, { keyPoints: event.target.value.split("\n").map((point) => point.trim()).filter(Boolean) })} /></label>
        </div>
        <button className={styles.outlineEditorDelete} type="button" aria-label={`删除“${scene.title}”`} disabled={streaming || busy || outline.outlines.length === 1} onClick={() => removeScene(index)}><Trash2 size={14} /></button>
      </li>)}
    </ol>
    <button className={styles.outlineEditorAdd} type="button" disabled={streaming || busy} onClick={addScene}><Plus size={14} />添加场景</button>
  </section>;
}

function ProgressiveScenes({ run, outline }: { run: ClassroomGenerationRun; outline: ClassroomOutline }) {
  const progress = run.progress;
  const percentage = progress && progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
  return <>
    {progress ? <section className={styles.sceneGenerationProgress} aria-label="整堂课生成进度">
      <div><span><CircleDashed size={14} />内容与动作逐幕提交</span><strong>{progress.completed} / {progress.total}</strong></div>
      <div className={styles.sceneGenerationTrack} aria-hidden="true"><span style={{ width: `${percentage}%` }} /></div>
      <p>{run.status === "failed" ? `已保留 ${progress.completed} 个完整场景；重试会从失败场景的 content 开始。` : run.publishReady ? "所有场景和媒体已经完成，可以显式发布课堂。" : "Scene 1 完成后先开放草稿预览，其余场景与媒体继续在后台生成。"}</p>
      {progress.media ? <small>媒体 {progress.media.completed} / {progress.media.total}{progress.media.failed ? ` · ${progress.media.failed} 项待重试` : ""}</small> : null}
    </section> : null}
    {run.previewReady ? <div className={styles.draftPreviewReady} role="status"><Eye size={17} /><div><strong>Scene 1 已可预览</strong><span>第一幕的内容与教师动作已经原子保存；其余场景继续追加。</span></div></div> : null}
    <ol className={styles.outlineList} aria-live="polite">
      {outline.outlines.map((scene) => {
        const generated = run.scenes.find((candidate) => candidate.outlineId === scene.id);
        return <li key={scene.id}>
          <span>{String(scene.order).padStart(2, "0")}</span>
          <div><div><strong>{scene.title}</strong><small data-status={generated?.status}>{generated ? scenePhaseLabel(generated.phase, generated.status) : "等待中"}</small></div><p>{scene.description}</p><ul>{scene.keyPoints.map((point) => <li key={point}>{point}</li>)}</ul>{generated?.error ? <p className={styles.sceneGenerationError}>{sceneErrorCopy(generated.error.code)}</p> : null}</div>
        </li>;
      })}
    </ol>
    <footer className={styles.outlineFooter} data-complete={run.publishReady || undefined}>
      {run.publishReady ? <Check size={15} /> : run.status === "failed" ? <AlertTriangle size={15} /> : <LoaderCircle className={styles.importSpinner} size={15} />}
      <div><strong>{run.publishReady ? "课堂草稿已完整生成" : run.status === "failed" ? "当前场景需要重试" : "生成链路自动推进中"}</strong><span>{run.publishReady ? "发布会创建不可变 Artifact；重复发布请求返回同一个课堂。" : "关闭面板或刷新页面都不会丢失已提交的场景。"}</span></div>
    </footer>
  </>;
}

function GenerationRequirementsForm(props: {
  busy: boolean;
  requirements: string;
  requirementsRef: React.RefObject<HTMLTextAreaElement | null>;
  sourceText: string;
  imageEnabled: boolean;
  videoEnabled: boolean;
  imageProviders: MediaProvider[];
  videoProviders: MediaProvider[];
  imageSelection: GenerationImageSelection | null;
  videoSelection: GenerationVideoSelection | null;
  requestError: string | null;
  onRequirementsChange(value: string): void;
  onSourceTextChange(value: string): void;
  onImageEnabledChange(value: boolean): void;
  onVideoEnabledChange(value: boolean): void;
  onImageSelectionChange(value: GenerationImageSelection | null): void;
  onVideoSelectionChange(value: GenerationVideoSelection | null): void;
  onClose(): void;
  onSubmit(): void;
}) {
  const imageProvider = props.imageProviders.find((provider) => provider.id === props.imageSelection?.providerId);
  const videoProvider = props.videoProviders.find((provider) => provider.id === props.videoSelection?.providerId);
  return <form className={styles.generationForm} onSubmit={(event) => { event.preventDefault(); props.onSubmit(); }}>
    <label htmlFor="classroom-requirements">课堂要求</label>
    <textarea ref={props.requirementsRef} id="classroom-requirements" value={props.requirements} maxLength={20_000} rows={5} disabled={props.busy} placeholder="例如：为初一学生设计一堂勾股定理入门课，通过面积直观理解公式，并安排一次小测。" onChange={(event) => props.onRequirementsChange(event.target.value)} />
    <div className={styles.generationFieldMeta}><span>说明知识点、学习对象和希望采用的教学方式。</span><span>{props.requirements.length.toLocaleString("zh-CN")} / 20,000</span></div>
    <label htmlFor="classroom-context">补充材料 <span>可选</span></label>
    <textarea id="classroom-context" value={props.sourceText} maxLength={100_000} rows={3} disabled={props.busy} placeholder="可以粘贴课本摘录、已有知识或必须覆盖的内容。" onChange={(event) => props.onSourceTextChange(event.target.value)} />
    <fieldset className={styles.generationPlanningSettings}>
      <legend>AI 媒体规划 <span>可选</span></legend>
      <p>大纲会规划必要媒体；确认大纲后，图片和视频与剩余 Scene 链路并行生成。</p>
      <div className={styles.generationMediaCapability}>
        <label><input type="checkbox" checked={props.imageEnabled} disabled={props.busy || !imageProvider} onChange={(event) => props.onImageEnabledChange(event.target.checked)} />生成图片</label>
        {imageProvider && props.imageSelection ? <div className={styles.generationMediaSelectors}><label htmlFor="classroom-image-provider">Provider</label><select id="classroom-image-provider" aria-label="图片 Provider" value={imageProvider.id} disabled={props.busy} onChange={(event) => props.onImageSelectionChange(selectionForProvider(props.imageProviders, event.target.value))}>{props.imageProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select><label htmlFor="classroom-image-model">模型</label><select id="classroom-image-model" aria-label="图片模型" value={props.imageSelection.modelId} disabled={props.busy} onChange={(event) => props.onImageSelectionChange({ ...props.imageSelection!, modelId: event.target.value })}>{modelOptions(imageProvider)}</select></div> : <span>尚未配置图片 Provider</span>}
      </div>
      <div className={styles.generationMediaCapability}>
        <label><input type="checkbox" checked={props.videoEnabled} disabled={props.busy || !videoProvider} onChange={(event) => props.onVideoEnabledChange(event.target.checked)} />生成视频</label>
        {videoProvider && props.videoSelection ? <div className={styles.generationMediaSelectors}><label htmlFor="classroom-video-provider">Provider</label><select id="classroom-video-provider" aria-label="视频 Provider" value={videoProvider.id} disabled={props.busy} onChange={(event) => props.onVideoSelectionChange(videoSelectionForProvider(props.videoProviders, event.target.value))}>{props.videoProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select><label htmlFor="classroom-video-model">模型</label><select id="classroom-video-model" aria-label="视频模型" value={props.videoSelection.modelId} disabled={props.busy} onChange={(event) => props.onVideoSelectionChange({ ...props.videoSelection!, modelId: event.target.value })}>{modelOptions(videoProvider)}</select></div> : <span>尚未配置视频 Provider</span>}
      </div>
    </fieldset>
    {props.requestError ? <p className={styles.generationRequestError} role="alert">{props.requestError}</p> : null}
    <div className={styles.generationActions}><button type="button" onClick={props.onClose}>稍后再做</button><button className={styles.generationPrimary} type="submit" disabled={props.busy}>{props.busy ? <LoaderCircle className={styles.importSpinner} size={15} /> : <Sparkles size={15} />}{props.busy ? "正在创建…" : "生成大纲"}</button></div>
  </form>;
}

function applyOutlineEvent(
  event: ClassroomOutlineStreamEvent,
  setStreamedOutline: React.Dispatch<React.SetStateAction<ClassroomOutline | null>>,
  setEditableOutline: React.Dispatch<React.SetStateAction<ClassroomOutline | null>>,
) {
  if (event.type === "retry") {
    setStreamedOutline(null);
    setEditableOutline(null);
  } else if (event.type === "languageDirective") {
    setStreamedOutline((current) => ({ languageDirective: event.data, courseTitle: current?.courseTitle ?? "", outlines: current?.outlines ?? [] }));
  } else if (event.type === "courseTitle") {
    setStreamedOutline((current) => ({ languageDirective: current?.languageDirective ?? "", courseTitle: event.data, outlines: current?.outlines ?? [] }));
  } else if (event.type === "outline") {
    setStreamedOutline((current) => ({ languageDirective: current?.languageDirective ?? "", courseTitle: current?.courseTitle ?? "", outlines: [...(current?.outlines ?? []), event.data] }));
  } else if (event.type === "done") {
    const outline = { languageDirective: event.languageDirective, courseTitle: event.courseTitle, outlines: event.outlines };
    setStreamedOutline(outline);
    setEditableOutline(outline);
  }
}

function normalizeOutline(outline: ClassroomOutline): ClassroomOutline {
  return { ...outline, outlines: outline.outlines.map((scene, index) => ({ ...scene, order: index + 1 })) };
}

function changeSceneType(scene: ClassroomSceneOutline, type: ClassroomSceneOutline["type"]): Partial<ClassroomSceneOutline> {
  if (type === "quiz") return { type, quizConfig: scene.quizConfig ?? { questionCount: 1, difficulty: "medium", questionTypes: ["single"] }, interactiveConfig: undefined, widgetType: undefined, widgetOutline: undefined } as Partial<ClassroomSceneOutline>;
  if (type === "interactive") return { type, quizConfig: undefined, widgetType: "simulation", widgetOutline: { concept: scene.title } } as Partial<ClassroomSceneOutline>;
  return { type, quizConfig: undefined, interactiveConfig: undefined, widgetType: undefined, widgetOutline: undefined } as Partial<ClassroomSceneOutline>;
}

function scenePhaseLabel(phase: "content" | "actions" | "completed", status: string) {
  if (status === "failed") return "待重试";
  if (phase === "completed") return "完整 Scene";
  if (phase === "actions") return "生成动作";
  return status === "running" ? "生成内容" : "等待中";
}

function sceneErrorCopy(code: string) {
  if (code.includes("INTERACTIVE_CONTENT")) return "互动场景没有通过完整性校验；重试会从该 Scene 的 content 开始。";
  return "这个 Scene 没有完成；已提交的前序 Scene 不会重新生成。";
}

function outlineTypeLabel(type: ClassroomSceneOutline["type"]) {
  if (type === "quiz") return "小测";
  if (type === "interactive") return "互动";
  return "讲解";
}

function preferredModel(provider: MediaProvider, requested?: string | null) {
  return provider.models.some((model) => model.id === requested) ? requested!
    : provider.models.some((model) => model.id === provider.settings?.modelId) ? provider.settings!.modelId!
      : provider.models.some((model) => model.id === provider.defaultModel) ? provider.defaultModel
        : provider.models[0]?.id ?? "";
}

function selectionForProvider(providers: MediaProvider[], providerId: string) {
  const provider = providers.find((candidate) => candidate.id === providerId);
  return provider ? { providerId: provider.id, modelId: preferredModel(provider) } : null;
}

function initialImageSelection(providers: MediaProvider[], settings: CapabilitySettings["image"]) {
  const provider = providers.find((candidate) => candidate.id === settings?.providerId) ?? providers[0];
  return provider ? { providerId: provider.id, modelId: preferredModel(provider, settings?.providerId === provider.id ? settings.modelId : null) } : null;
}

function videoSelectionForProvider(providers: MediaProvider[], providerId: string) {
  const provider = providers.find((candidate) => candidate.id === providerId);
  return provider ? { providerId: provider.id, modelId: preferredModel(provider), durationSeconds: provider.durations?.[0] ?? 5, resolution: provider.resolutions?.includes("720p") ? "720p" as const : "1080p" as const } : null;
}

function initialVideoSelection(providers: MediaProvider[], settings: CapabilitySettings["video"]) {
  const provider = providers.find((candidate) => candidate.id === settings?.providerId) ?? providers[0];
  if (!provider) return null;
  const inherits = settings?.providerId === provider.id;
  return {
    providerId: provider.id,
    modelId: preferredModel(provider, inherits ? settings.modelId : null),
    durationSeconds: inherits && provider.durations?.includes(settings.durationSeconds) ? settings.durationSeconds : provider.durations?.[0] ?? 5,
    resolution: inherits && provider.resolutions?.includes(settings.resolution) ? settings.resolution : provider.resolutions?.includes("720p") ? "720p" : "1080p",
  };
}

function modelOptions(provider: MediaProvider) {
  return provider.models.length ? provider.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>) : <option value="">Provider 默认模型</option>;
}

function providerGenerationConfig(providers: MediaProvider[], selection: GenerationImageSelection | GenerationVideoSelection | null, capability: "image" | "video") {
  if (!selection) return {};
  const provider = providers.find((candidate) => candidate.id === selection.providerId);
  if (!provider) return {};
  const model = selection.modelId || provider.settings?.modelId || provider.defaultModel;
  if (capability === "image") return { image: { providerId: provider.id, ...(model ? { model } : {}), ...(provider.aspectRatios?.[0] ? { aspectRatio: provider.aspectRatios[0] as "16:9" } : {}) } };
  if (!("durationSeconds" in selection)) return {};
  return { video: { providerId: provider.id, ...(model ? { model } : {}), ...(provider.aspectRatios?.[0] ? { aspectRatio: provider.aspectRatios[0] as "16:9" } : {}), durationSeconds: selection.durationSeconds, resolution: selection.resolution } };
}
