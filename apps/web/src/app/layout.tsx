import type { Metadata } from "next";

import "@fontsource-variable/noto-sans-sc";
import { AuthBoundary } from "../components/auth-boundary";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chalk | Guided mathematical thinking",
  description: "A focused learning desk for working through mathematics.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body><AuthBoundary>{children}</AuthBoundary></body>
    </html>
  );
}
