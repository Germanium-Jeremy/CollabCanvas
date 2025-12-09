# Demo script (2–4 minutes)

1. **Setup (10s)** — Open the deployed app (or localhost). Show the landing page
   briefly: "a real-time whiteboard with AI assistance."
2. **Two-user collaboration (60s)**
   - Register/create room in Browser 1 (public room).
   - Open the invite link in Browser 2 (or a private window).
   - Draw with the pen, add a sticky note, a rectangle and an arrow in Browser 1 —
     point at the instant sync in Browser 2 and the live cursors.
   - Drag a shape in Browser 2; show undo/redo in Browser 1.
3. **AI assistance (45s)**
   - Add 3–4 sticky notes with ideas (e.g. "login flow", "dark mode", "onboarding").
   - Open the AI panel → *Summarize board* → show the result.
   - *Suggest next steps* → pick one.
   - *Generate diagram* with prompt "signup, login, dashboard" → shapes appear on
     the board; everyone sees them.
   - Mention: proxied server-side, 5 actions/hour/user, mock provider for demos.
4. **Permissions (30s)**
   - In the API (or second account set to VIEWER by the owner), show the viewer's
     toolbar disabled and that their drag attempts change nothing.
5. **History & export (30s)**
   - *History* → Save current version → make a change → restore the version
     (both browsers converge).
   - *Export PNG* → open the downloaded file.
6. **Close (10s)** — Show offline tolerance: kill the realtime server briefly,
   keep drawing, restart, watch edits merge. Point to `docs/architecture.md`.

## Recording tips

- Use two side-by-side browser windows at 125% zoom for visibility.
- Cursor labels are colored — mention "presence" explicitly.
- Keep the terminal with `pnpm dev` visible during the offline-tolerance bit.
