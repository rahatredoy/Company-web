export default function Loading() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <div
        className="size-8 animate-spin rounded-full border-2 border-border border-t-primary"
        role="status"
        aria-label="Loading"
      />
    </div>
  );
}
