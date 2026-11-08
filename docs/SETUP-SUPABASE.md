# Phase 1 setup: Supabase + Google sign-in

Supabase is the app's database and login system. You do this setup once, and it takes about 20–30 minutes. You'll copy 2 values out of it at the end.

---

## 1. Create the Supabase project
1. Go to <https://supabase.com> → **Start your project** → sign in with GitHub (easiest).
2. Click **New project**:
   - **Name:** `onetablecircle`
   - **Database password:** click **Generate**, then save it in your password manager. The app doesn't need it, but you may need it later.
   - **Region:** **Southeast Asia (Singapore)**. It's the closest to the Philippines, so the app feels faster.
   - **Plan:** Free.
3. Wait about 2 minutes for it to finish setting up.

## 2. Create the database tables
1. In the left sidebar, open **SQL Editor** → **New query**.
2. In VS Code, open [supabase/migrations/20261108000000_phase1.sql](../supabase/migrations/20261108000000_phase1.sql). Select all (Ctrl+A), copy, and paste it into the Supabase editor.
3. Click **Run**. You should see **"Success. No rows returned."**
4. To check it worked, open **Table Editor**. You should see `profiles`, `sessions`, `participants`, `order_items`, `order_item_assignees` and `delivery_events`.

> Run this file only once. If you run it again, it errors with "already exists", which is harmless.

## 3. Email sign-in settings
1. **Authentication** → **Sign In / Providers** → **Email**: make sure it's **enabled**.
2. For now, turn **Confirm email** **off**, then **Save**.
   *Why:* Supabase's built-in email sender only sends a couple of emails per hour. That's fine for testing, but too few for real users. Before you sell the app, set up a proper email sender (for example Resend, which has a free tier) and turn confirmation back on. I'll guide you when we get there.

## 4. Tell Supabase where your site lives
**Authentication** → **URL Configuration**:
- **Site URL:** your Hostinger address, e.g. `https://onetablecircle.com`. If you don't have one yet, use the temporary Hostinger address.
- **Redirect URLs** → **Add URL**, add both:
  - `https://<your-domain>/**`
  - `http://localhost:3000/**` (for testing on your computer)

## 5. Google sign-in (optional but recommended)
You can skip this and use email only. "Continue with Google" will just show an error until it's set up.

**a. Create Google credentials**
1. Go to <https://console.cloud.google.com> and sign in with your Google account.
2. Top bar → project picker → **New project** → name it `OneTableCircle` → **Create**, and make sure it's selected.
3. Menu → **APIs & Services** → **OAuth consent screen** (or **Google Auth Platform**) → **Get started**:
   - App name `OneTableCircle`, user support email = your email.
   - Audience: **External**.
   - Contact email = your email → **Create**.
4. **Clients** (or **Credentials**) → **Create client** / **Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Name: `OneTableCircle web`
   - **Authorized redirect URIs** → **Add URI**: `https://<your-project-ref>.supabase.co/auth/v1/callback`
     (Find this exact address in Supabase → **Authentication** → **Sign In / Providers** → **Google**, labelled "Callback URL". Copy it from there.)
   - **Create**. Copy the **Client ID** and **Client secret**.
5. While the app is in "Testing" mode, only Google accounts you add under **Audience → Test users** can sign in. Add yourself and anyone testing with you. Later, click **Publish app** to open it to everyone.

**b. Paste them into Supabase**
Supabase → **Authentication** → **Sign In / Providers** → **Google** → enable it, paste the **Client ID** and **Client secret** → **Save**.

## 6. Copy your two keys
In Supabase, click the **Connect** button at the top (or **Project Settings → API Keys**):
- **Project URL**, which looks like `https://abcdefgh.supabase.co`
- **Publishable key**, which starts with `sb_publishable_...`

Both are safe to use in a browser. Never share the **secret** key (`sb_secret_...`); the app doesn't need it yet.

## 7. Run it on your computer
1. In the project folder, create a file named **`.env.local`** containing:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://abcdefgh.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxx
   NEXT_PUBLIC_SITE_URL=http://localhost:3000
   ```
   Git ignores this file, so it's never uploaded.
2. In the VS Code terminal: `npm run dev`, then open <http://localhost:3000>.

## 8. Add the keys to Hostinger
hPanel → your website → **Environment variables** → add:

| Key | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | your Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | your publishable key |
| `NEXT_PUBLIC_SITE_URL` | `https://<your-domain>` (no trailing slash) |

Saving redeploys the site automatically.

---

## Phase 1 test checklist
Use two phones, or a phone and a laptop, with different accounts.

- [ ] Sign up with email on phone A. Sign in with Google on phone B.
- [ ] A: **Start a table** with a 15-minute cutoff.
- [ ] A: **People/Host** tab → **Share invite link** → send to B. B opens it and lands on the same table.
- [ ] Both add items. Try price blank vs. a price, quantity 3, a note, an item for the other person, and a **shared** item for both.
- [ ] Each phone's **Waiter** tab shows identical items grouped (e.g. two "Iced latte" with the same note show as "2×"). Changes appear on the other phone within about a second.
- [ ] Tick items on either phone: partial ticks on the 3× item (`1/3`, `2/3`), untick one, then tap the item to see who ticked it and when.
- [ ] **Still waiting** filter and the "x of y served" progress bar update.
- [ ] **Mine** shows only your own and shared items, with Waiting/Served.
- [ ] Host: **Close ordering now**. B can no longer add items, but can still tick. **Reopen ordering** works.
- [ ] Host: add "Lola" (no phone) and order an item for her.
- [ ] A third account that hasn't joined can't open the table link `/s/...` directly. It shows "doesn't exist, or you're not part of it".
