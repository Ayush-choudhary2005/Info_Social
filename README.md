# Field Notes

A short-form feed of science, history and news facts — fully automated,
sourced, and built to be read for a few minutes rather than scrolled for
hours. No paid services required.

## What's in here

- `app/`, `components/`, `lib/` — the Next.js feed (deploy free on Vercel)
- `supabase/schema.sql` — the database schema (run once in Supabase)
- `scripts/generate-content.mjs` — the daily automation script
- `.github/workflows/daily-content.yml` — runs that script every day for
  free via GitHub Actions, with no manual step

## 1. Set up Supabase (free)

1. Create a project at [supabase.com](https://supabase.com).
2. Open the SQL editor and run everything in `supabase/schema.sql`.
3. Go to **Project Settings → API** and copy three values: the Project URL,
   the `anon` public key, and the `service_role` key (keep this one secret —
   it can write to your database).

## 2. Get a free Groq API key

1. Create an account at [console.groq.com](https://console.groq.com) — no
   card required.
2. Create an API key from the console.

## 3. Run the site locally

1. Copy `.env.example` to `.env.local` and fill in the two `NEXT_PUBLIC_`
   values from step 1.
2. `npm install`
3. `npm run dev` and open <http://localhost:3000>

The feed will say "No posts yet" until you've run the generator at least
once (see step 4) or added a test row manually in the Supabase table editor.

## 4. Automate content generation (free, no manual review)

1. Push this project to a GitHub repository.
2. In the repo's **Settings → Secrets and variables → Actions**, add three
   repository secrets:
   - `GROQ_API_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
3. That's it. `.github/workflows/daily-content.yml` runs the script every
   day at 06:00 UTC on its own. You can also open the repo's **Actions**
   tab and run it manually the first time to see it work immediately.

To test the script on your own machine first, set the same three variables
in your terminal and run `npm run generate-content`.

## 5. Deploy the site (free)

1. Import the GitHub repo into [Vercel](https://vercel.com).
2. Add the two `NEXT_PUBLIC_` env vars in the Vercel project settings.
3. Deploy. Vercel's free Hobby plan covers this comfortably, but note it's
   intended for personal/non-commercial projects — worth knowing if this
   ever becomes a commercial product.

## How the automation stays safe to run unsupervised

- **No source link, no post.** `generate-content.mjs` throws away any item
  that doesn't have a real, working source URL before it ever reaches
  Groq. This is the main guardrail against low-quality or fabricated
  content going out with nobody checking it.
- **Duplicates are rejected automatically** by a unique constraint on
  `source_url` in the database.
- **The model is told not to invent facts** beyond what's in the source
  text, and to skip sensationalism — but no model is perfect, so it's
  worth spot-checking the feed occasionally even though nothing requires
  you to.

## Things that change over time — check before you rely on them

- Groq's free-tier model list changes; if the script starts failing with a
  model error, check console.groq.com/docs/models and update the `model`
  field in `generate-content.mjs`.
- Free-tier limits for Groq, Supabase, and Vercel are generous enough for a
  feed publishing a handful of items a day, but confirm current numbers on
  each provider's site since they're revised periodically.
