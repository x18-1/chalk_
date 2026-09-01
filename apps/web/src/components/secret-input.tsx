"use client";

import { useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";

import styles from "./app-sidebar.module.css";

type SecretInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  secretLabel?: string;
};

export function SecretInput({ secretLabel = " API Key", ...props }: SecretInputProps) {
  const [revealed, setRevealed] = useState(false);
  const label = revealed ? `隐藏${secretLabel}` : `显示${secretLabel}`;
  return <span className={styles.secretInput}>
    <input {...props} type={revealed ? "text" : "password"} />
    <button type="button" aria-label={label} title={label} aria-pressed={revealed} onClick={() => setRevealed((value) => !value)}>
      {revealed ? <EyeOff size={15} /> : <Eye size={15} />}
    </button>
  </span>;
}
