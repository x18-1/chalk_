import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { AppSidebar } from "../../components/app-sidebar";

import styles from "./chalkboard.module.css";

export default function ChalkboardPage() {
  return <main className={styles.page}>
    <AppSidebar activeSection="chalkboard" />
    <section className={styles.content}>
      <div className={styles.contentInner}>
        <span className={styles.kicker}>Chalkboard</span>
        <h1>课程工作区</h1>
        <p>课程内容会在 Chat 的问题上下文稳定后接入这里。</p>
        <Link className={styles.backLink} href="/chat"><ArrowLeft size={15} />回到 Chat</Link>
      </div>
    </section>
  </main>;
}
