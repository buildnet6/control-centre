# Prof Newrock Control Centre

The master register for every Prof Newrock / BuildNET project: a Focus screen that nudges you on open, a dated roadmap, the combination map, dictated project updates and a weekly review that writes itself.

Runs free on GitHub Pages. Data lives in a private Supabase project behind your login. Voice updates are read by a free Gemini key stored only in your browser.

## Files

| File | What it does |
| --- | --- |
| `index.html` | The whole app |
| `cc-runtime.js` | Connects the app to Supabase (data, login, screenshots) and Gemini (voice updates) |
| `config.js` | Your Supabase project URL and publishable key |
| `supabase/schema.sql` | Creates the private table and screenshot storage. Run once |
| `manifest.webmanifest`, `icon*` | Lets you add it to your phone's home screen |

The code is public. Your project data is not: it sits in Supabase, and row-level security lets only the signed-in owner read or write it. Never commit your data backup file, your database password or your Gemini key.

## One-time setup

1. **Supabase.** In your Control Centre project: SQL Editor → New query → paste `supabase/schema.sql` → Run.
2. **Login URL.** Authentication → URL Configuration → set Site URL to `https://buildnet6.github.io/control-centre/` and add the same address under Redirect URLs.
3. **Open the app** and tap *Create my account*. Confirm the email if Supabase asks you to.
4. **Close sign-ups** so nobody else can register: Authentication → Sign In / Providers → Email → turn off *Allow new users to sign up*.
5. **Import your data.** On the empty Focus screen, tap *Import data file* and pick `control-centre-data-2026-10-05.json`.
6. **Voice AI.** Map → Voice update AI → paste your Gemini key → *Find my models* → *Save key*. Repeat on each device.

## Add to your phone

Open the site in Chrome (Android) or Safari (iPhone) → Share or menu → *Add to Home Screen*.

## Backups

Map → Account and data → *Download backup*. Keep the file somewhere private.

## Moving to your own domain later

Add a `CNAME` file containing the domain, point the domain's DNS at GitHub Pages, then update the Site URL and Redirect URLs in Supabase to the new address.
