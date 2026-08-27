"use client";

import { useRef, useState } from "react";
import { AlertTriangle, LoaderCircle, Upload, X } from "lucide-react";

import { classroomImportErrorMessage, classroomsApi } from "../../../api";
import styles from "../chalkboard.module.css";

const MAX_ARCHIVE_BYTES = 32 * 1_024 * 1_024;

type ClassroomImportControlProps = {
  compact?: boolean;
  onImported(classroomId: string): void;
};

type ImportStatus = {
  kind: "uploading" | "error";
  filename: string;
  message: string;
};

export function ClassroomImportControl({ compact = false, onImported }: ClassroomImportControlProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<ImportStatus | null>(null);

  async function importFile(file: File) {
    const filename = file.name.trim();
    if (!/\.(chalk|maic)\.zip$/i.test(filename)) {
      setStatus({
        kind: "error",
        filename,
        message: "请选择以 .chalk.zip 或 .maic.zip 结尾的课堂归档。",
      });
      return;
    }
    if (file.size > MAX_ARCHIVE_BYTES) {
      setStatus({
        kind: "error",
        filename,
        message: "归档超过 32 MiB，请移除不必要的媒体后重试。",
      });
      return;
    }

    setStatus({ kind: "uploading", filename, message: "正在上传并校验课堂内容…" });
    try {
      const result = await classroomsApi.importArchive(file);
      setStatus(null);
      onImported(result.classroom.id);
    } catch (error) {
      setStatus({ kind: "error", filename, message: classroomImportErrorMessage(error) });
    }
  }

  return <>
    <input
      ref={inputRef}
      className={styles.visuallyHidden}
      type="file"
      accept=".chalk.zip,.maic.zip,application/zip"
      aria-label="选择课堂归档"
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) void importFile(file);
      }}
    />
    <button
      className={compact ? styles.importCompactButton : styles.importActionButton}
      type="button"
      disabled={status?.kind === "uploading"}
      aria-busy={status?.kind === "uploading"}
      aria-label={compact ? "导入课堂" : undefined}
      title={compact ? "导入课堂" : undefined}
      onClick={() => inputRef.current?.click()}
    >
      {status?.kind === "uploading" ? <LoaderCircle className={styles.importSpinner} size={15} /> : <Upload size={15} />}
      {!compact ? <span>导入课堂</span> : null}
    </button>
    {status ? <aside
      className={`${styles.importNotice} ${status.kind === "error" ? styles.importNoticeError : ""}`}
      role={status.kind === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      <span className={styles.importNoticeIcon}>
        {status.kind === "uploading"
          ? <LoaderCircle className={styles.importSpinner} size={17} />
          : <AlertTriangle size={17} />}
      </span>
      <span className={styles.importNoticeCopy}>
        <strong>{status.kind === "uploading" ? "正在导入课堂" : "课堂导入失败"}</strong>
        <span>{status.filename}</span>
        <p>{status.message}</p>
      </span>
      {status.kind === "error" ? <button type="button" aria-label="关闭导入提示" onClick={() => setStatus(null)}><X size={14} /></button> : null}
    </aside> : null}
  </>;
}
