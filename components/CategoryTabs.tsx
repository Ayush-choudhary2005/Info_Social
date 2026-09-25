'use client';

const CATEGORIES = ['all', 'science', 'history', 'news'] as const;
export type Category = (typeof CATEGORIES)[number];

export default function CategoryTabs({
  active,
  onChange,
}: {
  active: Category;
  onChange: (c: Category) => void;
}) {
  return (
    <div className="flex gap-6 border-b border-line px-4">
      {CATEGORIES.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={`pb-3 pt-4 text-sm capitalize transition-colors ${
            active === c
              ? 'border-b-2 border-accent text-ink font-medium'
              : 'text-muted hover:text-ink'
          }`}
        >
          {c === 'all' ? 'All' : c}
        </button>
      ))}
    </div>
  );
}
