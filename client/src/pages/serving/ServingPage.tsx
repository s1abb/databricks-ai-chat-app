import { useServingInvoke } from '@databricks/appkit-ui/react';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { ChatSidebar } from '../../components/ChatSidebar';

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

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface ChatSummary {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

interface ServingPageProps {
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

const EXAMPLE_PROMPTS = [
  'What can you help me with?',
  'How does this app store my conversation?',
  'What model are you running on?',
  'Summarize what Databricks Lakebase is',
];

export function ServingPage({ theme, onToggleTheme }: ServingPageProps) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [connected, setConnected] = useState(false);

  const { invoke, loading, error } = useServingInvoke({ messages: [] });

  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function refreshChats(): Promise<ChatSummary[]> {
    const list: ChatSummary[] = await fetch('/api/chats').then((r) => r.json());
    setChats(list);
    return list;
  }

  async function loadMessagesFor(id: string) {
    const history: Message[] = await fetch(`/api/chats/${id}/messages`).then((r) => r.json());
    setMessages(history);
  }

  async function init() {
    setReady(false);
    try {
      const list = await refreshChats();

      let activeId: string;
      if (list.length > 0) {
        activeId = list[0].id;
      } else {
        const created: ChatSummary = await fetch('/api/chats', { method: 'POST' }).then((r) =>
          r.json(),
        );
        activeId = created.id;
        setChats([created]);
      }
      setChatId(activeId);
      await loadMessagesFor(activeId);
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
    await fetch(`/api/chats/${id}`, { method: 'DELETE' });
    const remaining = await refreshChats();

    if (id === chatId) {
      if (remaining.length > 0) {
        await handleSelectChat(remaining[0].id);
      } else {
        await handleNewChat();
      }
    }
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

    const fullMessages = [
      ...messages.map(({ role, content: c }) => ({ role, content: c })),
      { role: 'user' as const, content: userContent },
    ];

    setMessages((prev) => [...prev, userMessage]);
    setInput('');

    await fetch(`/api/chats/${activeChatId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user', content: userContent }),
    });

    const result = await invoke({ messages: fullMessages });
    if (result) {
      const assistantContent = extractContent(result);
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'assistant', content: assistantContent },
      ]);

      await fetch(`/api/chats/${activeChatId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'assistant', content: assistantContent }),
      });

      await refreshChats();
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void sendMessage(input);
  }

  return (
    <div className="h-screen w-full flex bg-white dark:bg-neutral-900">
      <ChatSidebar
        connected={connected}
        projectName="chat-app-db"
        chats={chats}
        activeChatId={chatId}
        onSelectChat={(id) => void handleSelectChat(id)}
        onNewChat={() => void handleNewChat()}
        onRenameChat={(id, title) => void handleRenameChat(id, title)}
        onDeleteChat={(id) => void handleDeleteChat(id)}
        examplePrompts={EXAMPLE_PROMPTS}
        onExampleClick={(prompt) => void sendMessage(prompt)}
        disabled={loading || !ready}
        theme={theme}
        onToggleTheme={onToggleTheme}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 overflow-y-auto px-6 py-8">
          <div className="max-w-3xl mx-auto space-y-6">
            {!ready && (
              <p className="text-sm text-gray-400 dark:text-neutral-500">
                Loading conversation...
              </p>
            )}

            {messages.map((msg) =>
              msg.role === 'user' ? (
                <div key={msg.id} className="flex justify-end">
                  <div className="max-w-[80%] rounded-2xl bg-gray-100 dark:bg-neutral-800 px-4 py-2">
                    <p className="text-sm whitespace-pre-wrap text-gray-700 dark:text-neutral-200">
                      {msg.content}
                    </p>
                  </div>
                </div>
              ) : (
                <div key={msg.id} className="flex justify-start">
                  <div className="max-w-[80%] text-sm text-gray-700 dark:text-neutral-200 [&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-2 [&_li]:my-0.5 [&_strong]:font-semibold [&_code]:bg-gray-100 dark:[&_code]:bg-neutral-800 [&_code]:rounded [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_a]:text-blue-600 dark:[&_a]:text-blue-400 [&_a]:underline [&_table]:my-3 [&_table]:border-collapse [&_table]:w-full [&_th]:border [&_th]:border-gray-200 dark:[&_th]:border-neutral-700 [&_th]:bg-gray-50 dark:[&_th]:bg-neutral-800 [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-semibold [&_td]:border [&_td]:border-gray-200 dark:[&_td]:border-neutral-700 [&_td]:px-3 [&_td]:py-1.5 [&_table]:text-xs">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                </div>
              ),
            )}

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

        <div className="px-6 pb-6">
          <div className="max-w-3xl mx-auto">
            <form
              onSubmit={handleSubmit}
              className="flex items-center gap-2 rounded-2xl border border-gray-200 dark:border-neutral-700 shadow-sm px-4 py-3 bg-white dark:bg-neutral-900"
            >
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask a question..."
                className="flex-1 text-sm text-gray-900 dark:text-neutral-100 placeholder:text-gray-400 dark:placeholder:text-neutral-500 bg-transparent border-0 outline-none ring-0 focus:outline-none focus:ring-0 appearance-none"
                style={{ colorScheme: theme }}
                disabled={loading || !ready}
              />
              <button
                type="submit"
                disabled={loading || !ready || !input.trim()}
                className="h-9 w-9 shrink-0 rounded-full bg-black text-white dark:bg-white dark:text-neutral-900 flex items-center justify-center disabled:opacity-40 transition-opacity"
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
            </form>
            <p className="text-center text-xs text-gray-400 dark:text-neutral-500 mt-2">
              Always review the accuracy of responses.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}