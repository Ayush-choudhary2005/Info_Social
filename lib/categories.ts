export type CategoryKey = 'science' | 'history' | 'news' | 'politics' | 'spicy';

export const CATEGORY_META: Record<CategoryKey, { label: string; color: string; bg: string }> = {
  science: { label: 'Science', color: '#2F6F4E', bg: '#E7EFE9' },
  history: { label: 'History', color: '#A8672B', bg: '#F2E9DE' },
  news: { label: 'News', color: '#2B5FA8', bg: '#E4EBF4' },
  politics: { label: 'Politics', color: '#A8324A', bg: '#F4E3E8' },
  spicy: { label: 'Unbelievable', color: '#C2410C', bg: '#FBE7DC' },
};
