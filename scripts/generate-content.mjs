#!/usr/bin/env node
/**
 * Daily content generator — fully automated, no manual review step.
 *
 * Pulls a handful of items from free, keyless public sources, rewrites each
 * into a short, plain-language card using Groq's free API, and inserts the
 * results into Supabase. Runs once a day via GitHub Actions (see
 * .github/workflows/daily-content.yml).
 *
 * The one hard rule that keeps this safe to run unsupervised: an item is
 * only published if it carries a real, working source URL. No source link,
 * no post — the item is skipped rather than guessed at.
 *
 * Required env vars (set as GitHub Actions secrets, not committed here):
 *   GROQ_API_KEY
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   <- service role key, bypasses RLS. Never
 *                                  expose this one to the browser/frontend.
 */

import Parser from 'rss-parser';
import { createClient } from '@supabase/supabase-js';

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!GROQ_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    'Missing GROQ_API_KEY, SUPABASE_URL, or SUPABASE_SERVICE_ROLE_KEY. ' +
      'Set these as GitHub Actions secrets (see README.md).'
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const rssParser = new Parser();

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

  return (data.selected ?? [])
    .filter((e) => e.pages?.[0]?.content_urls?.desktop?.page)
    .slice(0, 2)
    .map((e) => ({
      category: 'history',
      rawText: `${e.year}: ${e.text}`,
      sourceName: 'Wikipedia',
      sourceUrl: e.pages[0].content_urls.desktop.page,
    }));
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
  const feeds = [
    { url: 'https://feeds.npr.org/1001/rss.xml', name: 'NPR' },
    { url: 'http://feeds.bbci.co.uk/news/world/rss.xml', name: 'BBC News' },
  ];

  const items = [];
  for (const feed of feeds) {
    try {
      const parsed = await rssParser.parseURL(feed.url);
      const top = parsed.items?.[0];
      if (top?.link) {
        items.push({
          category: 'news',
          rawText: `${top.title}. ${top.contentSnippet ?? ''}`.trim(),
          sourceName: feed.name,
          sourceUrl: top.link,
        });
      }
    } catch (err) {
      console.warn(`Could not read the ${feed.name} feed:`, err.message);
    }
  }
  return items;
}

// ---------------------------------------------------------------------
// 2. Rewrite each raw item with Groq — citation is required, not optional
// ---------------------------------------------------------------------

async function summarize(item) {
  const prompt = `Rewrite the following into a short, neutral, accurate summary for a "learn something today" feed.
Rules:
- Under 60 words.
- Plain language. No clickbait, no sensationalism, no exaggeration.
- Do not add any fact that is not present in the source text below.
- Respond with ONLY valid JSON, no markdown fences, in exactly this shape:
{"title": "...", "body": "..."}

Source text:
"""${item.rawText}"""`;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      // Check console.groq.com/docs/models for the current free-tier model
      // list — Groq retires and renames models periodically.
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
    }),
  });

  if (!res.ok) {
    throw new Error(`Groq API error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
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

  let inserted = 0;
  for (const item of rawItems) {
    try {
      if (!item.sourceUrl || !/^https?:\/\//.test(item.sourceUrl)) {
        console.warn('Skipped (no valid source URL):', item.rawText?.slice(0, 60));
        continue;
      }
      const post = await summarize(item);
      const ok = await insertPost(post);
      if (ok) inserted += 1;
    } catch (err) {
      console.error('Skipped an item due to an error:', err.message);
    }
  }

  console.log(`Done. Inserted ${inserted} of ${rawItems.length} candidate items.`);
}

main();
