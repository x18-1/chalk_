"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, FileText, LoaderCircle, Plus, RefreshCw, Search, Upload, X } from "lucide-react";

import { AppSidebar } from "../../components/app-sidebar";
import { knowledgeBaseErrorMessage, knowledgeBasesApi, type KnowledgeBase, type KnowledgeChunk, type RagAnswer } from "../../api";
import styles from "./knowledge-bases.module.css";

const MAX_DOCUMENT_SIZE = 15 * 1024 * 1024;
const CONTENT_TYPES_BY_EXTENSION: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function documentContentType(file: File) {
  if (Object.values(CONTENT_TYPES_BY_EXTENSION).includes(file.type)) return file.type;
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  return CONTENT_TYPES_BY_EXTENSION[extension] ?? null;
}

export default function KnowledgeBasesPage() {
  const [bases, setBases] = useState<KnowledgeBase[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<RagAnswer | null>(null);
  const [asking, setAsking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [reindexingId, setReindexingId] = useState<string | null>(null);
  const [expandedDocumentId, setExpandedDocumentId] = useState<string | null>(null);
  const [chunksByDocument, setChunksByDocument] = useState<Record<string, KnowledgeChunk[]>>({});
  const [loadingChunksId, setLoadingChunksId] = useState<string | null>(null);
  const selected = useMemo(() => bases.find((base) => base.id === selectedId) ?? bases[0] ?? null, [bases, selectedId]);

  const refreshBases = useCallback((selectFirst = false) => knowledgeBasesApi.list().then((data) => {
      setBases(data.knowledgeBases);
      if (selectFirst) setSelectedId(data.knowledgeBases[0]?.id ?? null);
    }), []);

  useEffect(() => {
    void refreshBases(true).catch((loadError) => setError(knowledgeBaseErrorMessage(loadError))).finally(() => setLoading(false));
  }, [refreshBases]);

  useEffect(() => {
    if (!bases.some((base) => base.documents.some((document) => document.status === "pending" || document.status === "indexing"))) return;
    const timer = window.setInterval(() => {
      void refreshBases().catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [bases, refreshBases]);

  async function createBase() {
    const name = newName.trim();
    if (!name) return;
    setSaving(true); setError(null);
    try {
      const { knowledgeBase } = await knowledgeBasesApi.create({ name, description: newDescription.trim() || undefined });
      setBases((current) => [knowledgeBase, ...current]); setSelectedId(knowledgeBase.id); setNewName(""); setNewDescription(""); setCreating(false);
    } catch (createError) { setError(knowledgeBaseErrorMessage(createError)); }
    finally { setSaving(false); }
  }

  async function upload(file: File) {
    if (!selected) return;
    setError(null);
    if (file.size <= 0) { setError("文件为空，无法上传。"); return; }
    if (file.size > MAX_DOCUMENT_SIZE) { setError("文件不能超过 15 MB，请压缩或拆分后再上传。"); return; }
    const contentType = documentContentType(file);
    if (!contentType) { setError("暂不支持此文件格式，请选择 PDF、Markdown、纯文本或 DOCX。"); return; }
    setUploading(true);
    try {
      const prepared = await knowledgeBasesApi.prepareDocument(selected.id, { filename: file.name, contentType, size: file.size });
      const response = await fetch(prepared.uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body: file });
      if (!response.ok) throw new Error("文件上传失败");
      await knowledgeBasesApi.confirmDocument(selected.id, prepared.document.id);
      await refreshBases();
    } catch (uploadError) { setError(knowledgeBaseErrorMessage(uploadError)); }
    finally { setUploading(false); }
  }

  async function retry(documentId: string) {
    if (!selected) return;
    setRetryingId(documentId); setError(null);
    try { await knowledgeBasesApi.confirmDocument(selected.id, documentId); await refreshBases(); }
    catch (retryError) { setError(knowledgeBaseErrorMessage(retryError)); }
    finally { setRetryingId(null); }
  }

  async function reindex(documentId: string) {
    if (!selected) return;
    if (!window.confirm("将删除这份资料的旧索引并重新解析，确定继续吗？")) return;
    setReindexingId(documentId); setError(null);
    try { await knowledgeBasesApi.reindexDocument(selected.id, documentId); await refreshBases(); }
    catch (reindexError) { setError(knowledgeBaseErrorMessage(reindexError)); }
    finally { setReindexingId(null); }
  }

  async function toggleChunks(documentId: string) {
    if (!selected) return;
    if (expandedDocumentId === documentId) { setExpandedDocumentId(null); return; }
    setExpandedDocumentId(documentId);
    if (chunksByDocument[documentId]) return;
    setLoadingChunksId(documentId);
    try {
      const result = await knowledgeBasesApi.chunks(selected.id, documentId);
      setChunksByDocument((current) => ({ ...current, [documentId]: result.chunks }));
    } catch (chunksError) { setError(knowledgeBaseErrorMessage(chunksError)); }
    finally { setLoadingChunksId(null); }
  }

  async function ask() {
    if (!selected || !question.trim()) return;
    setAsking(true); setError(null); setAnswer(null);
    try { setAnswer(await knowledgeBasesApi.query(selected.id, { query: question.trim(), mode: "hybrid", topK: 5, enableRerank: true })); }
    catch (queryError) { setError(knowledgeBaseErrorMessage(queryError)); }
    finally { setAsking(false); }
  }

  return <main className={styles.page}>
    <AppSidebar activeSection="knowledge-bases" historyMode="all" />
    <section className={styles.content} aria-labelledby="knowledge-title">
      <div className={styles.contentInner}>
        <header className={styles.header}><div><span className={styles.kicker}>学习资料</span><h1 id="knowledge-title">知识库</h1><p>把教材、讲义和笔记整理成可检索的学习上下文，让 Chat 在需要时给出可追溯的资料依据。</p></div><div className={styles.headerActions}><button className={styles.primaryCreateButton} type="button" onClick={() => setCreating(true)}><Plus size={16} />新建知识库</button><BookOpen size={24} className={styles.headerIcon} /></div></header>
        {error && <div className={styles.error} role="alert"><span>{error}</span><button type="button" aria-label="关闭错误" onClick={() => setError(null)}><X size={16} /></button></div>}
        <div className={styles.workspace}>
          <aside className={styles.baseList} aria-label="知识库列表">
            <div className={styles.listHeader}><span>我的知识库</span><span className={styles.baseCount}>{bases.length}</span></div>
            {creating && <form className={styles.createForm} onSubmit={(event) => { event.preventDefault(); void createBase(); }}><label><span>名称</span><input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="例如：七年级代数" aria-label="知识库名称" disabled={saving} /></label><label><span>说明（可选）</span><input value={newDescription} onChange={(event) => setNewDescription(event.target.value)} placeholder="例如：本学期课堂讲义" aria-label="知识库说明" disabled={saving} /></label><div className={styles.createActions}><button className={styles.secondaryButton} type="button" disabled={saving} onClick={() => { setCreating(false); setNewName(""); setNewDescription(""); }}>取消</button><button className={styles.createSubmit} type="submit" disabled={!newName.trim() || saving}>{saving ? <LoaderCircle size={14} className={styles.spin} /> : <Plus size={14} />} {saving ? "创建中…" : "创建"}</button></div></form>}
            {loading ? <p className={styles.muted}>正在加载…</p> : bases.length ? bases.map((base) => <button className={`${styles.baseItem} ${selected?.id === base.id ? styles.baseItemActive : ""}`} type="button" key={base.id} onClick={() => { setSelectedId(base.id); setAnswer(null); }}><BookOpen size={16} /><span><strong>{base.name}</strong><small>{base.documents.length} 份资料</small></span></button>) : <div className={styles.empty}><BookOpen size={20} /><p>还没有知识库</p><small>知识库用于集中管理资料，并让 Chat 在回答时检索这些内容。</small><button className={styles.emptyCreateButton} type="button" onClick={() => setCreating(true)}><Plus size={15} />创建第一个知识库</button></div>}
          </aside>
          <section className={styles.detail} aria-live="polite">
            {selected ? <>
              <div className={styles.detailHeader}><div><h2>{selected.name}</h2><p>{selected.description || "上传教材、讲义或自己的笔记，之后可以直接提问。"}</p></div><div className={styles.uploadArea}>{uploading && <span className={styles.uploading}><LoaderCircle size={14} className={styles.spin} />正在上传并建立索引…</span>}<label className={`${styles.uploadButton} ${uploading ? styles.uploadButtonDisabled : ""}`}><Upload size={16} />上传资料<input type="file" disabled={uploading} accept=".txt,.md,.pdf,.docx" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.currentTarget.value = ""; }} /></label><small className={styles.uploadHint}>支持 PDF、Markdown、TXT、DOCX，单文件不超过 15 MB</small></div></div>
              <div className={styles.documentSection}><div className={styles.sectionHeading}><h3>资料</h3><span>{selected.documents.length}</span></div>{selected.documents.length ? <ul className={styles.documents}>{selected.documents.map((document) => <li key={document.id}><div className={styles.documentRow}><FileText size={17} /><span><strong>{document.filename}</strong><small>{document.status === "ready" ? `${document.pageCount ?? 1} 页 · ${document.chunkCount ?? 0} 个分块` : document.status === "failed" ? document.error || "索引失败" : document.status === "indexing" ? "正在建立索引…" : "已上传，等待处理…"}</small></span><span className={`${styles.status} ${styles[`status_${document.status}`]}`}>{document.status === "ready" ? "已就绪" : document.status === "failed" ? "失败" : document.status === "indexing" ? "处理中" : "等待中"}</span>{document.status === "ready" && <><button className={styles.chunksButton} type="button" onClick={() => void toggleChunks(document.id)}>{loadingChunksId === document.id ? "读取中…" : expandedDocumentId === document.id ? "收起分块" : "查看分块"}</button><button className={styles.reindexButton} type="button" disabled={reindexingId === document.id} onClick={() => void reindex(document.id)} title="使用当前解析器重新建立索引" aria-label={`重新索引 ${document.filename}`}>{reindexingId === document.id ? <LoaderCircle size={13} className={styles.spin} /> : <RefreshCw size={13} />}<span>{reindexingId === document.id ? "重建中…" : "重新索引"}</span></button></>}{document.status === "failed" && <button className={styles.retryButton} type="button" disabled={retryingId === document.id} onClick={() => void retry(document.id)}>{retryingId === document.id ? "重试中…" : "重试"}</button>}</div>{expandedDocumentId === document.id && <div className={styles.chunkList}>{(chunksByDocument[document.id] ?? []).map((chunk) => <article key={chunk.chunkId}><header><span>Chunk {chunk.index}</span><small>{chunk.page ? `第 ${chunk.page} 页 · ` : ""}{chunk.tokenCount} tokens</small></header><p>{chunk.content}</p></article>)}</div>}</li>)}</ul> : <div className={styles.dropHint}><Upload size={19} /><p>上传第一份资料</p><small>支持 PDF、Markdown 和纯文本</small></div>}</div>
              <form className={styles.queryForm} onSubmit={(event) => { event.preventDefault(); void ask(); }}><label htmlFor="knowledge-question">向资料提问</label><div><Search size={17} /><input id="knowledge-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="例如：这份资料如何解释一次函数？" /><button type="submit" disabled={asking || !question.trim()}>{asking ? <LoaderCircle size={16} className={styles.spin} /> : "检索"}</button></div></form>
              {answer && <section className={styles.answer} aria-labelledby="answer-title"><div className={styles.answerHeading}><h3 id="answer-title">回答</h3><small>{answer.metadata.mode} · {answer.metadata.latencyMs} ms</small></div><p className={styles.answerText}>{answer.answer}</p><div className={styles.references}><h4>答案来自</h4>{answer.references.length ? answer.references.map((reference) => <article key={reference.citationId}><div><strong>{reference.documentName}</strong>{reference.page ? <span>第 {reference.page} 页</span> : null}{reference.paragraph ? <span>第 {reference.paragraph} 段</span> : null}</div><p>{reference.snippet}</p></article>) : <p className={styles.muted}>这次回答没有返回可定位的引用。</p>}</div></section>}
            </> : <div className={styles.emptyDetail}><BookOpen size={28} /><h2>先创建一个知识库</h2><p>知识库会把资料、索引和可追溯引用放在一起。</p></div>}
          </section>
        </div>
      </div>
    </section>
  </main>;
}
