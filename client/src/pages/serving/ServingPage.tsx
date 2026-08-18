import { useServingInvoke } from '@databricks/appkit-ui/react';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { ChatSidebar } from '../../components/ChatSidebar';
import { DocumentsPanel } from '../../components/DocumentsPanel';
import { CitationModal } from '../../components/CitationModal';
import { SettingsModal } from '../../components/SettingsModal';

interface ChatContentPart {
  type?: string;
  text?: string;
}

interface ChatChoice {
  message?: { content?: string | ChatContentPart[] };
}

interface ChatResponse {
  choices?: ChatChoice[];
}

function extractContent(data: unknown): string {
  const resp = data as ChatResponse;
  const content = resp?.choices?.[0]?.message?.content;

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter((part: ChatContentPart) => part?.type === 'text' || part?.type === 'output_text')
      .map((part: ChatContentPart) => part?.text ?? '')
      .join('');
  }

  return content != null ? JSON.stringify(data) : '';
}

interface RetrievedSource {
  kind: 'chunk' | 'entity' | 'relationship';
  chunkId: string;
  documentId: string | null;
  filename: string;
  snippet: string;
  similarity: number;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: RetrievedSource[] | null;
}

type RetrievalMode = 'chunks' | 'graph' | 'both';

interface ChatSummary {
  id: string;
  title: string | null;
  last_model: string | null;
  rag_enabled: boolean;
  retrieval_mode: RetrievalMode | null;
  created_at: string;
  updated_at: string;
}

interface RagDocument {
  id: string;
  filename: string;
  status: 'pending' | 'processing' | 'indexed' | 'failed';
  error_message: string | null;
  chunk_count: number;
  processed_chunks: number;
  uploaded_at: string;
}

interface ServingPageProps {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

const MODEL_OPTIONS = [
  { alias: 'gpt_oss_120b', label: 'GPT OSS 120B' },
  { alias: 'llama_3_3_70b', label: 'Llama 3.3 70B' },
  { alias: 'qwen35_122b', label: 'Qwen3.5 122B' },
] as const;

type ModelAlias = (typeof MODEL_OPTIONS)[number]['alias'];

function isModelAlias(value: string | null | undefined): value is ModelAlias {
  return MODEL_OPTIONS.some((m) => m.alias === value);
}

function injectCitationMarkers(content: string): string {
  return content.replace(/\[(\d+)\](?!\()/g, (_match, n) => `<cite data-index="${n}"></cite>`);
}

interface CodeRendererProps {
  className?: string;
  children?: React.ReactNode;
}

function CodeRenderer({ className, children }: CodeRendererProps) {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || '');

  if (!match) {
    return (
      <code className="bg-gray-100 dark:bg-neutral-800 rounded px-1 py-0.5 text-xs font-mono">
        {children}
      </code>
    );
  }

  const codeText = String(children).replace(/\n$/, '');

  function handleCopy() {
    void navigator.clipboard.writeText(codeText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="my-3 rounded-xl border border-neutral-800 bg-neutral-900 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-800">
        <span className="text-xs text-neutral-500 font-mono lowercase">{match[1]}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="h-6 w-6 flex items-center justify-center rounded text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
          aria-label="Copy code"
        >
          {copied ? (
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
              <path d="M20 6 9 17l-5-5" />
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
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>
      </div>
      <pre className="px-4 py-3 overflow-x-auto">
        <code className="text-sm leading-relaxed text-neutral-200 font-mono">{codeText}</code>
      </pre>
    </div>
  );
}

export function ServingPage({ theme, onToggleTheme }: ServingPageProps) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [connected, setConnected] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ModelAlias>(MODEL_OPTIONS[0].alias);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [ragEnabled, setRagEnabled] = useState(false);
  const [retrievalMode, setRetrievalMode] = useState<RetrievalMode>('chunks');
  const [documents, setDocuments] = useState<RagDocument[]>([]);
  const [documentsPanelOpen, setDocumentsPanelOpen] = useState(false);
  const [citationModal, setCitationModal] = useState<{
    sources: RetrievedSource[];
    focusIndex: number;
  } | null>(null);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');

  const { invoke, loading, error } = useServingInvoke(
    { messages: [] },
    { alias: selectedModel },
  );

  const bottomRef = useRef<HTMLDivElement>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (!modelMenuOpen) return;
    function closeMenu() {
      setModelMenuOpen(false);
    }
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, [modelMenuOpen]);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  async function refreshChats(): Promise<ChatSummary[]> {
    const list: ChatSummary[] = await fetch('/api/chats').then((r) => r.json());
    setChats(list);
    return list;
  }

  async function refreshDocuments() {
    const list: RagDocument[] = await fetch('/api/rag/documents').then((r) => r.json());
    setDocuments(list);
  }

  async function handleUploadDocument(file: File) {
    const formData = new FormData();
    formData.append('file', file);
    await fetch('/api/rag/documents', { method: 'POST', body: formData });
    await refreshDocuments();
    startPollingIfNeeded();
  }

  function startPollingIfNeeded() {
    if (pollIntervalRef.current) return;
    pollIntervalRef.current = setInterval(async () => {
      const list: RagDocument[] = await fetch('/api/rag/documents').then((r) => r.json());
      setDocuments(list);
      const stillWorking = list.some(
        (d) =>
          d.status === 'pending' ||
          d.status === 'processing' ||
          d.processed_chunks < d.chunk_count,
      );
      if (!stillWorking && pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    }, 3000);
  }

  async function handleDeleteDocument(id: string) {
    setDocuments((prev) => prev.filter((d) => d.id !== id));
    await fetch(`/api/rag/documents/${id}`, { method: 'DELETE' });
  }

  async function loadMessagesFor(id: string) {
    const history: Message[] = await fetch(`/api/chats/${id}/messages`).then((r) => r.json());
    setMessages(history);
  }

  async function init() {
    setReady(false);
    try {
      const list = await refreshChats();
      await refreshDocuments();
      startPollingIfNeeded();
      fetch('/api/settings')
        .then((r) => r.json())
        .then((data: { systemPrompt: string }) => setSystemPrompt(data.systemPrompt))
        .catch(() => {});

      let active: ChatSummary;
      if (list.length > 0) {
        active = list[0];
      } else {
        active = await fetch('/api/chats', { method: 'POST' }).then((r) => r.json());
        setChats([active]);
      }
      setChatId(active.id);
      setSelectedModel(isModelAlias(active.last_model) ? active.last_model : MODEL_OPTIONS[0].alias);
      setRagEnabled(active.rag_enabled ?? false);
      setRetrievalMode(active.retrieval_mode ?? 'chunks');
      await loadMessagesFor(active.id);
      setConnected(true);
    } catch {
      setConnected(false);
    } finally {
      setReady(true);
    }
  }

  useEffect(() => {
    void init();
  }, []);

  async function handleNewChat() {
    setReady(false);
    try {
      const created: ChatSummary = await fetch('/api/chats', { method: 'POST' }).then((r) =>
        r.json(),
      );
      setChatId(created.id);
      setMessages([]);
      setSelectedModel(MODEL_OPTIONS[0].alias);
      setRagEnabled(created.rag_enabled ?? false);
      setRetrievalMode(created.retrieval_mode ?? 'chunks');
      await refreshChats();
      setConnected(true);
    } catch {
      setConnected(false);
    } finally {
      setReady(true);
    }
  }

  async function handleSelectChat(id: string) {
    if (id === chatId) return;
    setReady(false);
    try {
      await loadMessagesFor(id);
      setChatId(id);
      const target = chats.find((c) => c.id === id);
      setSelectedModel(
        isModelAlias(target?.last_model) ? (target!.last_model as ModelAlias) : MODEL_OPTIONS[0].alias,
      );
      setRagEnabled(target?.rag_enabled ?? false);
      setRetrievalMode(target?.retrieval_mode ?? 'chunks');
      setConnected(true);
    } catch {
      setConnected(false);
    } finally {
      setReady(true);
    }
  }

  async function handleRenameChat(id: string, title: string) {
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, title } : c)));
    await fetch(`/api/chats/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
  }

  async function handleDeleteChat(id: string) {
    const isActive = id === chatId;
    const isLastChat = chats.length === 1 && chats[0]?.id === id;

    if (isActive && isLastChat) {
      const created: ChatSummary = await fetch('/api/chats', { method: 'POST' }).then((r) =>
        r.json(),
      );
      setChatId(created.id);
      setMessages([]);
      setSelectedModel(MODEL_OPTIONS[0].alias);
      setRagEnabled(created.rag_enabled ?? false);
      setRetrievalMode(created.retrieval_mode ?? 'chunks');
      await fetch(`/api/chats/${id}`, { method: 'DELETE' });
      await refreshChats();
      return;
    }

    await fetch(`/api/chats/${id}`, { method: 'DELETE' });
    const remaining = await refreshChats();

    if (isActive && remaining.length > 0) {
      await handleSelectChat(remaining[0].id);
    }
  }

  async function handleToggleRag() {
    if (!chatId) return;
    const next = !ragEnabled;
    setRagEnabled(next);
    setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, rag_enabled: next } : c)));
    await fetch(`/api/chats/${chatId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rag_enabled: next }),
    });
  }

  async function handleSetRetrievalMode(mode: RetrievalMode) {
    if (!chatId || mode === retrievalMode) return;
    setRetrievalMode(mode);
    setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, retrieval_mode: mode } : c)));
    await fetch(`/api/chats/${chatId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retrieval_mode: mode }),
    });
  }

  async function sendMessage(content: string) {
    if (!content.trim() || loading || !chatId) return;

    const activeChatId = chatId;
    const userContent = content.trim();
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userContent,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');

    await fetch(`/api/chats/${activeChatId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user', content: userContent }),
    });

    let sources: RetrievedSource[] = [];
    let augmentedUserContent = userContent;

    if (ragEnabled) {
      try {
        const recentHistory = messages
          .slice(-6)
          .map(({ role, content: c }) => ({ role, content: c }));

        const retrieval: { context: string; sources: RetrievedSource[]; searchQuery?: string } =
          await fetch('/api/rag/retrieve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              query: userContent,
              history: recentHistory,
              mode: retrievalMode,
            }),
          }).then((r) => r.json());

        sources = retrieval.sources ?? [];
        if (retrieval.context) {
          augmentedUserContent = `Use the following numbered sources to answer the question. When you use information from a source, cite it inline immediately after the relevant statement using its number in square brackets, e.g. [1] or [2]. Only cite sources you actually rely on - do not cite a number that wasn't provided below, and do not add a separate reference list at the end.

${retrieval.context}

---

Question: ${userContent}`;
        }
      } catch (err) {
        console.error('[rag-retrieve] client-side failure:', err);
      }
    }

    const systemPreamble = systemPrompt.trim()
      ? [
          { role: 'user' as const, content: `System instructions: ${systemPrompt.trim()}` },
          { role: 'assistant' as const, content: 'Understood.' },
        ]
      : [];

    const fullMessages = [
      ...systemPreamble,
      ...messages.map(({ role, content: c }) => ({ role, content: c })),
      { role: 'user' as const, content: augmentedUserContent },
    ];

    const result = await invoke({ messages: fullMessages });
    if (result) {
      const assistantContent = extractContent(result);
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'assistant', content: assistantContent, sources },
      ]);

      await fetch(`/api/chats/${activeChatId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'assistant', content: assistantContent, sources }),
      });

      await refreshChats();
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void sendMessage(input);
  }

  const currentModelLabel =
    MODEL_OPTIONS.find((m) => m.alias === selectedModel)?.label ?? selectedModel;

  return (
    <div className="h-screen w-full flex bg-white dark:bg-neutral-950">
      <ChatSidebar
        chats={chats}
        activeChatId={chatId}
        onSelectChat={(id) => void handleSelectChat(id)}
        onNewChat={() => void handleNewChat()}
        onRenameChat={(id, title) => void handleRenameChat(id, title)}
        onDeleteChat={(id) => void handleDeleteChat(id)}
        onOpenDocuments={() => setDocumentsPanelOpen(true)}
        onOpenSettings={() => setSettingsModalOpen(true)}
        documentCount={documents.length}
        disabled={loading || !ready}
        theme={theme}
        onToggleTheme={onToggleTheme}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 overflow-y-auto px-6 pt-12 pb-8">
          <div className="max-w-3xl mx-auto space-y-7">
            {!ready && (
              <p className="text-sm text-gray-400 dark:text-neutral-500">
                Loading conversation...
              </p>
            )}

            {messages.map((msg) => {
              const messageSources = msg.sources ?? [];
              return msg.role === 'user' ? (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl bg-gray-100 dark:bg-neutral-900 px-4 py-2.5">
                    <p className="text-sm whitespace-pre-wrap text-gray-700 dark:text-neutral-200">
                      {msg.content}
                    </p>
                  </div>
                </div>
              ) : (
                <div key={msg.id} className="flex justify-start">
                  <div className="max-w-[85%] text-[15px] leading-7 text-gray-700 dark:text-neutral-200 [&_p]:my-3 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-3 [&_li]:my-1 [&_strong]:font-semibold [&_a]:text-[#CC785C] dark:[&_a]:text-[#E8A27C] [&_a]:underline [&_table]:my-3 [&_table]:border-collapse [&_table]:w-full [&_th]:border [&_th]:border-gray-200 dark:[&_th]:border-neutral-700 [&_th]:bg-gray-50 dark:[&_th]:bg-neutral-800 [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold [&_td]:border [&_td]:border-gray-200 dark:[&_td]:border-neutral-700 [&_td]:px-3 [&_td]:py-1.5 [&_table]:text-sm">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeRaw]}
                      components={{
                        code: CodeRenderer,
                        cite: (props: React.HTMLAttributes<HTMLElement> & { 'data-index'?: string }) => {
                          const n = Number(props['data-index']);
                          if (!n || n > messageSources.length) return null;
                          return (
                            <button
                              type="button"
                              onClick={() =>
                                setCitationModal({ sources: messageSources, focusIndex: n })
                              }
                              className="inline-flex items-center justify-center h-4 min-w-4 px-1 mx-0.5 -translate-y-0.5 rounded-full bg-gray-100 dark:bg-neutral-800 text-[10px] font-medium text-gray-500 dark:text-neutral-400 hover:bg-[#CC785C]/15 hover:text-[#CC785C] dark:hover:text-[#E8A27C] transition-colors align-super"
                            >
                              {n}
                            </button>
                          );
                        },
                      }}
                    >
                      {injectCitationMarkers(msg.content)}
                    </ReactMarkdown>
                  </div>
                </div>
              );
            })}

            {loading && (
              <p className="text-sm text-gray-400 dark:text-neutral-500">Generating response</p>
            )}

            {error && (
              <div className="text-destructive text-sm p-2 bg-destructive/10 rounded">
                Error: {error}
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        </div>

        <div className="px-6 pt-4 pb-6 border-t border-gray-100 dark:border-neutral-900">
          <div className="max-w-3xl mx-auto">
            <form
              onSubmit={handleSubmit}
              className="flex flex-col gap-2 rounded-[26px] border border-gray-200 dark:border-neutral-800 shadow-sm px-4 pt-3 pb-2.5 bg-white dark:bg-neutral-900"
            >
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask a question..."
                className="w-full text-sm text-gray-900 dark:text-neutral-100 placeholder:text-gray-400 dark:placeholder:text-neutral-500 bg-transparent border-0 outline-none ring-0 focus:outline-none focus:ring-0 appearance-none"
                style={{ colorScheme: theme }}
                disabled={loading || !ready}
              />

              <div className="flex items-center justify-between gap-2 pb-0.5">
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => void handleToggleRag()}
                    disabled={loading || !ready}
                    className={`flex items-center gap-1.5 text-xs rounded-full px-3 py-1.5 transition-colors disabled:opacity-50 ${
                      ragEnabled
                        ? 'bg-[#CC785C]/15 text-[#CC785C] dark:bg-[#CC785C]/20 dark:text-[#E8A27C]'
                        : 'bg-gray-100 text-gray-500 dark:bg-neutral-800 dark:text-neutral-400'
                    }`}
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
                      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
                    </svg>
                    Knowledge base
                  </button>

                  {ragEnabled && (
                    <div className="flex items-center rounded-full bg-gray-100 dark:bg-neutral-800 p-1 gap-0.5 text-xs">
                      <button
                        type="button"
                        onClick={() => void handleSetRetrievalMode('chunks')}
                        disabled={loading || !ready}
                        className={`rounded-full px-2.5 py-1 transition-colors disabled:opacity-50 ${
                          retrievalMode === 'chunks'
                            ? 'bg-white dark:bg-neutral-700 text-gray-800 dark:text-neutral-100 shadow-sm'
                            : 'text-gray-500 dark:text-neutral-400'
                        }`}
                      >
                        Chunks
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSetRetrievalMode('graph')}
                        disabled={loading || !ready}
                        className={`rounded-full px-2.5 py-1 transition-colors disabled:opacity-50 ${
                          retrievalMode === 'graph'
                            ? 'bg-white dark:bg-neutral-700 text-gray-800 dark:text-neutral-100 shadow-sm'
                            : 'text-gray-500 dark:text-neutral-400'
                        }`}
                      >
                        Graph
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSetRetrievalMode('both')}
                        disabled={loading || !ready}
                        className={`rounded-full px-2.5 py-1 transition-colors disabled:opacity-50 ${
                          retrievalMode === 'both'
                            ? 'bg-white dark:bg-neutral-700 text-gray-800 dark:text-neutral-100 shadow-sm'
                            : 'text-gray-500 dark:text-neutral-400'
                        }`}
                      >
                        Both
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <div className="relative">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setModelMenuOpen((prev) => !prev);
                      }}
                      disabled={loading || !ready}
                      className="flex items-center gap-1 text-xs text-gray-500 dark:text-neutral-400 hover:bg-gray-100 dark:hover:bg-neutral-800 rounded-md px-2.5 py-1.5 transition-colors disabled:opacity-50"
                    >
                      {currentModelLabel}
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-3 w-3"
                      >
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </button>

                    {modelMenuOpen && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="absolute bottom-full right-0 mb-2 w-40 rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 shadow-lg py-1 z-10"
                      >
                        {MODEL_OPTIONS.map((option) => (
                          <button
                            key={option.alias}
                            type="button"
                            onClick={() => {
                              setSelectedModel(option.alias);
                              setModelMenuOpen(false);
                            }}
                            className={`w-full text-left text-sm px-3 py-1.5 hover:bg-gray-100 dark:hover:bg-neutral-700 ${
                              option.alias === selectedModel
                                ? 'text-gray-900 dark:text-neutral-100 font-medium'
                                : 'text-gray-600 dark:text-neutral-400'
                            }`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={loading || !ready || !input.trim()}
                    className="h-8 w-8 shrink-0 rounded-full bg-[#CC785C] hover:bg-[#B8684E] text-white flex items-center justify-center disabled:opacity-40 transition-colors"
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
                      <path d="M12 19V5" />
                      <path d="m5 12 7-7 7 7" />
                    </svg>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>

      <DocumentsPanel
        open={documentsPanelOpen}
        onClose={() => setDocumentsPanelOpen(false)}
        documents={documents}
        onUpload={(file) => void handleUploadDocument(file)}
        onDelete={(id) => void handleDeleteDocument(id)}
        theme={theme}
      />

      <CitationModal
        open={citationModal != null}
        onClose={() => setCitationModal(null)}
        sources={citationModal?.sources ?? []}
        focusIndex={citationModal?.focusIndex}
        theme={theme}
      />

      <SettingsModal
        open={settingsModalOpen}
        onClose={() => setSettingsModalOpen(false)}
        theme={theme}
        onDatabaseReset={() => void refreshDocuments()}
        connected={connected}
        projectName="chat-app-db"
      />
    </div>
  );
}