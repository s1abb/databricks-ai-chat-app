import { useMemo, useRef, useState } from 'react';

interface RagDocument {
  id: string;
  filename: string;
  status: 'pending' | 'processing' | 'indexed' | 'failed';
  error_message: string | null;
  chunk_count: number;
  uploaded_at: string;
}

interface DocumentsPanelProps {
  open: boolean;
  onClose: () => void;
  documents: RagDocument[];
  onUpload: (file: File) => void;
  onDelete: (id: string) => void;
  theme: 'light' | 'dark';
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function StatusBadge({ status }: { status: RagDocument['status'] }) {
  const styles: Record<RagDocument['status'], string> = {
    pending: 'bg-gray-100 text-gray-500 dark:bg-neutral-800 dark:text-neutral-400',
    processing: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
    indexed: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
    failed: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  };
  return (
    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${styles[status]}`}>
      {status}
    </span>
  );
}

function DocumentIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

export function DocumentsPanel({
  open,
  onClose,
  documents,
  onUpload,
  onDelete,
  theme,
}: DocumentsPanelProps) {
  const [search, setSearch] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return documents;
    return documents.filter((d) => d.filename.toLowerCase().includes(q));
  }, [documents, search]);

  if (!open) return null;

  function handleFiles(fileList: FileList | null) {
    const file = fileList?.[0];
    if (file) onUpload(file);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-2xl bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 shadow-xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-neutral-100">Documents</h2>
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

        <div className="px-5 pt-4">
          <div className="relative">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 dark:text-neutral-500"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search documents..."
              style={{ colorScheme: theme }}
              className="w-full text-sm rounded-lg border border-gray-200 dark:border-neutral-700 bg-gray-50 dark:bg-neutral-800 text-gray-900 dark:text-neutral-100 placeholder:text-gray-400 dark:placeholder:text-neutral-500 pl-9 pr-3 py-2 outline-none focus:border-gray-300 dark:focus:border-neutral-600"
            />
          </div>
        </div>

        <div className="px-5 pt-3">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              handleFiles(e.dataTransfer.files);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-6 cursor-pointer transition-colors ${
              dragOver
                ? 'border-blue-400 bg-blue-50 dark:border-blue-500 dark:bg-blue-900/20'
                : 'border-gray-200 dark:border-neutral-700 hover:border-gray-300 dark:hover:border-neutral-600'
            }`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5 text-gray-400 dark:text-neutral-500"
            >
              <path d="M12 16V4M12 4 7 9M12 4l5 5" />
              <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
            </svg>
            <p className="text-xs text-gray-500 dark:text-neutral-400">
              Drop a file here, or <span className="text-blue-600 dark:text-blue-400">browse</span>
            </p>
            <p className="text-[11px] text-gray-400 dark:text-neutral-500">.txt, .md, .pdf, or .docx</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.pdf,.docx"
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = '';
              }}
              className="hidden"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 mt-1">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <DocumentIcon />
              <p className="text-sm text-gray-400 dark:text-neutral-500 mt-2">
                {documents.length === 0 ? 'No documents yet' : 'No documents match your search'}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-3 px-2 pb-2 text-[11px] font-semibold tracking-wide text-gray-400 dark:text-neutral-500">
                <span className="flex-1">NAME</span>
                <span className="w-20 text-right">STATUS</span>
                <span className="w-16 text-right hidden sm:inline">CHUNKS</span>
                <span className="w-16 text-right hidden sm:inline">ADDED</span>
                <span className="w-6" />
              </div>
              {filtered.map((doc) => (
                <div
                  key={doc.id}
                  className="group flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-neutral-800/60 transition-colors"
                >
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <DocumentIcon />
                    <div className="min-w-0">
                      <div className="text-sm text-gray-800 dark:text-neutral-200 truncate">
                        {doc.filename}
                      </div>
                      {doc.status === 'failed' && doc.error_message && (
                        <div className="text-[11px] text-red-500 dark:text-red-400 truncate">
                          {doc.error_message}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="w-20 flex justify-end">
                    <StatusBadge status={doc.status} />
                  </div>
                  <div className="w-16 text-right text-xs text-gray-400 dark:text-neutral-500 hidden sm:block">
                    {doc.status === 'indexed' ? doc.chunk_count : '—'}
                  </div>
                  <div className="w-16 text-right text-xs text-gray-400 dark:text-neutral-500 hidden sm:block">
                    {formatRelativeTime(doc.uploaded_at)}
                  </div>
                  <div className="w-6 flex justify-end">
                    <button
                      type="button"
                      onClick={() => onDelete(doc.id)}
                      className="h-6 w-6 flex items-center justify-center rounded text-gray-300 dark:text-neutral-600 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 opacity-0 group-hover:opacity-100 transition-all"
                      aria-label="Delete document"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-3.5 w-3.5"
                      >
                        <path d="M3 6h18" />
                        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}