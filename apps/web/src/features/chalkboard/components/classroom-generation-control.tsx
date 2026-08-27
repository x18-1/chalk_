"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Check,
  CircleDashed,
  LoaderCircle,
  RotateCcw,
  Sparkles,
  Square,
  X,
} from "lucide-react";

import {
  classroomGenerationApi,
  classroomGenerationErrorMessage,
  mediaApi,
  settingsApi,
  type CapabilitySettings,
  type ClassroomGeneratedScene,
  type ClassroomGenerationRun,
  type MediaProvider,
} from "../../../api";
import styles from "../chalkboard.module.css";

type ClassroomGenerationControlProps = {
  compact?: boolean;
  onPublished(classroomId: string): void;
};

export function ClassroomGenerationControl({ compact = false, onPublished }: ClassroomGenerationControlProps) {
  const requirementsRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [requirements, setRequirements] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<ClassroomGenerationRun | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [imageProviders, setImageProviders] = useState<MediaProvider[]>([]);
  const [videoProviders, setVideoProviders] = useState<MediaProvider[]>([]);
  const [imageSelection, setImageSelection] = useState<GenerationImageSelection | null>(null);
  const [videoSelection, setVideoSelection] = useState<GenerationVideoSelection | null>(null);
  const [imageEnabled, setImageEnabled] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(false);

  const active = run?.status === "queued" || run?.status === "running";
  const runId = run?.id;
  const resumable = Boolean(run && run.status !== "aborted");
  const triggerLabel = active ? "课堂生成中" : resumable ? "继续课堂生成" : "生成课堂";

  useEffect(() => {
    const controller = new AbortController();
    void classroomGenerationApi.current(controller.signal).then((result) => {
      setRun((existing) => existing ?? result.generationRun);
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setRequestError(classroomGenerationErrorMessage(error));
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!open) return;
    requirementsRef.current?.focus();
    const handleDialogKeyboard = (event: KeyboardEvent) => {
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
    window.addEventListener("keydown", handleDialogKeyboard);
    return () => {
      window.removeEventListener("keydown", handleDialogKeyboard);
      returnFocusRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!runId || !active) return;
    const controller = new AbortController();
    let polling = false;
    const refresh = async () => {
      if (polling) return;
      polling = true;
      try {
        const result = await classroomGenerationApi.get(runId, controller.signal);
        setRun(result.generationRun);
        setRequestError(null);
      } catch (error) {
        if (!controller.signal.aborted) setRequestError(classroomGenerationErrorMessage(error));
      } finally {
        polling = false;
      }
    };
    const timer = window.setInterval(() => void refresh(), 800);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [active, runId]);

  async function generate() {
    const requirementText = requirements.trim();
    if (!requirementText) {
      setRequestError("请先说明想学习的知识点、对象或期望的课堂方式。");
      requirementsRef.current?.focus();
      return;
    }
    await perform(async () => classroomGenerationApi.create({
      requirements: requirementText,
      ...(sourceText.trim() ? { context: { sourceText: sourceText.trim() } } : {}),
      ...(imageEnabled || videoEnabled ? { media: {
        ...(imageEnabled ? providerGenerationConfig(imageProviders, imageSelection, "image") : {}),
        ...(videoEnabled ? providerGenerationConfig(videoProviders, videoSelection, "video") : {}),
      } } : {}),
    }));
  }

  async function retry() {
    if (!run) return;
    await perform(() => classroomGenerationApi.retry(run.id));
  }

  async function generateSceneContent() {
    if (!run) return;
    await perform(() => classroomGenerationApi.createSceneContent(run.id));
  }

  async function generateSceneActions() {
    if (!run) return;
    await perform(() => classroomGenerationApi.createSceneActions(run.id));
  }

  async function generateMediaTasks() {
    if (!run) return;
    await perform(() => classroomGenerationApi.createMediaTasks(run.id, {}));
  }

  async function abort() {
    if (!run) return;
    await perform(() => classroomGenerationApi.abort(run.id));
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

  const failed = run?.status === "failed";
  const completedOutline = run?.outline ?? null;
  const contentRun = run?.stage === "scene_content";
  const actionsRun = run?.stage === "scene_actions";
  const mediaRun = run?.stage === "media_tasks";
  const contentComplete = contentRun && run.status === "completed";
  const actionsComplete = actionsRun && run.status === "completed";
  const mediaComplete = mediaRun && run.status === "completed";

  useEffect(() => {
    if (!open) return;
    let activeRequest = true;
    void Promise.all([mediaApi.providers(), settingsApi.capabilities()]).then(([providers, nextCapabilities]) => {
      if (!activeRequest) return;
      const configuredImages = providers.image.filter((provider) => provider.configured);
      const configuredVideos = providers.video.filter((provider) => provider.configured);
      setImageProviders(configuredImages);
      setVideoProviders(configuredVideos);
      setImageSelection(initialImageSelection(configuredImages, nextCapabilities.image));
      setVideoSelection(initialVideoSelection(configuredVideos, nextCapabilities.video));
    }).catch((error: unknown) => {
      if (activeRequest) setRequestError(classroomGenerationErrorMessage(error));
    });
    return () => { activeRequest = false; };
  }, [open]);

  const selectedImageProvider = imageProviders.find((provider) => provider.id === imageSelection?.providerId);
  const selectedVideoProvider = videoProviders.find((provider) => provider.id === videoSelection?.providerId);

  return <>
    <button
      className={compact ? styles.generateCompactButton : styles.generateActionButton}
      data-active={active || undefined}
      type="button"
      aria-label={compact ? triggerLabel : undefined}
      title={compact ? triggerLabel : undefined}
      onClick={(event) => {
        returnFocusRef.current = event.currentTarget;
        setOpen(true);
      }}
    >
      {active ? <LoaderCircle className={styles.importSpinner} size={15} /> : <Sparkles size={15} />}
      {!compact ? <span>{triggerLabel}</span> : null}
    </button>
    {open ? <div
      className={styles.generationBackdrop}
      onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}
    >
      <section ref={dialogRef} className={styles.generationPanel} role="dialog" aria-modal="true" aria-labelledby="generation-title">
        <header className={styles.generationHeader}>
          <div>
            <span><Sparkles size={14} />{mediaRun ? "课堂媒体" : actionsRun ? "课堂动作" : contentRun ? "课堂内容" : "课堂草稿"}</span>
            <h2 id="generation-title">{completedOutline?.courseTitle ?? (active ? "正在生成课堂大纲" : "先生成课堂大纲")}</h2>
          </div>
          <button type="button" aria-label="关闭课堂生成" onClick={() => setOpen(false)}><X size={17} /></button>
        </header>

        {run && completedOutline ? <div className={styles.outlinePreview}>
          <div className={styles.outlineSummary}>
            <div><BookOpen size={17} /><span>共 {completedOutline.outlines.length} 个场景</span></div>
            <p>{completedOutline.languageDirective}</p>
          </div>

          {(contentRun || actionsRun || mediaRun) && run.progress ? <GenerationProgress run={run} /> : null}

          <ol className={styles.outlineList}>
            {completedOutline.outlines.map((scene) => {
              const generated = run.scenes.find((candidate) => candidate.outlineId === scene.id);
              return <li key={scene.id}>
                <span>{String(scene.order).padStart(2, "0")}</span>
                <div>
                  <div>
                    <strong>{scene.title}</strong>
                    <small data-status={generated?.status}>{generated ? sceneStatusLabel(generated, actionsRun || mediaRun) : outlineTypeLabel(scene.type)}</small>
                  </div>
                  <p>{scene.description}</p>
                  <ul>{scene.keyPoints.map((point) => <li key={point}>{point}</li>)}</ul>
                  {generated?.error ? <p className={styles.sceneGenerationError}>
                    {sceneGenerationErrorCopy(generated.error.code, actionsRun)}
                  </p> : null}
                </div>
              </li>;
            })}
          </ol>

          <footer className={styles.outlineFooter} data-complete={contentComplete || actionsComplete || (mediaRun && run.status === "completed") || undefined}>
            {contentComplete || actionsComplete || (mediaRun && run.status === "completed") ? <Check size={15} /> : <AlertTriangle size={15} />}
            <div>
              <strong>{contentFooterTitle(run)}</strong>
              <span>{contentFooterCopy(run)}</span>
            </div>
          </footer>

          {actionsComplete ? <div className={styles.generationMediaSettings}>
            <p>教师讲解由浏览器语音朗读。下一步只生成大纲中已规划的图片和视频；没有额外媒体时会直接进入发布校验。</p>
          </div> : null}

          {requestError ? <p className={styles.generationRequestError} role="alert">{requestError}</p> : null}
          <div className={styles.generationActions}>
            <button type="button" onClick={() => setOpen(false)}>关闭面板</button>
            {active ? <button type="button" disabled={busy || run.cancelRequested} onClick={() => void abort()}>
              {busy ? <LoaderCircle className={styles.importSpinner} size={15} /> : <Square size={13} />}
              {run.cancelRequested ? "正在停止…" : "停止生成"}
            </button> : null}
            {run.stage === "outline" && run.status === "completed" ? <button
              className={styles.generationPrimary}
              type="button"
              disabled={busy}
              onClick={() => void generateSceneContent()}
            >
              {busy ? <LoaderCircle className={styles.importSpinner} size={15} /> : <Sparkles size={15} />}
              {busy ? "正在启动…" : "逐场景生成内容"}
            </button> : null}
            {contentComplete ? <button
              className={styles.generationPrimary}
              type="button"
              disabled={busy}
              onClick={() => void generateSceneActions()}
            >
              {busy ? <LoaderCircle className={styles.importSpinner} size={15} /> : <Sparkles size={15} />}
              {busy ? "正在启动…" : "逐场景生成动作"}
            </button> : null}
            {actionsComplete ? <button
              className={styles.generationPrimary}
              type="button"
              disabled={busy}
              onClick={() => void generateMediaTasks()}
            >
              {busy ? <LoaderCircle className={styles.importSpinner} size={15} /> : <Sparkles size={15} />}
              {busy ? "正在启动…" : "确认课堂媒体"}
            </button> : null}
            {mediaComplete ? <button
              className={styles.generationPrimary}
              type="button"
              disabled={busy}
              aria-busy={busy}
              onClick={() => void publish()}
            >
              {busy ? <LoaderCircle className={styles.importSpinner} size={15} /> : <BookOpen size={15} />}
              {busy ? "正在校验并发布…" : "校验并发布课堂"}
            </button> : null}
            {(contentRun || actionsRun || mediaRun) && failed ? <button className={styles.generationPrimary} type="button" disabled={busy} onClick={() => void retry()}>
              {busy ? <LoaderCircle className={styles.importSpinner} size={15} /> : <RotateCcw size={15} />}
              {busy ? "正在重试…" : mediaRun ? "补生成未完成媒体" : actionsRun ? "补生成未完成动作" : "补生成未完成场景"}
            </button> : null}
          </div>
        </div> : run && active ? <div className={styles.generationWaiting}>
          <LoaderCircle className={styles.importSpinner} size={22} />
          <div>
            <strong>{run?.status === "queued" ? "任务已进入队列" : "模型正在整理教学顺序"}</strong>
            <p>生成内容和进度已经保存。关闭这个面板不会中断生成。</p>
          </div>
          {requestError ? <p className={styles.generationRequestError} role="alert">{requestError}</p> : null}
          <div className={styles.generationActions}>
            <button type="button" onClick={() => setOpen(false)}>关闭面板</button>
            <button type="button" disabled={busy || run?.cancelRequested} onClick={() => void abort()}>
              {busy ? <LoaderCircle className={styles.importSpinner} size={15} /> : <Square size={13} />}
              {run?.cancelRequested ? "正在停止…" : "停止生成"}
            </button>
          </div>
        </div> : <form className={styles.generationForm} onSubmit={(event) => { event.preventDefault(); void generate(); }}>
          <label htmlFor="classroom-requirements">课堂要求</label>
          <textarea
            ref={requirementsRef}
            id="classroom-requirements"
            value={requirements}
            maxLength={20_000}
            rows={5}
            disabled={busy}
            placeholder="例如：为初一学生设计一堂勾股定理入门课，通过面积直观理解公式，并安排一次小测。"
            onChange={(event) => setRequirements(event.target.value)}
          />
          <div className={styles.generationFieldMeta}><span>说明知识点、学习对象和希望采用的教学方式。</span><span>{requirements.length.toLocaleString("zh-CN")} / 20,000</span></div>
          <label htmlFor="classroom-context">补充材料 <span>可选</span></label>
          <textarea
            id="classroom-context"
            value={sourceText}
            maxLength={100_000}
            rows={3}
            disabled={busy}
            placeholder="可以粘贴课本摘录、已有知识或必须覆盖的内容。"
            onChange={(event) => setSourceText(event.target.value)}
          />
          <fieldset className={styles.generationPlanningSettings}>
            <legend>AI 媒体规划 <span>可选</span></legend>
            <p>开启后，大纲先规划必要媒体；图片和视频会在课堂内容与动作完成后生成。</p>
            <div className={styles.generationMediaCapability}>
              <label htmlFor="classroom-image-enabled"><input id="classroom-image-enabled" type="checkbox" checked={imageEnabled} disabled={busy || !selectedImageProvider} onChange={(event) => setImageEnabled(event.target.checked)} />生成图片</label>
              {selectedImageProvider && imageSelection ? <div className={styles.generationMediaSelectors}>
                <label htmlFor="classroom-image-provider">Provider</label>
                <select
                  id="classroom-image-provider"
                  aria-label="图片 Provider"
                  value={selectedImageProvider.id}
                  disabled={busy}
                  onChange={(event) => setImageSelection(selectionForProvider(imageProviders, event.target.value))}
                >
                  {imageProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
                </select>
                <label htmlFor="classroom-image-model">模型</label>
                <select
                  id="classroom-image-model"
                  aria-label="图片模型"
                  value={imageSelection.modelId}
                  disabled={busy || selectedImageProvider.models.length === 0}
                  onChange={(event) => setImageSelection({ ...imageSelection, modelId: event.target.value })}
                >
                  {modelOptions(selectedImageProvider)}
                </select>
              </div> : <span>尚未配置图片 Provider</span>}
            </div>
            <div className={styles.generationMediaCapability}>
              <label htmlFor="classroom-video-enabled"><input id="classroom-video-enabled" type="checkbox" checked={videoEnabled} disabled={busy || !selectedVideoProvider} onChange={(event) => setVideoEnabled(event.target.checked)} />生成视频</label>
              {selectedVideoProvider && videoSelection ? <div className={styles.generationMediaSelectors}>
                <label htmlFor="classroom-video-provider">Provider</label>
                <select
                  id="classroom-video-provider"
                  aria-label="视频 Provider"
                  value={selectedVideoProvider.id}
                  disabled={busy}
                  onChange={(event) => setVideoSelection(videoSelectionForProvider(videoProviders, event.target.value))}
                >
                  {videoProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
                </select>
                <label htmlFor="classroom-video-model">模型</label>
                <select
                  id="classroom-video-model"
                  aria-label="视频模型"
                  value={videoSelection.modelId}
                  disabled={busy || selectedVideoProvider.models.length === 0}
                  onChange={(event) => setVideoSelection({ ...videoSelection, modelId: event.target.value })}
                >
                  {modelOptions(selectedVideoProvider)}
                </select>
              </div> : <span>尚未配置视频 Provider</span>}
            </div>
            {!selectedImageProvider && !selectedVideoProvider ? <small>请先在设置中配置图片或视频 Provider；仍可生成不含 AI 媒体的课堂。</small> : <small>仅显示已经配置的 Provider；这里的选择只用于本次课堂。</small>}
          </fieldset>
          {failed ? <div className={styles.generationFailure} role="alert"><AlertTriangle size={16} /><div><strong>这次大纲没有生成成功</strong><span>任务已经保存，可以沿用同一份课堂草稿重试。</span></div></div> : null}
          {run?.status === "aborted" ? <div className={styles.generationFailure} role="status"><Square size={15} /><div><strong>生成已经停止</strong><span>你可以调整要求后重新发起课堂大纲。</span></div></div> : null}
          {requestError ? <p className={styles.generationRequestError} role="alert">{requestError}</p> : null}
          <div className={styles.generationActions}>
            <button type="button" onClick={() => setOpen(false)}>稍后再做</button>
            {failed ? <button className={styles.generationPrimary} type="button" disabled={busy} onClick={() => void retry()}>
              {busy ? <LoaderCircle className={styles.importSpinner} size={15} /> : <RotateCcw size={15} />}
              {busy ? "正在重试…" : "重试大纲"}
            </button> : <button className={styles.generationPrimary} type="submit" disabled={busy}>
              {busy ? <LoaderCircle className={styles.importSpinner} size={15} /> : <Sparkles size={15} />}
              {busy ? "正在创建…" : "生成大纲"}
            </button>}
          </div>
        </form>}
      </section>
    </div> : null}
  </>;
}

function GenerationProgress({ run }: { run: ClassroomGenerationRun }) {
  const progress = run.progress!;
  const percentage = progress.total === 0 && run.status === "completed" ? 100 : progress.total === 0 ? 0 : Math.round((progress.completed / progress.total) * 100);
  const actions = run.stage === "scene_actions";
  const media = run.stage === "media_tasks";
  return <section className={styles.sceneGenerationProgress} aria-label={media ? "课堂媒体生成进度" : actions ? "课堂动作生成进度" : "课堂内容生成进度"}>
    <div>
      <span><CircleDashed size={14} />{media ? "逐项保存媒体" : actions ? "逐场景保存动作" : "逐场景保存"}</span>
      <strong>{progress.completed} / {progress.total}</strong>
    </div>
    <div className={styles.sceneGenerationTrack} aria-hidden="true">
      <span style={{ width: `${percentage}%` }} />
    </div>
    <p>{run.status === "failed"
      ? media
        ? `已保留 ${progress.completed} 个完成媒体，${progress.failed} 个媒体等待补生成。`
        : `已保留 ${progress.completed} 个完成场景，${progress.failed} 个场景等待补生成。`
      : run.status === "completed"
        ? media
          ? progress.total === 0 ? "未规划额外图片或视频，媒体阶段无需生成内容。" : "所有课堂媒体都已准备好。"
          : actions ? "所有已支持场景的课堂动作都已写入草稿。" : "所有已支持场景都已写入课堂草稿。"
        : media
          ? "每项媒体完成后立即保存；异步视频会从当前进度继续。"
          : actions
          ? "每个场景的动作完成后立即保存；中断后会从未完成项继续。"
          : "每个场景完成后立即保存；中断后会从未完成项继续。"}</p>
  </section>;
}

function sceneStatusLabel(scene: ClassroomGeneratedScene, actions: boolean) {
  if (scene.status === "completed") return actions ? "动作已生成" : "已生成";
  if (scene.status === "running") return "生成中";
  if (scene.status === "failed") return "待重试";
  return "等待中";
}

function sceneGenerationErrorCopy(code: string, actions: boolean) {
  if (code === "CLASSROOM_SCENE_CONTENT_UNSUPPORTED") return "该场景类型尚未迁移，已完成场景不会丢失。";
  if (code === "CLASSROOM_SCENE_ACTIONS_UNSUPPORTED") return "该场景类型的课堂动作尚未迁移，已完成动作不会丢失。";
  if (code === "CLASSROOM_INTERACTIVE_CONTENT_TRUNCATED") return "互动页面在模型输出上限处被截断；重试只会补生成这个场景。";
  if (code === "CLASSROOM_INTERACTIVE_CONTENT_MISSING") return "模型没有返回互动页面；重试只会补生成这个场景。";
  if (code === "CLASSROOM_INTERACTIVE_CONTENT_TOO_LARGE") return "互动页面超过课堂允许的大小；重试只会补生成这个场景。";
  if (code === "CLASSROOM_INTERACTIVE_CONTENT_INCOMPLETE") return "互动页面没有完整结束，模型返回可能不完整；重试只会补生成这个场景。";
  if (code === "CLASSROOM_INTERACTIVE_CONTENT_MULTIPLE_DOCUMENTS") return "模型一次返回了多个互动页面；重试只会补生成这个场景。";
  if (code === "CLASSROOM_INTERACTIVE_CONTENT_CONFIG_MISSING") return "互动页面缺少组件配置；重试只会补生成这个场景。";
  if (code === "CLASSROOM_INTERACTIVE_CONTENT_CONFIG_DUPLICATE") return "互动页面包含重复的组件配置；重试只会补生成这个场景。";
  if (code === "CLASSROOM_INTERACTIVE_CONTENT_CONFIG_INVALID") return "互动页面的组件配置不是有效 JSON；重试只会补生成这个场景。";
  if (code === "CLASSROOM_INTERACTIVE_CONTENT_TYPE_MISMATCH") return "互动页面类型与课堂大纲不一致；重试只会补生成这个场景。";
  if (code === "CLASSROOM_INTERACTIVE_CONTENT_PROTOCOL_INCOMPLETE") return "互动页面缺少课堂动作协议；重试只会补生成这个场景。";
  if (code === "CLASSROOM_INTERACTIVE_CONTENT_SELECTORS_MISSING") return "互动页面缺少可供课堂动作引用的稳定元素；重试只会补生成这个场景。";
  return actions
    ? "这一个场景的课堂动作生成失败，可在同一任务中补生成。"
    : "这一个场景生成失败，可在同一任务中补生成。";
}

function contentFooterTitle(run: ClassroomGenerationRun) {
  if (run.stage === "outline") return "大纲已保存";
  if (run.stage === "scene_actions") {
    if (run.status === "completed") return "课堂动作已保存";
    if (run.status === "failed") return "部分动作需要补生成";
    if (run.status === "aborted") return "动作生成已停止";
    return "正在逐场景生成动作";
  }
  if (run.stage === "media_tasks") {
    if (run.status === "completed") return "课堂媒体已保存";
    if (run.status === "failed") return "部分媒体需要补生成";
    if (run.status === "aborted") return "媒体生成已停止";
    return "正在逐项生成媒体";
  }
  if (run.status === "completed") return "场景内容已保存";
  if (run.status === "failed") return "部分内容需要补生成";
  if (run.status === "aborted") return "内容生成已停止";
  return "正在逐场景生成";
}

function contentFooterCopy(run: ClassroomGenerationRun) {
  if (run.stage === "outline") return "下一步会按顺序生成每个场景；当前大纲已经保存。";
  if (run.stage === "scene_actions") {
    if (run.status === "completed") return "slide、quiz 和 interactive 的内容与教师动作已保存；媒体、最终校验和课堂发布尚未开始。";
    if (run.status === "failed") return "已完成的课堂动作保持不变，重试只处理失败或尚未开始的场景。";
    if (run.status === "aborted") return "已经完成的课堂动作仍然保留；这次生成不会继续。";
    return "关闭面板或暂时离开后，仍会从已保存的动作进度继续。";
  }
  if (run.stage === "media_tasks") {
    if (run.status === "completed") return run.progress?.total === 0
      ? "课堂没有规划额外图片或视频，可以继续校验并发布。"
      : "已完成的图片和视频已经保存并加入课堂。";
    if (run.status === "failed") return "已完成媒体保持不变，重试只处理失败或尚未开始的任务。";
    if (run.status === "aborted") return "已完成的媒体仍然保留；这次生成不会继续。";
    return "关闭面板或暂时离开后，仍会从已保存的媒体进度继续。";
  }
  if (run.status === "completed") return "当前已完成 slide、quiz 和 interactive 内容；下一步可以逐场景生成教师动作。";
  if (run.status === "failed") return "已完成的场景保持不变，重试只处理失败或尚未开始的场景。";
  if (run.status === "aborted") return "已经完成的场景内容仍然保留；这次生成不会继续。";
  return "关闭面板或暂时离开后，仍会从已保存的进度继续。";
}

type GenerationImageSelection = { providerId: string; modelId: string };
type GenerationVideoSelection = GenerationImageSelection & { durationSeconds: number; resolution: "720p" | "1080p" };

function preferredModel(provider: MediaProvider, requested?: string | null) {
  return provider.models.some((model) => model.id === requested)
    ? requested!
    : provider.models.some((model) => model.id === provider.settings?.modelId)
      ? provider.settings!.modelId!
      : provider.models.some((model) => model.id === provider.defaultModel)
        ? provider.defaultModel
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

function supportedVideoResolution(provider: MediaProvider) {
  return provider.resolutions?.includes("720p") ? "720p" as const : "1080p" as const;
}

function videoSelectionForProvider(providers: MediaProvider[], providerId: string) {
  const provider = providers.find((candidate) => candidate.id === providerId);
  return provider ? {
    providerId: provider.id,
    modelId: preferredModel(provider),
    durationSeconds: provider.durations?.[0] ?? 5,
    resolution: supportedVideoResolution(provider),
  } : null;
}

function initialVideoSelection(providers: MediaProvider[], settings: CapabilitySettings["video"]) {
  const provider = providers.find((candidate) => candidate.id === settings?.providerId) ?? providers[0];
  if (!provider) return null;
  const inheritsSettings = settings?.providerId === provider.id;
  return {
    providerId: provider.id,
    modelId: preferredModel(provider, inheritsSettings ? settings.modelId : null),
    durationSeconds: inheritsSettings && provider.durations?.includes(settings.durationSeconds)
      ? settings.durationSeconds
      : provider.durations?.[0] ?? 5,
    resolution: inheritsSettings && provider.resolutions?.includes(settings.resolution)
      ? settings.resolution
      : supportedVideoResolution(provider),
  };
}

function modelOptions(provider: MediaProvider) {
  if (provider.models.length === 0) return <option value="">Provider 默认模型</option>;
  return provider.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>);
}

function providerGenerationConfig(providers: MediaProvider[], selection: GenerationImageSelection | GenerationVideoSelection | null, capability: "image" | "video") {
  if (!selection) return {};
  const provider = providers.find((candidate) => candidate.id === selection.providerId);
  if (!provider) return {};
  const model = selection.modelId || provider.settings?.modelId || provider.defaultModel;
  if (capability === "image") return {
    image: {
      providerId: provider.id,
      ...(model ? { model } : {}),
      ...(provider.aspectRatios?.[0] ? { aspectRatio: provider.aspectRatios[0] as "16:9" } : {}),
    },
  };
  if (!("durationSeconds" in selection)) return {};
  return {
    video: {
      providerId: provider.id,
      ...(model ? { model } : {}),
      ...(provider.aspectRatios?.[0] ? { aspectRatio: provider.aspectRatios[0] as "16:9" } : {}),
      durationSeconds: selection.durationSeconds,
      resolution: selection.resolution,
    },
  };
}

function outlineTypeLabel(type: string) {
  if (type === "quiz") return "小测";
  if (type === "interactive") return "互动";
  if (type === "pbl") return "项目";
  return "讲解";
}
