export default function EndOfFeed() {
  return (
    <div className="mt-4 border-t border-line py-12 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </div>
      <p className="font-serif text-lg mb-1">You&rsquo;re caught up.</p>
      <p className="text-sm text-muted">
        New facts and news are added once a day. Come back tomorrow.
      </p>
    </div>
  );
}
