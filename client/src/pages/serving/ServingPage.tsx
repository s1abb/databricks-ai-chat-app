import { useServingInvoke } from '@databricks/appkit-ui/react';
import { useEffect, useState } from 'react';

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

export function ServingPage() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const { invoke, loading, error } = useServingInvoke({ messages: [] });

  // On mount: resume the most recent chat, or create a new one.
  useEffect(() => {
    async function init() {
      const chats: ChatSummary[] = await fetch('/api/chats').then((r) => r.json());

      let activeId: string;
      if (chats.length > 0) {
        activeId = chats[0].id;
      } else {
        const created: ChatSummary = await fetch('/api/chats', { method: 'POST' }).then((r) =>
          r.json(),
        );
        activeId = created.id;
      }
      setChatId(activeId);

      const history: Message[] = await fetch(`/api/chats/${activeId}/messages`).then((r) =>
        r.json(),
      );
      setMessages(history);
      setReady(true);
    }

    void init();
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || loading || !chatId) return;

    const userContent = input.trim();
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userContent,
    };

    const fullMessages = [
      ...messages.map(({ role, content }) => ({ role, content })),
      { role: 'user' as const, content: userContent },
    ];

    setMessages((prev) => [...prev, userMessage]);
    setInput('');

    // Persist the user turn (fire-and-forget is fine; UI already updated optimistically).
    void fetch(`/api/chats/${chatId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user', content: userContent }),
    });

    void invoke({ messages: fullMessages }).then(async (result) => {
      if (result) {
        const assistantContent = extractContent(result);
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: 'assistant', content: assistantContent },
        ]);

        // Persist the assistant turn.
        await fetch(`/api/chats/${chatId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'assistant', content: assistantContent }),
        });
      }
    });
  }

  return (
    <div className="space-y-6 w-full max-w-4xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Model Serving</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Chat with a Databricks Model Serving endpoint.
        </p>
      </div>

      <div className="border rounded-lg flex flex-col h-[min(600px,70vh)]">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!ready && (
            <p className="text-sm text-muted-foreground">Loading conversation...</p>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-lg px-4 py-2 ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted'
                }`}
              >
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="max-w-[80%] rounded-lg px-4 py-2 bg-muted">
                <p className="text-sm whitespace-pre-wrap">...</p>
              </div>
            </div>
          )}

          {error && (
            <div className="text-destructive text-sm p-2 bg-destructive/10 rounded">
              Error: {error}
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="border-t p-4 flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Send a message..."
            className="flex-1 rounded-md border px-3 py-2 text-sm bg-background"
            disabled={loading || !ready}
          />
          <button
            type="submit"
            disabled={loading || !ready || !input.trim()}
            className="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {loading ? 'Loading...' : 'Send'}
          </button>
        </form>
      </div>
    </div>
  );
}