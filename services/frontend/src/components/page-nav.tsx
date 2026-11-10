/**
 * Prev / Next for a list paged in client state. `loading` holds both buttons
 * while the next page is still placeholder data, so a second click never skips
 * a page the reader has not seen.
 */
export function PageNav({
  label,
  status,
  hasPrev,
  hasNext,
  loading,
  onPrev,
  onNext,
}: {
  /** Names the nav for screen readers, e.g. "Recent calls pages". */
  label: string;
  /** "Page 2", or "Page 2 of 5" when the total is known. */
  status: string;
  hasPrev: boolean;
  hasNext: boolean;
  loading: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <nav aria-label={label} className="mt-3 flex items-center justify-between text-sm">
      <button type="button" className="btn-ghost" disabled={!hasPrev || loading} onClick={onPrev}>
        ← Prev
      </button>
      <span className="text-ink-2 tabular" aria-live="polite">
        {status}
      </span>
      <button type="button" className="btn-ghost" disabled={!hasNext || loading} onClick={onNext}>
        Next →
      </button>
    </nav>
  );
}
