import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "수행평가 수합·평가·생기부",
  description: "수행평가 산출물 수합·평가와 생기부 서술 생성 도구",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
