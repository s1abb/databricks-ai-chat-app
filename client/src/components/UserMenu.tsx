import { useEffect, useRef, useState } from 'react';

interface UserMenuProps {
  onOpenSettings: () => void;
  theme: 'light' | 'dark';
}

interface WhoAmI {
  email: string;
  username: string;
}

export function UserMenu({ onOpenSettings, theme }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<WhoAmI | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/whoami')
      .then((r) => r.json())
      .then(setUser)
      .catch(() => setUser({ email: 'unknown@localhost', username: 'User' }));
  }, []);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, [open]);

  const initial = (user?.username?.[0] ?? user?.email?.[0] ?? '?').toUpperCase();

  return (
    <div ref={containerRef} className="relative px-3 py-2 border-t border-gray-200 dark:border-neutral-800">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors"
      >
        <span className="h-6 w-6 shrink-0 rounded-full bg-[#CC785C] text-white text-xs font-medium flex items-center justify-center">
          {initial}
        </span>
        <span className="text-sm text-gray-700 dark:text-neutral-300 truncate flex-1 text-left">
          {user?.username ?? 'Loading...'}
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3.5 w-3.5 text-gray-400 dark:text-neutral-500 shrink-0"
        >
          <path d="m18 15-6-6-6 6" />
        </svg>
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ colorScheme: theme }}
          className="absolute bottom-full left-3 right-3 mb-2 rounded-xl border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 shadow-lg overflow-hidden"
        >
          <div className="px-3 py-2.5 border-b border-gray-100 dark:border-neutral-700">
            <p className="text-xs text-gray-500 dark:text-neutral-400 truncate">
              {user?.email ?? ''}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onOpenSettings();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-700 transition-colors"
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
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
            </svg>
            Settings
          </button>
        </div>
      )}
    </div>
  );
}