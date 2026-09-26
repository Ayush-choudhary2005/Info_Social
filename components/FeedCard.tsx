export type Post = {
  id: string;
  title: string;
  body: string;
  category: string;
  source_name: string;
  source_url: string;
  published_at: string;
};

const CATEGORY_LABEL: Record<string, string> = {
  science: 'Science',
  history: 'History',
  news: 'News',
  politics: 'Politics',
};

export default function FeedCard({ post }: { post: Post }) {
  const date = new Date(post.published_at).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });

  return (
    <article className="border border-line bg-card rounded-sm p-6 mb-4">
      <div className="flex items-center justify-between mb-3 text-xs text-ochre">
        <span>{CATEGORY_LABEL[post.category] ?? post.category}</span>
        <span className="text-muted">{date}</span>
      </div>
      <h2 className="font-serif text-xl leading-snug mb-2">{post.title}</h2>
      <p className="text-[15px] leading-relaxed text-ink/90 mb-4">{post.body}</p>
      <a
        href={post.source_url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-accent hover:underline"
      >
        Source: {post.source_name} ↗
      </a>
    </article>
  );
}
