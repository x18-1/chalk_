"use client";

/*
THESIS: An administrator traces Agent calls from named conversations rather than reading detached system counters.
OWN-WORLD: Chalk paper, ink dividers, compact call rows, and semantic status marks inside a dedicated management shell.
STORY: An administrator finds a conversation, opens its call history, and diagnoses timing, resource use, and failures without reading the transcript.
FIRST VIEWPORT: A generous administrator rail frames the Agent Trace module; a compact conversation index opens into a detailed call table.
FORM: A diagnostic ledger staged as a management console rather than a dashboard card grid.
*/

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowLeft,
  Ban,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Database,
  Users,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import {
  ApiRequestError,
  authApi,
  telemetryApi,
  type AgentRun,
  type AgentRunStatus,
  type ConversationObservationDetail,
  type ConversationObservationSummary,
} from "../../api";
import styles from "./observability.module.css";

type LoadState = "loading" | "ready" | "forbidden" | "error";
type DetailState = "idle" | "loading" | "ready" | "error";

const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const compactNumberFormatter = new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 });

const statusCopy: Record<AgentRunStatus, string> = {
  completed: "完成",
  aborted: "中止",
  failed: "失败",
};

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "--" : dateTimeFormatter.format(date);
}

function compactId(value: string) {
  return value.length > 12 ? `${value.slice(0, 8)}...` : value;
}

function formatDuration(durationMs: number) {
  if (durationMs < 1_000) return `${durationMs} ms`;
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(1)} s`;
  return `${Math.floor(durationMs / 60_000)} min ${Math.round((durationMs % 60_000) / 1_000)} s`;
}

function formatTokens(value: number | null) {
  return compactNumberFormatter.format(value ?? 0);
}

function formatCost(value: number | null) {
  if (!value) return "--";
  return value < 0.01 ? value.toFixed(6) : value.toFixed(4);
}

function formatModel(model: {
  providerId?: string | null;
  modelProviderId?: string | null;
  modelId: string | null;
}) {
  return [model.providerId ?? model.modelProviderId, model.modelId]
    .filter(Boolean)
    .join(" / ") || "未标注模型";
}

function statusClass(status: AgentRunStatus) {
  return status === "completed" ? styles.statusCompleted : status === "failed" ? styles.statusFailed : styles.statusAborted;
}

function StatusMark({ status }: { status: AgentRunStatus }) {
  const Icon = status === "completed" ? CheckCircle2 : status === "failed" ? XCircle : Ban;
  return <span className={`${styles.statusMark} ${statusClass(status)}`}><Icon size={14} />{statusCopy[status]}</span>;
}

function EmptyDetail() {
  return <div className={styles.detailEmpty}>
    <Database size={20} />
    <strong>选择一个会话</strong>
    <p>调用明细会按最近调用时间排列。</p>
  </div>;
}

function RunTable({ runs }: { runs: AgentRun[] }) {
  if (runs.length === 0) {
    return <div className={styles.noRuns}><Activity size={17} /><span>这段会话还没有已持久化的调用摘要。</span></div>;
  }

  return <div className={styles.runTableScroller}>
    <div className={styles.runTable} role="table" aria-label="会话调用明细">
      <div className={styles.runTableHeader} role="row">
        <span role="columnheader">调用 ID</span>
        <span role="columnheader">状态</span>
        <span role="columnheader">模型</span>
        <span role="columnheader">输入</span>
        <span role="columnheader">输出</span>
        <span role="columnheader">耗时</span>
        <span role="columnheader">成本</span>
        <span role="columnheader">错误分类</span>
      </div>
      {runs.map((run) => <div className={styles.runRow} role="row" key={run.id}>
        <span className={styles.runId} role="cell" title={run.id}>{compactId(run.id)}</span>
        <span role="cell"><StatusMark status={run.status} /></span>
        <span className={styles.runModel} role="cell" title={formatModel(run)}>{formatModel(run)}</span>
        <span role="cell">{formatTokens(run.inputTokens)}</span>
        <span role="cell">{formatTokens(run.outputTokens)}</span>
        <span role="cell">{formatDuration(run.durationMs)}</span>
        <span role="cell">{formatCost(run.totalCost)}</span>
        <span className={styles.runError} role="cell" title={run.errorCategory ?? undefined}>{run.errorCategory ?? "--"}</span>
      </div>)}
    </div>
  </div>;
}

function ConversationDetail({ detail, state }: { detail: ConversationObservationDetail | null; state: DetailState }) {
  if (state === "idle") return <EmptyDetail />;
  if (state === "loading") {
    return <div className={styles.detailLoading} aria-live="polite"><LoaderCircle className={styles.spin} size={18} /><span>正在读取调用明细…</span></div>;
  }
  if (state === "error" || !detail?.summary) {
    return <div className={styles.detailEmpty}><CircleAlert size={20} /><strong>无法读取此会话</strong><p>请刷新列表后重试。</p></div>;
  }

  const { summary } = detail;
  return <>
    <header className={styles.detailHeader}>
      <div>
        <h2 title={summary.title ?? "未命名会话"}>{summary.title ?? "未命名会话"}</h2>
        <p>最近调用于 {formatDate(summary.lastStartedAt)}</p>
      </div>
      <dl className={styles.traceIds}>
        <div><dt>会话 ID</dt><dd title={summary.conversationId}>{compactId(summary.conversationId)}</dd></div>
        <div><dt>Session ID</dt><dd title={summary.sessionId}>{compactId(summary.sessionId)}</dd></div>
      </dl>
    </header>

    <div className={styles.detailFacts}>
      <div><span>输入 token</span><strong>{formatTokens(summary.inputTokens)}</strong></div>
      <div><span>输出 token</span><strong>{formatTokens(summary.outputTokens)}</strong></div>
      <div><span>报告成本</span><strong>{formatCost(summary.totalCost)}</strong></div>
      <div><span>异常调用</span><strong>{summary.statusCounts.failed ? `${summary.statusCounts.failed} 次` : "无"}</strong></div>
    </div>

    <section className={styles.runsSection} aria-labelledby="run-history-title">
      <div className={styles.runsHeader}>
        <h3 id="run-history-title">调用记录</h3>
        <span>{summary.latestErrorCategory ? `最近异常：${summary.latestErrorCategory}` : "仅包含结构化调用摘要"}</span>
      </div>
      <RunTable runs={detail.runs} />
    </section>
  </>;
}

export default function ObservabilityPage() {
  const [state, setState] = useState<LoadState>("loading");
  const [summaries, setSummaries] = useState<ConversationObservationSummary[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationObservationDetail | null>(null);
  const [detailState, setDetailState] = useState<DetailState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const selectedSummary = useMemo(
    () => summaries.find((summary) => summary.conversationId === selectedConversationId) ?? null,
    [selectedConversationId, summaries],
  );

  async function loadOverview(showRefreshing = false) {
    if (showRefreshing) setRefreshing(true);
    else setState("loading");
    setError(null);
    try {
      const [{ user }, data] = await Promise.all([authApi.session(), telemetryApi.listConversations()]);
      if (!user || user.role !== "admin") {
        setState("forbidden");
        return;
      }
      setSummaries(data.conversations);
      setSelectedConversationId((current) => data.conversations.some((summary) => summary.conversationId === current)
        ? current
        : data.conversations[0]?.conversationId ?? null);
      setState("ready");
    } catch (loadError) {
      if (loadError instanceof ApiRequestError && loadError.status === 403) {
        setState("forbidden");
        return;
      }
      setError(loadError instanceof Error ? loadError.message : "无法读取可观测性数据");
      setState("error");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => { void loadOverview(); }, []);

  useEffect(() => {
    if (!selectedConversationId || state !== "ready") {
      setDetail(null);
      setDetailState("idle");
      return;
    }
    const controller = new AbortController();
    setDetailState("loading");
    void telemetryApi.getConversation(selectedConversationId, controller.signal)
      .then((data) => {
        setDetail(data);
        setDetailState("ready");
      })
      .catch((detailError: unknown) => {
        if (controller.signal.aborted) return;
        if (detailError instanceof ApiRequestError && detailError.status === 403) setState("forbidden");
        setDetailState("error");
      });
    return () => controller.abort();
  }, [selectedConversationId, state]);

  if (state === "forbidden") {
    return <main className={styles.accessPage}>
      <section className={styles.accessMessage} aria-labelledby="access-title">
        <ShieldCheck size={24} />
        <h1 id="access-title">此页面仅限管理员访问</h1>
        <p>请使用管理员账号登录后再查看调用记录。</p>
        <Link href="/chat"><ArrowLeft size={15} />返回学习空间</Link>
      </section>
    </main>;
  }

  return <main className={styles.page}>
    <aside className={styles.rail} aria-label="管理员导航">
      <Link className={styles.brand} href="/observability"><span className={styles.brandMark}>C</span><span>Chalk</span></Link>
      <div className={styles.railHeading}><span>Chalk</span><strong>管理后台</strong></div>
      <nav className={styles.railNav} aria-label="管理模块">
        <span className={styles.railSection}>运行管理</span>
        <Link aria-current="page" href="/observability"><Activity size={16} />Agent Trace</Link>
        <span className={styles.railSection}>账号管理</span>
        <Link href="/admin/users"><Users size={16} />用户与权限</Link>
      </nav>
      <div className={styles.railFooter}>
        <span><ShieldCheck size={14} />管理员视图</span>
        <Link href="/chat"><ArrowLeft size={15} />学习空间</Link>
      </div>
    </aside>

    <section className={styles.content} aria-labelledby="observability-title">
      <div className={styles.contentInner}>
        <header className={styles.header}>
          <div>
            <h1 id="observability-title">Agent Trace</h1>
            <p>按会话查看 Agent 调用链路、资源消耗与异常。</p>
          </div>
          <button className={styles.refreshButton} type="button" onClick={() => void loadOverview(true)} disabled={state === "loading" || refreshing} aria-label="刷新调用数据" title="刷新调用数据">
            <RefreshCw className={refreshing ? styles.spin : ""} size={16} />
          </button>
        </header>

        {state === "error" && <div className={styles.errorNotice} role="alert"><CircleAlert size={16} /><span>{error ?? "无法读取可观测性数据"}</span><button type="button" onClick={() => void loadOverview()}>重试</button></div>}

        <section className={styles.systemLedger} aria-label="调用概况">
          <div className={styles.ledgerStatement}>
            <Clock3 size={19} />
            <p>{state === "loading" ? "正在汇总最近的 Agent 调用…" : summaries.length ? `当前记录 ${summaries.length} 个有调用活动的会话。` : "还没有可供查看的调用记录。"}</p>
          </div>
          <div className={styles.ledgerTotals}>
            <span><small>会话</small><strong>{summaries.length}</strong></span>
            <span><small>调用</small><strong>{compactNumberFormatter.format(summaries.reduce((total, summary) => total + summary.runCount, 0))}</strong></span>
            <span><small>异常</small><strong>{compactNumberFormatter.format(summaries.reduce((total, summary) => total + summary.statusCounts.failed, 0))}</strong></span>
          </div>
        </section>

        <div className={styles.workspace}>
          <section className={styles.conversationPane} aria-labelledby="conversation-list-title">
            <header className={styles.paneHeader}>
              <div><span className={styles.sectionLabel}>Agent Trace</span><h2 id="conversation-list-title">最近会话</h2></div>
            </header>
            {state === "loading" ? <div className={styles.listLoading}><LoaderCircle className={styles.spin} size={17} />正在加载会话…</div>
              : summaries.length === 0 ? <div className={styles.listEmpty}><Database size={18} /><p>暂无调用摘要</p></div>
              : <div className={styles.conversationList}>{summaries.map((summary) => <button className={`${styles.conversationRow} ${summary.conversationId === selectedConversationId ? styles.conversationSelected : ""}`} type="button" key={summary.conversationId} onClick={() => setSelectedConversationId(summary.conversationId)} aria-pressed={summary.conversationId === selectedConversationId}>
                <strong title={summary.title ?? "未命名会话"}>{summary.title ?? "未命名会话"}</strong>
                <ChevronRight size={15} />
              </button>)}</div>}
          </section>

          <article className={styles.detailPane} aria-live="polite">
            {selectedSummary ? <ConversationDetail detail={detail} state={detailState} /> : <EmptyDetail />}
          </article>
        </div>
      </div>
    </section>
  </main>;
}
