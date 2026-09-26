'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import CategoryTabs, { Category } from '@/components/CategoryTabs';
import FeedCard, { Post } from '@/components/FeedCard';
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

      if (cat !== 'all') query = query.eq('category', cat);

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
    <main className="max-w-xl mx-auto min-h-screen">
      <header className="sticky top-0 bg-paper/95 backdrop-blur border-b border-line z-10">
        <div className="flex items-center justify-between px-4 pt-5">
          <h1 className="font-serif text-2xl">Info Social</h1>
          <span className="text-xs text-muted">{minutesToday} min today</span>
        </div>
        <CategoryTabs active={category} onChange={setCategory} />
      </header>

      <div className="px-4 pt-4">
        {posts.map((post) => (
          <FeedCard key={post.id} post={post} />
        ))}

        {posts.length === 0 && !loading && (
          <p className="text-sm text-muted py-12 text-center">
            No posts yet — run the content generator to populate the feed.
          </p>
        )}

        {hasMore ? (
          <button
            onClick={() => {
              const next = page + 1;
              setPage(next);
              loadPage(next, category, false);
            }}
            disabled={loading}
            className="w-full py-3 mb-8 border border-line rounded-sm text-sm text-ink hover:bg-card transition-colors disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        ) : (
          posts.length > 0 && <EndOfFeed />
        )}
      </div>
    </main>
  );
}
