# OneTableCircle

Order together, split fairly. Everyone at the table orders from their own phone. The app combines the order for the waiter, tracks what's been served, and splits the bill, including shared dishes, service charge and tax.

## Status
All six planned phases built:
- Phase 1: sign-in, tables, free-text ordering, the consolidated waiter view and a live delivery checklist
- Phase 2: QR and link sharing with quick guest access
- Phase 3: stores, menus with options, and the admin panel at `/admin`
- Phase 4: AI menu import, "AI add store" (drafts reviewed by an admin) and menu problem reports
- Phase 5: receipt scanning, bill splitting (exact to the centavo) and settling up with GCash/Maya QR codes
- Phase 6: saved groups, "my usual" favourites, spending history and admin analytics

Setup: [docs/SETUP-SUPABASE.md](docs/SETUP-SUPABASE.md). Design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

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

## License
Proprietary. All rights reserved. See [LICENSE](LICENSE).
