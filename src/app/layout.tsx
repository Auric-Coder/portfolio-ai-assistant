import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "portfolio-ai-assistant: demo shell",
  description: "A minimal Next.js shell that mounts the portfolio AI assistant widget over a fictional sample persona.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
