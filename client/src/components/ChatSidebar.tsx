import { useEffect, useState } from 'react';
import { UserMenu } from './UserMenu';

interface ChatSummary {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

interface ChatSidebarProps {
  connected: boolean;
  projectName: string;
  chats: ChatSummary[];
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
  onNewChat: () => void;
  onRenameChat: (id: string, title: string) => void;
  onDeleteChat: (id: string) => void;
  onOpenDocuments: () => void;
  onOpenSettings: () => void;
  documentCount: number;
  disabled?: boolean;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

function chatLabel(chat: ChatSummary): string {
  return chat.title?.trim() || 'New conversation';
}

export function ChatSidebar({
  connected,
  projectName,
  chats,
  activeChatId,
  onSelectChat,
  onNewChat,
  onRenameChat,
  onDeleteChat,
  onOpenDocuments,
  onOpenSettings,
  documentCount,
  disabled,
  theme,
  onToggleTheme,
}: ChatSidebarProps) {
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  useEffect(() => {
    if (!openMenuFor) return;
    function closeMenu() {
      setOpenMenuFor(null);
    }
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, [openMenuFor]);

  function startRename(chat: ChatSummary) {
    setEditingId(chat.id);
    setEditValue(chatLabel(chat));
    setOpenMenuFor(null);
  }

  function commitRename(id: string) {
    const trimmed = editValue.trim();
    if (trimmed) onRenameChat(id, trimmed);
    setEditingId(null);
  }

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

      <div className="px-3 flex flex-col gap-0.5">
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

        <button
          type="button"
          onClick={onOpenDocuments}
          className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-700 dark:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors"
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
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
            <path d="M14 2v6h6" />
          </svg>
          <span className="flex-1 text-left">Documents</span>
          {documentCount > 0 && (
            <span className="text-[11px] text-gray-400 dark:text-neutral-500">
              {documentCount}
            </span>
          )}
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

      <div className="px-3 mt-5 flex-1 overflow-y-auto">
        <div className="text-[11px] font-semibold tracking-wide text-gray-400 dark:text-neutral-500 px-1 mb-1">
          CONVERSATIONS
        </div>
        <div className="flex flex-col gap-0.5">
          {chats.map((chat) => {
            const isActive = chat.id === activeChatId;
            const isEditing = editingId === chat.id;
            return (
              <div key={chat.id} className="relative group">
                {isEditing ? (
                  <input
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => commitRename(chat.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(chat.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    style={{ colorScheme: theme }}
                    className="w-full text-sm rounded-lg px-3 py-2 border border-gray-300 dark:border-neutral-600 bg-white dark:bg-neutral-800 text-gray-900 dark:text-neutral-100 outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => onSelectChat(chat.id)}
                    disabled={disabled}
                    className={`w-full flex items-center text-left text-sm rounded-lg pl-3 pr-8 py-2 truncate transition-colors disabled:opacity-50 ${
                      isActive
                        ? 'bg-gray-200 dark:bg-neutral-800 text-gray-900 dark:text-neutral-100'
                        : 'text-gray-700 dark:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-800'
                    }`}
                  >
                    <span className="truncate">{chatLabel(chat)}</span>
                  </button>
                )}

                {!isEditing && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMenuFor(openMenuFor === chat.id ? null : chat.id);
                    }}
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 flex items-center justify-center rounded-md text-gray-400 dark:text-neutral-500 hover:bg-gray-200 dark:hover:bg-neutral-700 opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label="Chat options"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="h-4 w-4"
                    >
                      <circle cx="5" cy="12" r="1.5" />
                      <circle cx="12" cy="12" r="1.5" />
                      <circle cx="19" cy="12" r="1.5" />
                    </svg>
                  </button>
                )}

                {openMenuFor === chat.id && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="absolute right-0 top-full mt-1 z-10 w-32 rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 shadow-lg py-1"
                  >
                    <button
                      type="button"
                      onClick={() => startRename(chat)}
                      className="w-full text-left text-sm px-3 py-1.5 text-gray-700 dark:text-neutral-300 hover:bg-gray-100 dark:hover:bg-neutral-700"
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOpenMenuFor(null);
                        onDeleteChat(chat.id);
                      }}
                      className="w-full text-left text-sm px-3 py-1.5 text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-neutral-700"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-auto">
        <UserMenu onOpenSettings={onOpenSettings} theme={theme} />
      </div>
    </aside>
  );
}