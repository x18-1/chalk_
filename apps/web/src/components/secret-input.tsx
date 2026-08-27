"use client";

import { useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";

import styles from "./app-sidebar.module.css";

export function SecretInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [revealed, setRevealed] = useState(false);
  const label = revealed ? "隐藏 API Key" : "显示 API Key";
  return <span className={styles.secretInput}>
    <input {...props} type={revealed ? "text" : "password"} />
    <button type="button" aria-label={label} title={label} aria-pressed={revealed} onClick={() => setRevealed((value) => !value)}>
      {revealed ? <EyeOff size={15} /> : <Eye size={15} />}
    </button>
  </span>;
}
