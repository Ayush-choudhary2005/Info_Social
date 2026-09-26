import { CATEGORY_META, CategoryKey } from '@/lib/categories';

export type Post = {
  id: string;
  title: string;
  body: string;
  category: string;
  source_name: string;
  source_url: string;
  published_at: string;
};

export default function FeedCard({ post, index = 0 }: { post: Post; index?: number }) {
  const meta = CATEGORY_META[post.category as CategoryKey] ?? {
    label: post.category,
    color: '#2F6F4E',
    bg: '#E7EFE9',
  };
  const date = new Date(post.published_at).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });

  return (
    <article
      className="group mb-4 animate-fade-in-up rounded-md border border-line border-l-4 bg-card p-6 opacity-0 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
      style={{
        borderLeftColor: meta.color,
        animationDelay: `${Math.min(index, 8) * 60}ms`,
      }}
    >
      <div className="mb-3 flex items-center justify-between">
        <span
          className="rounded-full px-2.5 py-0.5 text-xs font-medium"
          style={{ backgroundColor: meta.bg, color: meta.color }}
        >
          {meta.label}
        </span>
        <span className="text-xs text-muted">{date}</span>
      </div>
      <h2 className="mb-2 font-serif text-xl leading-snug transition-colors group-hover:text-accent">
        {post.title}
      </h2>
      <p className="mb-4 text-[15px] leading-relaxed text-ink/90">{post.body}</p>
      <a
        href={post.source_url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
      >
        Source: {post.source_name}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M7 17 17 7M7 7h10v10" />
        </svg>
      </a>
    </article>
  );
}
