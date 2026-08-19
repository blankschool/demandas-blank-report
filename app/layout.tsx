import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Operação Criativa · Blank School",
  description: "Relatório interno da operação criativa por cliente.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
