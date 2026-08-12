'use client';

import { useState } from 'react';

import { apiJson } from '../../lib/client/api';
import styles from './login.module.css';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await apiJson('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    } catch {
      setError('邮箱或密码不正确。');
      setPending(false);
      return;
    }
    setPending(false);
    window.location.assign('/chat');
  }

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="login-title">
        <div className={styles.brand}><span className={styles.brandMark}>C</span><span>Chalk</span></div>
        <div className={styles.heading}>
          <h1 id="login-title">进入学习空间</h1>
          <p>从一道数学题开始，继续你的思考。</p>
        </div>
        <form className={styles.form} onSubmit={submit}>
          <label className={styles.field}>
            <span>邮箱</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
          </label>
          <label className={styles.field}>
            <span>密码</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
          </label>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <button className={styles.submit} type="submit" disabled={pending}>{pending ? '正在进入…' : '进入 Chalk'}</button>
        </form>
        {process.env.NODE_ENV !== 'production' && <p className={styles.hint}>开发环境可使用 `.env` 中的 DEV_USER_EMAIL 和 DEV_USER_PASSWORD。</p>}
      </section>
    </main>
  );
}
