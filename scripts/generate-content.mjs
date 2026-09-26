#!/usr/bin/env node
/**
 * Daily content generator — fully automated, no manual review step.
 *
 * Pulls fresh items from free, keyless public sources, rewrites each into a
 * short-but-substantive card using Groq's free API, and inserts the results
 * into Supabase. Runs once a day via GitHub Actions (see
 * .github/workflows/daily-content.yml).
 *
 * The one hard rule that keeps this safe to run unsupervised: an item is
 * only published if it carries a real, working source URL. No source link,
 * no post — the item is skipped rather than guessed at.
 *
 * Required env vars (set as GitHub Actions secrets, not committed here):
 *   GROQ_API_KEY
 *   GROQ_API_KEY_2               <- optional second Groq key/account. If set,
 *                                    calls are spread across both keys (and
 *                                    both models) to reduce per-minute rate
 *                                    and token limit errors.
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   <- service role key, bypasses RLS. Never
 *                                  expose this one to the browser/frontend.
 */

import Parser from 'rss-parser';
import { createClient } from '@supabase/supabase-js';

const GROQ_API_KEYS = [process.env.GROQ_API_KEY, process.env.GROQ_API_KEY_2].filter(Boolean);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (GROQ_API_KEYS.length === 0 || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    'Missing GROQ_API_KEY (and optionally GROQ_API_KEY_2), SUPABASE_URL, or ' +
      'SUPABASE_SERVICE_ROLE_KEY. Set these as GitHub Actions secrets (see README.md).'
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const rssParser = new Parser();

// ---------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------

// Only treat news items published within this window as "today's news".
const FRESHNESS_HOURS = 48;

// Wikipedia's "on this day" list only has so many entries — this is a cap,
// not a target.
const HISTORY_ITEMS_PER_DAY = 8;

// Two free-tier models, used in rotation. Groq's free plan gives each model
// its own separate rate limit and daily token budget.
const MODELS = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'];

// Every (API key × model) pair is its own independent quota "lane" on Groq's
// free plan. With 2 keys and 2 models that's 4 lanes instead of 2, which is
// what actually fixes "tokens exhausted" errors — each lane gets its own
// separate per-minute token budget.
const LANES = GROQ_API_KEYS.flatMap((key, keyIndex) =>
  MODELS.map((model) => ({ key, model, keyIndex }))
);

// Minimum gap between calls made on the *same* lane. Groq's free plan caps
// each model around 8,000 tokens/minute, which is a tighter limit than the
// ~30 requests/minute cap — a request every 2s can still blow past the token
// cap well before it blows past the request-count cap. At an estimated
// ~650 tokens per call, 6,500ms keeps each lane comfortably under 8,000 TPM.
const MIN_GAP_MS = 6500;

// How many times to retry a single call after a 429 (rate limited) response
// before giving up on that item. Groq's error message includes how long to
// wait, and this respects that instead of guessing.
const MAX_RETRIES = 4;

// Upper bound on how many items get sent to Groq in one run. With 4 lanes,
// the combined daily token budget is roughly 4x a single model's, so 500
// items/day fits comfortably — but actual daily output also depends on how
// many genuinely fresh items the feeds below produce that day. Add more
// feeds to NEWS_FEEDS if you're consistently coming in under this number.
const MAX_ITEMS_PER_RUN = 500;

// Verified, keyless RSS feeds. Add more standard RSS 2.0 feeds here to raise
// daily volume — each entry just needs a url, a display name, and a category.
const NEWS_FEEDS = [
  { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', name: 'BBC News', category: 'news' },
  { url: 'https://feeds.bbci.co.uk/news/business/rss.xml', name: 'BBC News', category: 'news' },
  { url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', name: 'BBC News', category: 'news' },
  { url: 'https://feeds.bbci.co.uk/news/health/rss.xml', name: 'BBC News', category: 'news' },
  { url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml', name: 'BBC News', category: 'science' },
  { url: 'https://feeds.npr.org/1001/rss.xml', name: 'NPR', category: 'news' },     // Top News
  { url: 'https://feeds.npr.org/1003/rss.xml', name: 'NPR', category: 'news' },     // National
  { url: 'https://feeds.npr.org/1004/rss.xml', name: 'NPR', category: 'news' },     // World
  { url: 'https://feeds.npr.org/1019/rss.xml', name: 'NPR', category: 'news' },     // Technology
  { url: 'https://feeds.npr.org/1007/rss.xml', name: 'NPR', category: 'science' },  // Science & Health
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------
// Best-effort full-article text fetch, so the model has more than a
// one-line RSS blurb to work with. Falls back gracefully — many sites
// block scrapers or sit behind paywalls, and that's fine.
// ---------------------------------------------------------------------

async function fetchArticleText(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FieldNotesBot/1.0)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|&amp;|&quot;|&#39;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.length > 200 ? text.slice(0, 2000) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// 1. Gather raw items from free, keyless sources
// ---------------------------------------------------------------------

async function getHistoryItems() {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');

  const res = await fetch(
    `https://en.wikipedia.org/api/rest_v1/feed/onthisday/selected/${mm}/${dd}`
  );
  if (!res.ok) {
    console.warn('Wikipedia On This Day request failed:', res.status);
    return [];
  }
  const data = await res.json();

  const events = (data.selected ?? [])
    .filter((e) => e.pages?.[0]?.content_urls?.desktop?.page)
    .slice(0, HISTORY_ITEMS_PER_DAY);

  const items = [];
  for (const e of events) {
    const page = e.pages[0];
    const sourceUrl = page.content_urls.desktop.page;

    // Pull the full Wikipedia summary paragraph instead of the single-line
    // "on this day" blurb, so there's real substance for the model to draw on.
    let extract = e.text;
    try {
      const summaryRes = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(page.title)}`
      );
      if (summaryRes.ok) {
        const summary = await summaryRes.json();
        if (summary.extract) extract = summary.extract;
      }
    } catch {
      // Fall back to the short blurb if the summary lookup fails.
    }

    items.push({
      category: 'history',
      rawText: `${e.year}: ${e.text} — ${extract}`,
      sourceName: 'Wikipedia',
      sourceUrl,
    });
  }
  return items;
}

async function getScienceItem() {
  // DEMO_KEY works without signup but is rate-limited (fine for one call/day).
  // Get a free personal key at api.nasa.gov if you want more headroom.
  const res = await fetch('https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY');
  if (!res.ok) {
    console.warn('NASA APOD request failed:', res.status);
    return [];
  }
  const data = await res.json();
  const ymd = data.date?.replaceAll('-', '').slice(2); // -> YYMMDD

  return [
    {
      category: 'science',
      rawText: `${data.title}: ${data.explanation}`,
      sourceName: 'NASA APOD',
      sourceUrl: ymd ? `https://apod.nasa.gov/apod/ap${ymd}.html` : 'https://apod.nasa.gov/',
    },
  ];
}

async function getNewsItems() {
  const cutoff = Date.now() - FRESHNESS_HOURS * 60 * 60 * 1000;
  const items = [];

  for (const feed of NEWS_FEEDS) {
    try {
      const parsed = await rssParser.parseURL(feed.url);
      for (const entry of parsed.items ?? []) {
        if (!entry.link) continue;

        const published = entry.isoDate ? new Date(entry.isoDate).getTime() : Date.now();
        if (Number.isFinite(published) && published < cutoff) continue;

        const articleText = await fetchArticleText(entry.link);
        const rawText = articleText
          ? `${entry.title}. ${articleText}`
          : `${entry.title}. ${entry.contentSnippet ?? ''}`.trim();

        items.push({
          category: feed.category,
          rawText,
          sourceName: feed.name,
          sourceUrl: entry.link,
        });
      }
    } catch (err) {
      console.warn(`Could not read the ${feed.name} feed (${feed.url}):`, err.message);
    }
  }
  return items;
}

// ---------------------------------------------------------------------
// 2. Rewrite each raw item with Groq — citation is required, not optional
// ---------------------------------------------------------------------

const lastCallAt = new Map();

async function callGroq(lane, prompt, attempt = 1) {
  const throttleKey = `${lane.keyIndex}:${lane.model}`;
  const last = lastCallAt.get(throttleKey) ?? 0;
  const wait = MIN_GAP_MS - (Date.now() - last);
  if (wait > 0) await sleep(wait);
  lastCallAt.set(throttleKey, Date.now());

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${lane.key}`,
    },
    body: JSON.stringify({
      model: lane.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
    }),
  });

  if (res.ok) return res.json();

  const bodyText = await res.text();

  if (res.status === 429 && attempt <= MAX_RETRIES) {
    const headerWait = Number(res.headers.get('retry-after'));
    const match = bodyText.match(/try again in ([\d.]+)s/i);
    const waitSeconds =
      Number.isFinite(headerWait) && headerWait > 0 ? headerWait : match ? Number(match[1]) : 5;
    console.warn(
      `Rate limited on lane ${throttleKey} (attempt ${attempt}/${MAX_RETRIES}), waiting ${waitSeconds}s...`
    );
    await sleep(waitSeconds * 1000 + 250);
    return callGroq(lane, prompt, attempt + 1);
  }

  throw new Error(`Groq API error ${res.status} (${lane.model}): ${bodyText}`);
}

async function summarize(item, lane) {
  const prompt = `Rewrite the following into a short, neutral, accurate summary for a "learn something today" feed.
Rules:
- 80-130 words in the body.
- Plain language. No clickbait, no sensationalism, no exaggeration.
- Include real context or why it matters, not just the headline restated in other words.
- Do not add any fact that is not present in the source text below.
- Respond with ONLY valid JSON, no markdown fences, in exactly this shape:
{"title": "...", "body": "..."}

Source text:
"""${item.rawText.slice(0, 1600)}"""`;

  const data = await callGroq(lane, prompt);
  const raw = data.choices?.[0]?.message?.content ?? '';
  const cleaned = raw.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(cleaned);

  if (!parsed.title || !parsed.body) {
    throw new Error('Model response was missing a title or body');
  }

  return {
    title: parsed.title,
    body: parsed.body,
    category: item.category,
    source_name: item.sourceName,
    source_url: item.sourceUrl,
  };
}

// ---------------------------------------------------------------------
// 3. Insert into Supabase — duplicates are rejected by a unique constraint
// ---------------------------------------------------------------------

async function insertPost(post) {
  const { error } = await supabase.from('posts').insert(post);
  if (error) {
    if (error.code === '23505') {
      console.log(`Already posted, skipped: ${post.source_url}`);
    } else {
      console.error(`Insert failed for ${post.source_url}:`, error.message);
    }
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------
// 4. Run
// ---------------------------------------------------------------------

async function main() {
  const rawItems = [
    ...(await getHistoryItems()),
    ...(await getScienceItem()),
    ...(await getNewsItems()),
  ];

  console.log(`Found ${rawItems.length} candidate items (processing up to ${MAX_ITEMS_PER_RUN}).`);

  const toProcess = rawItems.slice(0, MAX_ITEMS_PER_RUN);

  let inserted = 0;
  let laneIndex = 0;
  for (const item of toProcess) {
    try {
      if (!item.sourceUrl || !/^https?:\/\//.test(item.sourceUrl)) {
        console.warn('Skipped (no valid source URL):', item.rawText?.slice(0, 60));
        continue;
      }
      const lane = LANES[laneIndex % LANES.length];
      laneIndex += 1;

      const post = await summarize(item, lane);
      const ok = await insertPost(post);
      if (ok) inserted += 1;
    } catch (err) {
      console.error('Skipped an item due to an error:', err.message);
    }
  }

  console.log(
    `Done. Inserted ${inserted} of ${toProcess.length} processed items (${rawItems.length} candidates found).`
  );
}

main();
