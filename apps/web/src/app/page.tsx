import Link from "next/link";

const features = [
  {
    title: "Real-time collaboration",
    body: "Multi-user canvas with live cursors and presence, powered by CRDTs — edits merge even after reconnects.",
  },
  {
    title: "Everything you need on a board",
    body: "Freehand drawing, sticky notes, shapes, text and arrows with instant sync across teammates.",
  },
  {
    title: "Light AI assistance",
    body: "Summarize the board, get next-step suggestions and generate diagrams from a prompt — rate-limited and cost-controlled.",
  },
  {
    title: "Export & history",
    body: "Export the board as PNG or PDF and restore any of the last saved versions.",
  },
];

export default function LandingPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-16">
      <section className="text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Think together on a shared canvas
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600">
          CollabCanvas is a focused real-time whiteboard for small teams and study groups —
          with just enough AI to keep the session moving.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            href="/login"
            className="rounded-lg bg-blue-600 px-5 py-2.5 font-medium text-white hover:bg-blue-700"
          >
            Start whiteboarding
          </Link>
          <Link
            href="/rooms"
            className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 font-medium hover:bg-slate-50"
          >
            Go to my rooms
          </Link>
        </div>
      </section>

      <section className="mt-16 grid gap-4 sm:grid-cols-2">
        {features.map((f) => (
          <div key={f.title} className="rounded-xl border bg-white p-6 shadow-sm">
            <h2 className="font-semibold">{f.title}</h2>
            <p className="mt-2 text-sm text-slate-600">{f.body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
