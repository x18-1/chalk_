"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { LoaderCircle, RotateCw } from "lucide-react";

import { ApiRequestError, authApi } from "../api";
import styles from "./auth-boundary.module.css";

const protectedPrefixes = ["/chat", "/chats", "/chalkboard", "/observability", "/admin"];

export function AuthBoundary({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const protectedPage = protectedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  const [state, setState] = useState<"loading" | "ready" | "error">(protectedPage ? "loading" : "ready");
  const [attempt, setAttempt] = useState(0);
  const verifiedSessionRef = useRef(false);

  useEffect(() => {
    if (!protectedPage) {
      setState("ready");
      return;
    }
    if (verifiedSessionRef.current) {
      setState("ready");
      return;
    }

    const controller = new AbortController();
    setState("loading");
    void authApi.session(controller.signal)
      .then(({ user }) => {
        if (!user) {
          window.location.replace(`/login?returnTo=${encodeURIComponent(pathname)}`);
          return;
        }
        verifiedSessionRef.current = true;
        setState("ready");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiRequestError && error.status === 401) {
          window.location.replace(`/login?returnTo=${encodeURIComponent(pathname)}`);
          return;
        }
        setState("error");
      });

    return () => controller.abort();
  }, [attempt, pathname, protectedPage]);

  if (!protectedPage || state === "ready") return children;

  return <main className={styles.statePage} aria-live="polite">
    {state === "loading"
      ? <><LoaderCircle className={styles.spinner} size={22} /><span>正在打开学习空间…</span></>
      : <><strong>暂时无法连接 Chalk</strong><span>请检查网络后重试。</span><button type="button" onClick={() => setAttempt((value) => value + 1)}><RotateCw size={15} />重试</button></>}
  </main>;
}
