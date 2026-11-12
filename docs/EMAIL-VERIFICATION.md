# Email verification (OTC-15)

New email + password sign-ups must click a link in their email before they can sign in.
Google sign-in and guests are not affected.

The app side is done (the "Check your email" screen, Resend button, and friendly
"please confirm your email first" on sign-in). These steps are in the Supabase dashboard.

## 1. Turn on "Confirm email"

Authentication → Sign In / Providers → **Email** → switch on **Confirm email** → Save.

## 2. Set up custom SMTP (needed before opening sign-ups)

Supabase's built-in email is for testing and only sends a few emails per hour.

1. Pick a sender service (e.g. Resend or Brevo, both have free tiers) and verify the
   `onetablecircle.com` domain there (it gives you DNS records to add in Hostinger → DNS).
2. Authentication → **Emails** → **SMTP Settings** → Enable custom SMTP:
   - Sender email: `no-reply@onetablecircle.com`
   - Sender name: `OneTableCircle`
   - Host, port, username, password: from the sender service.
3. Authentication → **Rate Limits**: raise "emails sent per hour" (e.g. 100).

## 3. Confirmation email template

Authentication → **Emails** → **Templates** → **Confirm signup**.

Subject: `Confirm your OneTableCircle account`

Body (the link format matters: it works even if the email is opened in a different
browser or inside the Gmail app):

```html
<h2>Welcome to OneTableCircle</h2>
<p>Tap the button to confirm your email and finish creating your account.</p>
<p>
  <a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email"
     style="display:inline-block;padding:12px 20px;background:#0f766e;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">
    Confirm my email
  </a>
</p>
<p style="color:#666;font-size:13px">If you didn't sign up for OneTableCircle, you can ignore this email.</p>
```

## 3b. Reset password email template

Used by "Forgot password" on the sign-in page (and linked from the "account restored" email).
Authentication → **Emails** → **Templates** → **Reset Password**.

Subject: `Set a new OneTableCircle password`

```html
<h2>Set a new password</h2>
<p>Tap the button to choose a new password for OneTableCircle.</p>
<p>
  <a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery"
     style="display:inline-block;padding:12px 20px;background:#0f766e;color:#fff;border-radius:10px;text-decoration:none;font-weight:600">
    Set a new password
  </a>
</p>
<p style="color:#666;font-size:13px">If you didn't ask for this, you can ignore this email. Your password stays the same.</p>
```

## 3c. App emails (account restored)

When an admin restores a removed user (Admin → Users → Restore user), the app emails them itself,
not through Supabase. Use the same sender service as above:

1. In Resend (or Brevo), create an API key that can send email.
2. In Hostinger → Environment variables, add `RESEND_API_KEY` (or `BREVO_API_KEY`). Optional: `EMAIL_FROM`.
3. Until a key is set, restores still work, but the admin sees "The email to let them know wasn't sent".

## 4. URL configuration

Authentication → **URL Configuration**:
- Site URL: `https://onetablecircle.com`
- Redirect URLs include: `https://onetablecircle.com/auth/callback`

## Check it

1. In a private window, create an account with a new email.
2. You should see "Check your email" with your address and a Resend button.
3. Try signing in before confirming: you should see "Please confirm your email first".
4. Tap the link in the email (try it from the Gmail app on your phone): you land signed in.
