# Info Social

Info Social is a short-form content feed built around a simple idea: the
scrolling, card-by-card format that makes apps like Instagram or TikTok hard
to put down doesn't have to be used for entertainment. It can just as easily
be used to deliver science facts, history, and news — short, sourced, and
free of the mechanics that make those other apps addictive.

## What it is

Each post in the feed is a short, plain-language write-up of a real event or
fact, always paired with a link back to where it came from. There is no
algorithmic "for you" ranking designed to maximize time spent in the app, no
autoplay from one card into the next, no streaks, and no infinite scroll.
The feed is organized into a small number of categories and shows a fixed
batch of posts at a time, with a deliberate tap required to see more.

The categories are:

- **Science** — drawn from astronomy and general science sources.
- **History** — notable historical events tied to the current date.
- **News** — current events across world, business, technology, and health.
- **Politics** — political developments, statements, and controversies from
  India and around the world, reported neutrally.
- **Unbelievable** — real but unusual or controversial stories, kept out of
  the main feed and reachable only through its own tab.

## How it works

The project has two halves that don't run at the same time or place.

**The website** is a Next.js application. It reads posts from a database
and displays them as a single-column feed with a category filter at the
top. It doesn't generate or fetch content itself — it only ever displays
whatever has already been written to the database. A small on-device timer
shows how many minutes have been spent in the app that day, as a gentle,
private nudge rather than a tracked metric.

**The content pipeline** runs separately and automatically, once a day, on
a schedule, with no manual step in between. Three independent scripts each
handle one part of the feed:

- one script gathers science, history, and general news items,
- one gathers political news,
- one gathers unusual or controversial stories for the Unbelievable tab.

Each script works the same way: it pulls fresh items from public sources
(encyclopedic APIs and news RSS feeds), sends the raw text to a language
model to be rewritten into a short, plain-language summary, and then saves
the result to the database — but only if the original item came with a
real, working source link. An item with no source is discarded rather than
published. Every rewritten post is instructed to stay strictly factual and
to avoid inventing or exaggerating anything beyond what the source said.
Items that have already been posted before are recognized and skipped, so
the same story doesn't appear twice.

Because all three scripts run independently on their own schedules and
their own API keys, one running into trouble doesn't stop the others.

## How it's built

- **Frontend:** Next.js and React, styled with Tailwind CSS.
- **Database:** Postgres, hosted on Supabase, with the website only ever
  given read access — all writing happens through the automated scripts.
- **Content rewriting:** a language model accessed through Groq's API.
- **Scheduling:** GitHub Actions runs each content script once a day.
- **Hosting:** the website is deployed on Vercel.

Every piece of this runs on a free tier of its respective service.
