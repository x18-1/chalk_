"use client";

import Link from "next/link";
import { Activity, ArrowLeft, ChevronLeft, ChevronRight, CircleAlert, LoaderCircle, Search, ShieldCheck, Users } from "lucide-react";
import { useEffect, useState } from "react";

import { ApiRequestError, adminApi, authApi, type AdminUser } from "../../../api";
import styles from "./users.module.css";

type PageState = "loading" | "ready" | "forbidden" | "error";
const pageSize = 25;
const dateFormatter = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" });

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "--" : dateFormatter.format(date);
}

function roleLabel(role: AdminUser["role"]) {
  return role === "admin" ? "管理员" : "用户";
}

export default function AdminUsersPage() {
  const [state, setState] = useState<PageState>("loading");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<"all" | AdminUser["role"]>("all");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function loadUsers(nextPage = page, nextQuery = submittedQuery, nextRole = role) {
    setState("loading");
    setError(null);
    try {
      const [{ user }, data] = await Promise.all([
        authApi.session(),
        adminApi.listUsers({ query: nextQuery || undefined, role: nextRole === "all" ? undefined : nextRole, limit: pageSize, offset: nextPage * pageSize }),
      ]);
      if (!user || user.role !== "admin") {
        setState("forbidden");
        return;
      }
      setUsers(data.users);
      setTotal(data.total);
      setState("ready");
    } catch (loadError) {
      if (loadError instanceof ApiRequestError && loadError.status === 403) {
        setState("forbidden");
        return;
      }
      setError(loadError instanceof Error ? loadError.message : "无法读取用户列表");
      setState("error");
    }
  }

  useEffect(() => { void loadUsers(0, "", "all"); }, []);

  function submitFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittedQuery(query.trim());
    setPage(0);
    void loadUsers(0, query.trim(), role);
  }

  function changeRole(nextRole: "all" | AdminUser["role"]) {
    setRole(nextRole);
    setPage(0);
    void loadUsers(0, submittedQuery, nextRole);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const canPrevious = page > 0;
  const canNext = page + 1 < totalPages;

  if (state === "forbidden") {
    return <main className={styles.accessPage}><section className={styles.accessMessage} aria-labelledby="access-title"><ShieldCheck size={24} /><h1 id="access-title">此页面仅限管理员访问</h1><p>用户与权限信息不对学生账号开放。</p><Link href="/chat"><ArrowLeft size={15} />返回学习空间</Link></section></main>;
  }

  return <main className={styles.page}>
    <aside className={styles.rail} aria-label="管理员导航">
      <Link className={styles.brand} href="/observability"><span className={styles.brandMark}>C</span><span>Chalk</span></Link>
      <div className={styles.railHeading}><span>Chalk</span><strong>管理后台</strong></div>
      <nav className={styles.railNav} aria-label="管理模块">
        <span className={styles.railSection}>运行管理</span>
        <Link href="/observability"><Activity size={16} />Agent Trace</Link>
        <span className={styles.railSection}>账号管理</span>
        <Link aria-current="page" href="/admin/users"><Users size={16} />用户与权限</Link>
      </nav>
      <div className={styles.railFooter}><span><ShieldCheck size={14} />管理员视图</span><Link href="/chat"><ArrowLeft size={15} />学习空间</Link></div>
    </aside>

    <section className={styles.content} aria-labelledby="users-title">
      <div className={styles.contentInner}>
        <header className={styles.header}><div><span className={styles.kicker}>账号管理</span><h1 id="users-title">用户与权限</h1><p>查看账号状态和角色。当前阶段只开放只读信息。</p></div><span className={styles.totalLabel}>{total} 个账号</span></header>
        <section className={styles.filterBar} aria-label="用户筛选">
          <form className={styles.searchForm} onSubmit={submitFilters}><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名或邮箱" aria-label="搜索姓名或邮箱" /><button type="submit">搜索</button></form>
          <div className={styles.roleTabs} role="group" aria-label="按角色筛选">
            {([['all', '全部'], ['admin', '管理员'], ['user', '用户']] as const).map(([value, label]) => <button key={value} className={role === value ? styles.roleActive : ""} type="button" onClick={() => changeRole(value)} aria-pressed={role === value}>{label}</button>)}
          </div>
        </section>
        {state === "error" && <div className={styles.errorNotice} role="alert"><CircleAlert size={16} /><span>{error}</span><button type="button" onClick={() => void loadUsers()}>重试</button></div>}
        <section className={styles.tableSection} aria-label="用户列表">
          {state === "loading" ? <div className={styles.emptyState}><LoaderCircle className={styles.spin} size={19} />正在加载用户…</div>
            : users.length === 0 ? <div className={styles.emptyState}><Users size={20} /><strong>没有匹配的账号</strong><span>调整搜索词或角色筛选后重试。</span></div>
            : <div className={styles.tableScroller}><table><thead><tr><th>账号</th><th>角色</th><th>创建时间</th><th>账号 ID</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><strong>{user.name || "未设置姓名"}</strong><span>{user.email}</span></td><td><span className={`${styles.roleMark} ${user.role === "admin" ? styles.adminMark : ""}`}>{roleLabel(user.role)}</span></td><td>{formatDate(user.createdAt)}</td><td><code title={user.id}>{user.id.slice(0, 8)}…</code></td></tr>)}</tbody></table></div>}
        </section>
        <footer className={styles.pagination}><span>{total === 0 ? "0" : `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, total)}`} / {total}</span><div><button type="button" disabled={!canPrevious || state === "loading"} onClick={() => { const next = page - 1; setPage(next); void loadUsers(next); }} aria-label="上一页"><ChevronLeft size={16} /></button><span>第 {page + 1} / {totalPages} 页</span><button type="button" disabled={!canNext || state === "loading"} onClick={() => { const next = page + 1; setPage(next); void loadUsers(next); }} aria-label="下一页"><ChevronRight size={16} /></button></div></footer>
      </div>
    </section>
  </main>;
}
