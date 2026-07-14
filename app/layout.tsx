import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});

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
    <html lang="ko" className="h-full antialiased light" style={{ colorScheme: "light" }}>
      <body className={`${spaceGrotesk.variable} min-h-full flex flex-col bg-[#FFFDF5] text-black`}>
        {children}
      </body>
    </html>
  );
}
