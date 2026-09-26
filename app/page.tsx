'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import CategoryTabs, { Category } from '@/components/CategoryTabs';
import FeedCard, { Post } from '@/components/FeedCard';
import SkeletonCard from '@/components/SkeletonCard';
import EndOfFeed from '@/components/EndOfFeed';

const PAGE_SIZE = 12;

export default function Home() {
  const [category, setCategory] = useState<Category>('all');
  const [posts, setPosts] = useState<Post[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [minutesToday, setMinutesToday] = useState(0);

  const loadPage = useCallback(
    async (pageIndex: number, cat: Category, replace: boolean) => {
      setLoading(true);
      let query = supabase
        .from('posts')
        .select('*')
        .order('published_at', { ascending: false })
        .range(pageIndex * PAGE_SIZE, pageIndex * PAGE_SIZE + PAGE_SIZE - 1);

      if (cat !== 'all') {
        query = query.eq('category', cat);
      } else {
        // Keep the "spicy" category out of the main All feed — it's opt-in,
        // reached only via its own tab.
        query = query.neq('category', 'spicy');
      }

      const { data, error } = await query;
      if (!error && data) {
        setPosts((prev) => (replace ? (data as Post[]) : [...prev, ...(data as Post[])]));
        setHasMore(data.length === PAGE_SIZE);
      }
      setLoading(false);
    },
    []
  );

  useEffect(() => {
    setPage(0);
    loadPage(0, category, true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [category, loadPage]);

  // Gentle time-on-page counter, reset each day, stored only in the browser.
  // This is a wellbeing nudge, not a tracking/analytics feature.
  useEffect(() => {
    const todayKey = `fn-minutes-${new Date().toISOString().slice(0, 10)}`;
    const stored = Number(localStorage.getItem(todayKey) ?? 0);
    setMinutesToday(stored);
    const interval = setInterval(() => {
      setMinutesToday((m) => {
        const next = m + 1;
        localStorage.setItem(todayKey, String(next));
        return next;
      });
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <main className="min-h-screen max-w-xl mx-auto">
      <header className="sticky top-0 z-10 border-b border-line bg-paper/95 backdrop-blur">
        <div className="flex items-center justify-between px-4 pb-1 pt-5">
          <div className="flex items-center gap-2">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#2F6F4E"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 5.5C4 4.7 4.7 4 5.5 4H12v16H5.5A1.5 1.5 0 0 1 4 18.5v-13Z" />
              <path d="M20 5.5c0-.8-.7-1.5-1.5-1.5H12v16h6.5a1.5 1.5 0 0 0 1.5-1.5v-13Z" />
            </svg>
            <h1 className="font-serif text-2xl">Info Social</h1>
          </div>
          <span className="rounded-full border border-line bg-card px-2.5 py-1 text-xs text-muted">
            {minutesToday} min today
          </span>
        </div>
        <CategoryTabs active={category} onChange={setCategory} />
      </header>

      <div className="px-4 pt-4">
        {posts.length === 0 && loading
          ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
          : posts.map((post, i) => <FeedCard key={post.id} post={post} index={i} />)}

        {posts.length === 0 && !loading && (
          <p className="py-12 text-center text-sm text-muted">
            No posts yet — run the content generator to populate the feed.
          </p>
        )}

        {posts.length > 0 &&
          (hasMore ? (
            <button
              onClick={() => {
                const next = page + 1;
                setPage(next);
                loadPage(next, category, false);
              }}
              disabled={loading}
              className="mb-8 flex w-full items-center justify-center gap-1.5 rounded-full border border-line py-3 text-sm text-ink transition-all duration-200 hover:border-ink/30 hover:bg-card disabled:opacity-50"
            >
              {loading ? (
                'Loading…'
              ) : (
                <>
                  Load more
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </>
              )}
            </button>
          ) : (
            <EndOfFeed />
          ))}
      </div>
    </main>
  );
}
