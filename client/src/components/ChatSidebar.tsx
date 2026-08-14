interface ChatSidebarProps {
  connected: boolean;
  projectName: string;
  examplePrompts: string[];
  onExampleClick: (prompt: string) => void;
  onNewChat: () => void;
  disabled?: boolean;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export function ChatSidebar({
  connected,
  projectName,
  examplePrompts,
  onExampleClick,
  onNewChat,
  disabled,
  theme,
  onToggleTheme,
}: ChatSidebarProps) {
  return (
    <aside className="w-72 shrink-0 border-r border-gray-200 dark:border-neutral-800 bg-gray-50 dark:bg-neutral-950 flex flex-col h-full">
      <div className="px-4 py-4 flex items-center gap-2">
        <span className="text-lg">💬</span>
        <span className="font-semibold text-sm text-gray-900 dark:text-neutral-100 flex-1">
          databricks-ai-chat-app
        </span>
        <button
          type="button"
          onClick={onToggleTheme}
          className="h-7 w-7 flex items-center justify-center rounded-md text-gray-500 dark:text-neutral-400 hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? (
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
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
            </svg>
          ) : (
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
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
            </svg>
          )}
        </button>
      </div>

      <div className="px-3">
        <button
          type="button"
          onClick={onNewChat}
          disabled={disabled}
          className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-700 dark:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors disabled:opacity-50"
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
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
          New chat
        </button>
      </div>

      <div className="px-3 mt-3">
        <div className="rounded-xl bg-gray-100 dark:bg-neutral-900 p-3">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500 animate-pulse' : 'bg-gray-400 dark:bg-neutral-600'}`}
            />
            <span className="text-[11px] font-semibold tracking-wide text-gray-500 dark:text-neutral-400">
              LAKEBASE
            </span>
          </div>
          <div className="text-sm font-medium text-gray-900 dark:text-neutral-100">
            {projectName}
          </div>
          <div className="text-xs text-gray-500 dark:text-neutral-400 mt-1">
            Conversations are saved automatically
          </div>
        </div>
      </div>

      <div className="px-3 mt-5 overflow-y-auto">
        <div className="text-[11px] font-semibold tracking-wide text-gray-400 dark:text-neutral-500 px-1 mb-1">
          QUESTIONS
        </div>
        <div className="flex flex-col gap-0.5">
          {examplePrompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => onExampleClick(prompt)}
              disabled={disabled}
              className="text-left text-sm text-gray-700 dark:text-neutral-300 rounded-lg px-3 py-2 hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors disabled:opacity-50"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-auto px-4 py-3 text-xs text-gray-400 dark:text-neutral-500 border-t border-gray-200 dark:border-neutral-800">
        Chat history is saved to Lakebase Postgres.
      </div>
    </aside>
  );
}