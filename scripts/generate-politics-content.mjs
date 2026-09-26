#!/usr/bin/env node
/**
 * Politics & current-affairs content generator — separate script, separate
 * Groq API key(s)/quota from the main generate-content.mjs, same Supabase
 * database and 'posts' table (just a different category value).
 *
 * Pulls real political news — conflict, controversy, protests, elections,
 * sharp public statements — and rewrites each factually and neutrally.
 * This does NOT try to sensationalize violence or exaggerate quotes: real
 * political drama is interesting on its own without embellishment, and
 * putting words in a real politician's mouth (or treating real violence as
 * entertainment) isn't something this script does.
 *
 * Required env vars:
 *   GROQ_API_KEY_POLITICS         <- a Groq key/account separate from the
 *                                    main script's, so it has its own quota
 *   GROQ_API_KEY_POLITICS_2       <- optional second key. If set, calls are
 *                                    spread across both keys (and both
 *                                    models) to reduce rate/token limit hits.
 *   SUPABASE_URL                  <- same Supabase project as the main script
 *   SUPABASE_SERVICE_ROLE_KEY     <- same service role key as the main script
 *
 * IMPORTANT one-time setup: the 'posts' table's category CHECK constraint
 * currently only allows ('science', 'history', 'news'). Run this once in
 * the Supabase SQL editor before this script will be able to insert
 * anything, or every insert will fail with a check-constraint error:
 *
 *   alter table posts drop constraint if exists posts_category_check;
 *   alter table posts add constraint posts_category_check
 *     check (category in ('science', 'history', 'news', 'politics'));
 */

import Parser from 'rss-parser';
import { createClient } from '@supabase/supabase-js';

const GROQ_API_KEYS = [process.env.GROQ_API_KEY_POLITICS, process.env.GROQ_API_KEY_POLITICS_2].filter(
  Boolean
);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (GROQ_API_KEYS.length === 0 || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    'Missing GROQ_API_KEY_POLITICS (and optionally GROQ_API_KEY_POLITICS_2), SUPABASE_URL, or ' +
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

// Every (API key × model) pair is its own independent quota lane on Groq's
// free plan. With 2 keys and 2 models that's 4 lanes instead of 2.
const LANES = GROQ_API_KEYS.flatMap((key, keyIndex) =>
  MODELS.map((model) => ({ key, model, keyIndex }))
);

// Groq's free plan caps each model around 8,000 tokens/minute, a tighter
// limit than the ~30 requests/minute cap. At an estimated ~650 tokens per
// call, 6,500ms per lane keeps comfortably under that.
const MIN_GAP_MS = 6500;

// Retries a rate-limited (429) call, respecting Groq's own wait-time hint,
// instead of dropping the item immediately.
const MAX_RETRIES = 4;

// Verified, keyless RSS feeds covering global and Indian political news.
// A few commonly-cited Indian-outlet feed URLs (NDTV, The Hindu, TOI's
// India-specific section) couldn't be confirmed working from here — if you
// have one you've tested in a browser, add it here in the same shape.
const POLITICS_FEEDS = [
  { url: 'https://feeds.bbci.co.uk/news/politics/rss.xml', name: 'BBC News' },
  { url: 'https://feeds.bbci.co.uk/news/world/asia/rss.xml', name: 'BBC News' },
  { url: 'https://timesofindia.indiatimes.com/rssfeeds/296589292.cms', name: 'Times of India' },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------
// Best-effort full-article text fetch — same approach as the main script.
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

async function getPoliticsItems() {
  const cutoff = Date.now() - FRESHNESS_HOURS * 60 * 60 * 1000;
  const items = [];

  for (const feed of POLITICS_FEEDS) {
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
// 2. Rewrite each item with Groq — neutral and factual, not sensationalized
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
  const prompt = `Rewrite the following into a short, factual summary of a political news story, for a current-affairs feed.
Rules:
- 80-130 words.
- Neutral tone: report what happened and who said or did what, without taking a side, editorializing, or exaggerating.
- If a quote is central to the story, paraphrase it rather than reproducing long exact wording; a very short (under 10 words) direct quote in quotation marks is acceptable if it's truly central.
- Do not add any fact, claim, or quote that is not present in the source text below. Do not invent or intensify anything to make it sound more dramatic.
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
    category: 'politics',
    source_name: item.sourceName,
    source_url: item.sourceUrl,
  };
}

// ---------------------------------------------------------------------
// 3. Insert into Supabase — duplicates rejected by the existing unique
//    constraint on source_url (shared with the main script's table)
// ---------------------------------------------------------------------

async function insertPost(post) {
  const { error } = await supabase.from('posts').insert(post);
  if (error) {
    if (error.code === '23505') {
      console.log(`Already posted, skipped: ${post.source_url}`);
    } else if (error.code === '23514') {
      console.error(
        `Insert failed (check constraint) for ${post.source_url}. ` +
          `Did you run the ALTER TABLE at the top of this file to allow 'politics' as a category?`
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
  const rawItems = await getPoliticsItems();
  console.log(`Found ${rawItems.length} candidate political items.`);

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
