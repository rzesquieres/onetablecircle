# Deploying to Hostinger from GitHub

The app runs on Hostinger's **managed Node.js web app** hosting. Every push to the `main` branch on GitHub rebuilds and redeploys the site automatically.

You only do steps 1–4 once.

---

## 1. Check your Hostinger plan
Node.js web apps come with **Business Web Hosting** and **Cloud** plans (Startup / Professional / Enterprise). A plain "Single" or "Premium" shared plan can't run them. A VPS can, but it needs manual server setup that this guide doesn't cover.

In hPanel, open **Websites**. If **Add Website → Node.js web app** is offered, your plan supports it.

## 2. Put the code on GitHub
1. Create a free account at <https://github.com> if you don't have one.
2. Click **New repository**. Name it `OneTableCircle`, choose **Private**, and **don't** add a README or .gitignore (the project has them already).
3. In VS Code, open a terminal (**Terminal → New Terminal**) in the project folder and run:
   ```
   git branch -M main
   git add .
   git commit -m "Initial Next.js project"
   git remote add origin https://github.com/<your-username>/OneTableCircle.git
   git push -u origin main
   ```
   On the first push, a browser window asks you to sign in to GitHub. Approve it.

## 3. Create the Node.js web app in Hostinger
1. hPanel → **Websites** → **Add Website** → **Node.js web app**.
2. Under **Import your Git repository**, click **Connect with GitHub**. In the pop-up, install the **Hostinger GitHub App** and give it access to the `OneTableCircle` repository only.
3. Pick the repository and click **Deploy**.
4. Check the pre-filled settings and fix any that differ:

   | Setting | Value |
   |---|---|
   | Framework preset | **Next.js** |
   | Branch | `main` |
   | Node.js version | **22** |
   | Package manager | **npm** |
   | Build command | `npm run build` |
   | Output directory | `.next` |
   | Entry file | *(leave empty; Next.js ignores it)* |

5. Click **Deploy**. The first build takes a few minutes. Progress and logs are under **Deployments**.
6. Connect your domain when prompted, or use the temporary Hostinger domain for now.

## 4. Check it works
Open `https://<your-domain>/api/health`. You should see something like:
```json
{ "status": "ok", "app": "OneTableCircle", "node": "v22.x", ... }
```
The home page should show "OneTableCircle — Order together, split fairly."

---

## Environment variables (secrets and settings)
Phase 0 (this setup) doesn't need any. You'll add them when Phase 1 starts. Keep this list in a `.env.example` file in the repo as the reference.

In hPanel: your website dashboard → **Environment variables** → **Add environment variable**, or **Import .env** to upload a file. **Saving triggers a redeploy.**

| Key | Needed from | Where to get it | Secret? |
|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | Phase 1 | Your site address, e.g. `https://onetablecircle.com` (no trailing slash) | no |
| `NEXT_PUBLIC_DEFAULT_CURRENCY` | Phase 1 | `PHP` | no |
| `NEXT_PUBLIC_SUPABASE_URL` | Phase 1 | Supabase → Project Settings → API | no |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Phase 1 | Supabase → Project Settings → API (the "anon / public" key) | no (designed to be public) |
| `SUPABASE_SERVICE_ROLE_KEY` | Phase 1 | Supabase → Project Settings → API (the "service_role" key) | **YES**, never share |
| `ANTHROPIC_API_KEY` | Phase 4 | <https://console.anthropic.com> → API Keys | **YES** |
| `ANTHROPIC_MODEL` | Phase 4 | `claude-sonnet-5-5` | no |

Important:
- `NEXT_PUBLIC_*` values are **baked in at build time**. Set them in Hostinger *before* the deploy that needs them. If you change one later, Hostinger's automatic redeploy picks it up.
- For local development, put the same keys in a file named `.env.local` in the project folder. Git ignores it, so it's never uploaded.

## Everyday workflow
1. Make changes locally and test with `npm run dev` (opens <http://localhost:3000>).
2. Run `npm test` and `npm run build`.
3. `git add . && git commit -m "..." && git push`. Hostinger rebuilds automatically within a minute or two.
4. If a deploy fails: hPanel → **Deployments** → open the failed build → read the log. The previous version stays live until a build succeeds.

## Limits to know
- Build steps time out after 15 minutes (ours takes about 1–2).
- One deployment runs at a time. Later pushes queue up.
- CPU and RAM are capped by your plan. Live updates run on Supabase, not Hostinger, so this app is light on Hostinger resources.
- Supabase free tier pauses a project after about a week with no activity. Click **Restore** in Supabase if that happens, or upgrade when you start selling.

## Later (Phase 1 setup you'll do yourself, guided step by step then)
- Create a Supabase project (choose region **Southeast Asia (Singapore)**, closest to the Philippines).
- Turn on Email, Google and Anonymous sign-in in Supabase Auth.
- Create a Google OAuth client in Google Cloud Console and paste it into Supabase.
- Add your Hostinger domain to Supabase **Auth → URL Configuration** (Site URL + Redirect URLs).
