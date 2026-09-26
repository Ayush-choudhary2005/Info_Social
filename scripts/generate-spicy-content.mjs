#!/usr/bin/env node
/**
 * "Spicy" content generator — controversial, unusual, and surprising real
 * news, kept out of the main feed and reachable only via its own tab.
 * Separate script, separate Groq key(s)/quota, same Supabase database and
 * 'posts' table (just a different category value).
 *
 * Sources are chosen to surface controversy and genuinely bizarre-but-true
 * stories rather than mainstream front-page news:
 *   - Google News RSS search, scoped to controversy-related terms
 *   - r/nottheonion (real news stories that read like satire, but aren't)
 *   - The Indian Express opinion/columns section
 *
 * The same hard rules as the other scripts still apply: no source link, no
 * post, and the model is told to stay strictly factual — dramatic framing
 * is fine, invented details or exaggeration are not.
 *
 * Required env vars:
 *   GROQ_API_KEY_SPICY            <- a Groq key/account separate from the
 *                                    other scripts', so it has its own quota
 *   GROQ_API_KEY_SPICY_2          <- optional second key, same reasoning as
 *                                    the other two scripts
 *   SUPABASE_URL                  <- same Supabase project as the other scripts
 *   SUPABASE_SERVICE_ROLE_KEY     <- same service role key as the other scripts
 *
 * IMPORTANT one-time setup: run this in the Supabase SQL editor first, or
 * every insert will fail with a check-constraint error:
 *
 *   alter table posts drop constraint if exists posts_category_check;
 *   alter table posts add constraint posts_category_check
 *     check (category in ('science', 'history', 'news', 'politics', 'spicy'));
 */

import Parser from 'rss-parser';
import { createClient } from '@supabase/supabase-js';

const GROQ_API_KEYS = [process.env.GROQ_API_KEY_SPICY, process.env.GROQ_API_KEY_SPICY_2].filter(
  Boolean
);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (GROQ_API_KEYS.length === 0 || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    'Missing GROQ_API_KEY_SPICY (and optionally GROQ_API_KEY_SPICY_2), SUPABASE_URL, or ' +
      'SUPABASE_SERVICE_ROLE_KEY. Set these as GitHub Actions secrets.'
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const rssParser = new Parser();

// ---------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------

const FRESHNESS_HOURS = 48;
const MODELS = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'];

const LANES = GROQ_API_KEYS.flatMap((key, keyIndex) =>
  MODELS.map((model) => ({ key, model, keyIndex }))
);

const MIN_GAP_MS = 6500; // TPM-aware pacing per lane — see the other scripts for the math
const MAX_RETRIES = 4;

// Not fully verified end-to-end — Google News links redirect through
// news.google.com, and Reddit's RSS link is the discussion permalink rather
// than the original article, but both are real, clickable, citable URLs.
// Swap or add feeds freely; every fetch below already degrades gracefully
// if a feed is unreachable or empty.
const SPICY_FEEDS = [
  {
    url: 'https://news.google.com/rss/search?q=scandal+OR+controversy+politics+India&hl=en-IN&gl=IN&ceid=IN:en',
    name: 'Google News (India)',
  },
  {
    url: 'https://news.google.com/rss/search?q=diplomatic+row+OR+scandal+president+OR+prime+minister&hl=en-US&gl=US&ceid=US:en',
    name: 'Google News (Global)',
  },
  {
    url: 'https://www.reddit.com/r/nottheonion/top/.rss?t=day',
    name: 'Reddit (r/nottheonion)',
  },
  {
    url: 'https://indianexpress.com/section/opinion/columns/feed/',
    name: 'The Indian Express',
  },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------
// Best-effort full-article text fetch — same approach as the other scripts.
// Reddit/Google News links won't always resolve to clean article text; the
// length check below just falls back to the RSS snippet when that happens.
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
// 1. Gather raw items
// ---------------------------------------------------------------------

async function getSpicyItems() {
  const cutoff = Date.now() - FRESHNESS_HOURS * 60 * 60 * 1000;
  const items = [];

  for (const feed of SPICY_FEEDS) {
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
// 2. Rewrite each item with Groq — dramatic framing is fine, invented or
//    exaggerated facts are not
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
  const prompt = `Rewrite the following into a short summary of a controversial, unusual, or surprising real news story, for a "you won't believe this happened" feed.
Rules:
- 80-130 words.
- You can highlight what makes the story controversial, unusual, or surprising, but stay strictly factual — base everything only on the source text below.
- Do not invent details, dialogue, or outcomes, and do not exaggerate beyond what the source actually says.
- If quoting someone, paraphrase rather than reproducing long exact wording; a very short (under 10 words) direct quote is fine if it's central to the story.
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
    category: 'spicy',
    source_name: item.sourceName,
    source_url: item.sourceUrl,
  };
}

// ---------------------------------------------------------------------
// 3. Insert into Supabase — duplicates rejected by the existing unique
//    constraint on source_url (shared with the other scripts' table)
// ---------------------------------------------------------------------

async function insertPost(post) {
  const { error } = await supabase.from('posts').insert(post);
  if (error) {
    if (error.code === '23505') {
      console.log(`Already posted, skipped: ${post.source_url}`);
    } else if (error.code === '23514') {
      console.error(
        `Insert failed (check constraint) for ${post.source_url}. ` +
          `Did you run the ALTER TABLE at the top of this file to allow 'spicy' as a category?`
      );
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
  const rawItems = await getSpicyItems();
  console.log(`Found ${rawItems.length} candidate spicy items.`);

  let inserted = 0;
  let laneIndex = 0;
  for (const item of rawItems) {
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

  console.log(`Done. Inserted ${inserted} of ${rawItems.length} candidate items.`);
}

main();
