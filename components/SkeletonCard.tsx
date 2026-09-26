export default function SkeletonCard() {
  return (
    <div className="mb-4 animate-pulse rounded-md border border-line border-l-4 border-l-line bg-card p-6">
      <div className="mb-4 flex justify-between">
        <div className="h-4 w-16 rounded-full bg-line/60" />
        <div className="h-3 w-10 rounded bg-line/60" />
      </div>
      <div className="mb-3 h-5 w-3/4 rounded bg-line/60" />
      <div className="mb-2 h-3 w-full rounded bg-line/50" />
      <div className="mb-2 h-3 w-11/12 rounded bg-line/50" />
      <div className="h-3 w-2/3 rounded bg-line/50" />
    </div>
  );
}
