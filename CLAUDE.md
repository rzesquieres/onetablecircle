# OneTableCircle

A web app that lets a group at a restaurant order together and split the bill fairly.
Owner: Khukhu (Ronnel). It's for personal use first; the plan is to sell it later.

## Product goals
- A group joins one shared "table" (via link or QR code) from their own phones, with no account needed to join.
- Each person adds what they ordered. Items can be shared between several people (for example, a platter split 3 ways).
- The app splits the bill: per-person subtotals, shared items split evenly or by custom share, plus tax, service charge and tip applied proportionally.
- It shows clearly who owes whom, so settling up takes one step.
- Currency defaults to PHP (₱). Assume Philippine bills: VAT is already included in menu prices, and a 10% service charge is common. Make both configurable.

## Hosting
- Hosted on **Hostinger**. Before picking libraries or a runtime, check which plan it is (shared/PHP vs. Node-capable/VPS).
- Keep the deploy simple: a build output that can be uploaded or git-deployed to Hostinger.

## Tech stack
- Hosting: Hostinger managed Node.js web app (Node 22), auto-deployed from GitHub `main`. See `docs/DEPLOY-HOSTINGER.md`.
- Next.js 16 App Router + TypeScript + Tailwind. This Next version has breaking changes: read `node_modules/next/dist/docs/` before writing Next-specific code (see `AGENTS.md`).
- Proposed (awaiting approval): Supabase for auth, Postgres + RLS, realtime and storage; Claude API for receipt and menu extraction. See `docs/ARCHITECTURE.md`.
- Tests: Vitest (`npm test`). Money helpers are in `src/lib/money.ts`.

## Conventions
- Calculate money in integer centavos. Never use floats for amounts.
- Bill-splitting logic lives in pure, unit-tested functions, kept separate from the UI. Rounding remainders must be assigned deterministically, so the per-person totals always add up exactly to the bill.
- Design for mobile first. Most people will use it on a phone at the table.
- Keep secrets in `.env`, which is never committed. Keep `.env.example` up to date.

## Workflow
- Run the tests before calling a change done.
- Keep commits small and descriptive.

## Environment notes
- This repo is in **OneDrive** (`C:\Users\rzesq\OneDrive\OneTableCircle`). OneDrive syncing `node_modules`, `.git` and build folders can be slow or cause lock errors. If that becomes a problem, exclude those folders from sync, or move the repo out of OneDrive and use git/GitHub for backup.
- OS: Windows. Prefer cross-platform npm scripts. Don't use bash-only commands in `package.json`.
