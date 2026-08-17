import { useEffect, useRef } from 'react';

interface RetrievedSource {
  kind: 'chunk' | 'entity' | 'relationship';
  chunkId: string;
  documentId: string | null;
  filename: string;
  snippet: string;
  similarity: number;
}

interface CitationModalProps {
  open: boolean;
  onClose: () => void;
  sources: RetrievedSource[];
  focusIndex?: number;
  theme: 'light' | 'dark';
}

function relevanceBadge(similarity: number): { label: string; className: string } {
  const pct = Math.round(similarity * 100);
  if (similarity >= 0.7) {
    return {
      label: `${pct}% match`,
      className: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
    };
  }
  if (similarity >= 0.4) {
    return {
      label: `${pct}% match`,
      className: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
    };
  }
  return {
    label: `${pct}% match`,
    className: 'bg-gray-100 text-gray-500 dark:bg-neutral-800 dark:text-neutral-400',
  };
}

function KindIcon({ kind }: { kind: RetrievedSource['kind'] }) {
  if (kind === 'entity') {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3.5 w-3.5 shrink-0"
      >
        <circle cx="12" cy="12" r="8" />
      </svg>
    );
  }
  if (kind === 'relationship') {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3.5 w-3.5 shrink-0"
      >
        <path d="M5 12h14M13 6l6 6-6 6" />
      </svg>
    );
  }
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5 shrink-0"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

export function CitationModal({ open, onClose, sources, focusIndex, theme }: CitationModalProps) {
  const itemRefs = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => {
    if (open && focusIndex != null) {
      const el = itemRefs.current[focusIndex];
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [open, focusIndex]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
      style={{ colorScheme: theme }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl max-h-[75vh] flex flex-col rounded-2xl bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 shadow-xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-neutral-100">
            {sources.length} {sources.length === 1 ? 'source' : 'sources'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="h-7 w-7 flex items-center justify-center rounded-md text-gray-400 dark:text-neutral-500 hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors"
            aria-label="Close"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-2">
          {sources.map((source, i) => {
            const index = i + 1;
            const isFocused = focusIndex === index;
            const badge = relevanceBadge(source.similarity);
            return (
              <div
                key={source.chunkId}
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                className={`rounded-xl border px-3 py-2.5 transition-colors ${
                  isFocused
                    ? 'border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/20'
                    : 'border-gray-200 dark:border-neutral-800'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="h-4 w-4 shrink-0 flex items-center justify-center rounded-full bg-gray-200 dark:bg-neutral-700 text-[10px] font-medium text-gray-600 dark:text-neutral-300">
                    {index}
                  </span>
                  <span className="text-gray-400 dark:text-neutral-500">
                    <KindIcon kind={source.kind} />
                  </span>
                  <span className="text-sm text-gray-800 dark:text-neutral-200 truncate flex-1">
                    {source.filename}
                  </span>
                  {source.kind !== 'relationship' && (
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${badge.className}`}>
                      {badge.label}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 dark:text-neutral-400 leading-relaxed">
                  {source.snippet}
                  {source.snippet.length >= 240 ? '…' : ''}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}