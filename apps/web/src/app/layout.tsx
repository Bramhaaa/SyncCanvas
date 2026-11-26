import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SyncCanvas",
  description: "Offline-first real-time collaborative whiteboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-50 text-neutral-950 antialiased">{children}</body>
    </html>
  );
}
