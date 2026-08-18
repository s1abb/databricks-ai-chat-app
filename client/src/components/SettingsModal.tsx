import { useEffect, useState } from 'react';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  theme: 'light' | 'dark';
  onDatabaseReset: () => void;
  connected: boolean;
  projectName: string;
}

type Tab = 'general' | 'database';

export function SettingsModal({
  open,
  onClose,
  theme,
  onDatabaseReset,
  connected,
  projectName,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>('general');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [savedPrompt, setSavedPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [resetStep, setResetStep] = useState<'idle' | 'confirm' | 'resetting' | 'done'>('idle');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data: { systemPrompt: string }) => {
        setSystemPrompt(data.systemPrompt);
        setSavedPrompt(data.systemPrompt);
      })
      .finally(() => setLoading(false));
  }, [open]);

  async function handleSave() {
    setSaving(true);
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemPrompt }),
      });
      setSavedPrompt(systemPrompt);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    setResetStep('resetting');
    try {
      await fetch('/api/rag/reset', { method: 'POST' });
      setResetStep('done');
      onDatabaseReset();
      setTimeout(() => setResetStep('idle'), 2000);
    } catch {
      setResetStep('idle');
    }
  }

  const isDirty = systemPrompt !== savedPrompt;

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
      style={{ colorScheme: theme }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl max-h-[75vh] flex flex-col rounded-2xl bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 shadow-xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-neutral-100">Settings</h2>
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

        <div className="flex flex-1 min-h-0">
          <div className="w-40 shrink-0 border-r border-gray-100 dark:border-neutral-800 py-3 px-2">
            <button
              type="button"
              onClick={() => setActiveTab('general')}
              className={`w-full text-left text-sm rounded-lg px-3 py-2 transition-colors ${
                activeTab === 'general'
                  ? 'bg-gray-100 dark:bg-neutral-800 text-gray-900 dark:text-neutral-100 font-medium'
                  : 'text-gray-500 dark:text-neutral-400 hover:bg-gray-50 dark:hover:bg-neutral-800/60'
              }`}
            >
              General
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('database')}
              className={`w-full text-left text-sm rounded-lg px-3 py-2 transition-colors ${
                activeTab === 'database'
                  ? 'bg-gray-100 dark:bg-neutral-800 text-gray-900 dark:text-neutral-100 font-medium'
                  : 'text-gray-500 dark:text-neutral-400 hover:bg-gray-50 dark:hover:bg-neutral-800/60'
              }`}
            >
              Database
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            {activeTab === 'general' && (
              <div className="flex flex-col gap-3">
                <div>
                  <label className="text-sm font-medium text-gray-800 dark:text-neutral-200">
                    System prompt
                  </label>
                  <p className="text-xs text-gray-500 dark:text-neutral-400 mt-0.5">
                    Applied to every conversation for every user of this app.
                  </p>
                </div>

                {loading ? (
                  <p className="text-sm text-gray-400 dark:text-neutral-500">Loading...</p>
                ) : (
                  <>
                    <textarea
                      value={systemPrompt}
                      onChange={(e) => setSystemPrompt(e.target.value)}
                      placeholder="e.g. Always answer concisely and cite sources when available."
                      rows={8}
                      style={{ colorScheme: theme }}
                      className="w-full text-sm rounded-lg border border-gray-200 dark:border-neutral-700 bg-gray-50 dark:bg-neutral-800 text-gray-900 dark:text-neutral-100 placeholder:text-gray-400 dark:placeholder:text-neutral-500 px-3 py-2 outline-none focus:border-gray-300 dark:focus:border-neutral-600 resize-none"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleSave()}
                        disabled={!isDirty || saving}
                        className="rounded-lg bg-[#CC785C] hover:bg-[#B8684E] text-white text-sm px-4 py-1.5 transition-colors disabled:opacity-40"
                      >
                        {saving ? 'Saving...' : 'Save'}
                      </button>
                      {saved && (
                        <span className="text-xs text-green-600 dark:text-green-400">Saved</span>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {activeTab === 'database' && (
              <div className="flex flex-col gap-4">
                <div>
                  <h3 className="text-sm font-medium text-gray-800 dark:text-neutral-200">
                    Connection
                  </h3>
                </div>

                <div className="rounded-xl bg-gray-100 dark:bg-neutral-800 p-3">
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
                </div>

                <div>
                  <h3 className="text-sm font-medium text-gray-800 dark:text-neutral-200">
                    Knowledge base
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-neutral-400 mt-0.5">
                    Permanently deletes every uploaded document, chunk, entity, and relationship.
                    This does not affect chat history.
                  </p>
                </div>

                <div className="rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-900/10 p-4">
                  {resetStep === 'idle' && (
                    <button
                      type="button"
                      onClick={() => setResetStep('confirm')}
                      className="text-sm font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                    >
                      Clear knowledge base
                    </button>
                  )}

                  {resetStep === 'confirm' && (
                    <div className="flex flex-col gap-2">
                      <p className="text-sm text-red-700 dark:text-red-300">
                        This can't be undone. Delete all documents and knowledge graph data?
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleReset()}
                          className="rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm px-3 py-1.5 transition-colors"
                        >
                          Yes, delete everything
                        </button>
                        <button
                          type="button"
                          onClick={() => setResetStep('idle')}
                          className="text-sm text-gray-500 dark:text-neutral-400 hover:text-gray-700 dark:hover:text-neutral-200"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {resetStep === 'resetting' && (
                    <p className="text-sm text-gray-500 dark:text-neutral-400">Deleting...</p>
                  )}

                  {resetStep === 'done' && (
                    <p className="text-sm text-green-600 dark:text-green-400">
                      Knowledge base cleared.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}