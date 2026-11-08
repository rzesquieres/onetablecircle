# OneTableCircle

Order together, split fairly. Everyone at the table orders from their own phone. The app combines the order for the waiter, tracks what's been served, and splits the bill, including shared dishes, service charge and tax.

## Status
Project setup done (Phase 0). The architecture proposal is waiting for approval: see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Tech stack
Next.js 16 (TypeScript, Tailwind) · Supabase (auth, Postgres, realtime, storage) · Claude API · Vitest. Hosted on Hostinger's managed Node.js web app hosting.

## Getting started (local)
Requires Node.js 22 or newer.
```
npm install
npm run dev      # http://localhost:3000
npm test         # unit tests
npm run build    # production build (what Hostinger runs)
```
Secrets go in `.env.local`, which is never committed. The variable list is in [docs/DEPLOY-HOSTINGER.md](docs/DEPLOY-HOSTINGER.md#environment-variables-secrets-and-settings).

## Deployment
Push to `main` on GitHub and Hostinger builds and deploys automatically. One-time setup: [docs/DEPLOY-HOSTINGER.md](docs/DEPLOY-HOSTINGER.md).
