import type { Metadata } from "next";
import "./globals.css";
import "katex/dist/katex.min.css";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";

import { LauncherLifecycle } from '@/components/layout/LauncherLifecycle';

export const metadata: Metadata = {
  title: "Lumer Assistant · 可复核文献工作台",
  description: "本地优先的论文阅读、证据核验与 Paper Card 工作台。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased" suppressHydrationWarning>
      <body className="h-full bg-surface" suppressHydrationWarning>
        <LauncherLifecycle />
        {children}
      </body>
    </html>
  );
}
