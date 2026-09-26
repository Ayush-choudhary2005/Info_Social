'use client';

import { CATEGORY_META, CategoryKey } from '@/lib/categories';

const CATEGORIES = ['all', 'science', 'history', 'news', 'politics', 'spicy'] as const;
export type Category = (typeof CATEGORIES)[number];

const ICON_PROPS = {
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function TabIcon({ category }: { category: Category }) {
  switch (category) {
    case 'science':
      return (
        <svg {...ICON_PROPS}>
          <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3" />
        </svg>
      );
    case 'history':
      return (
        <svg {...ICON_PROPS}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v4l3 2" />
        </svg>
      );
    case 'news':
      return (
        <svg {...ICON_PROPS}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.2 2.5 2.2 15.5 0 18M12 3c-2.2 2.5-2.2 15.5 0 18" />
        </svg>
      );
    case 'politics':
      return (
        <svg {...ICON_PROPS}>
          <path d="M4 21V10l8-5 8 5v11M6 21v-6M18 21v-6M3 21h18" />
        </svg>
      );
    case 'spicy':
      return (
        <svg {...ICON_PROPS}>
          <path d="M12 2c2 3-1 4-1 6 0 1.2 1 2 2 2 1.5 0 2-1.3 2-2 2 2 3 5 3 7a6 6 0 1 1-12 0c0-4 3-7 6-13Z" />
        </svg>
      );
    default:
      return null;
  }
}

export default function CategoryTabs({
  active,
  onChange,
}: {
  active: Category;
  onChange: (c: Category) => void;
}) {
  return (
    <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-3 pt-1">
      {CATEGORIES.map((c) => {
        const meta = c === 'all' ? null : CATEGORY_META[c as CategoryKey];
        const isActive = active === c;
        return (
          <button
            key={c}
            onClick={() => onChange(c)}
            className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-medium transition-all duration-200"
            style={
              isActive
                ? {
                    backgroundColor: meta ? meta.color : '#1E2A22',
                    borderColor: meta ? meta.color : '#1E2A22',
                    color: '#FFFFFF',
                  }
                : { backgroundColor: 'transparent', borderColor: '#DDD9CC', color: '#6B7268' }
            }
          >
            <TabIcon category={c} />
            {c === 'all' ? 'All' : meta!.label}
          </button>
        );
      })}
    </div>
  );
}
