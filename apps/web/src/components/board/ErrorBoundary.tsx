"use client";

import { Component } from "react";

interface State {
  error: Error | null;
}

/** Catches render-time crashes inside the board so the app shell survives. */
export class ErrorBoundary extends Component<{ children: React.ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error): void {
    // Hook point for Sentry in production.
    console.error("[board] crashed:", error);
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="flex h-full items-center justify-center p-8">
          <div className="max-w-md rounded-xl border bg-white p-6 text-center shadow-sm">
            <h2 className="font-semibold">The board hit an error</h2>
            <p className="mt-2 text-sm text-slate-600">
              Your work is saved on the server. Reload the page to rejoin the session.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
