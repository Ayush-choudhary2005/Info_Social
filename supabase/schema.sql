-- Run this once in the Supabase SQL editor for your project.

create extension if not exists pgcrypto;

create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  category text not null check (category in ('science', 'history', 'news')),
  source_name text not null,
  source_url text not null unique,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists posts_published_at_idx on posts (published_at desc);
create index if not exists posts_category_idx on posts (category);

-- Public (anon) visitors can only read. All writes happen from the daily
-- GitHub Action using the service role key, which bypasses RLS entirely,
-- so no insert/update/delete policy is defined here on purpose.
alter table posts enable row level security;

create policy "Public read access"
  on posts for select
  using (true);
