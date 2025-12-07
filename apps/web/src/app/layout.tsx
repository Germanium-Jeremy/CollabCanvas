import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "CollabCanvas — Real-time Collaborative Whiteboard",
  description:
    "Draw, brainstorm and plan together in real time, with AI assistance for summaries, next steps and diagrams.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b bg-white">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <span className="inline-block h-5 w-5 rounded bg-blue-600" aria-hidden />
              CollabCanvas
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/rooms" className="text-slate-600 hover:text-slate-900">
                My rooms
              </Link>
              <Link href="/login" className="rounded-md bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700">
                Sign in
              </Link>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
