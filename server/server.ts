import { createApp, server, serving, lakebase } from '@databricks/appkit';
import { randomUUID } from 'node:crypto';

interface TitleContentPart {
  type?: string;
  text?: string;
}

interface TitleChoice {
  message?: { content?: string | TitleContentPart[] };
}

interface TitleResponse {
  choices?: TitleChoice[];
}

function extractText(data: unknown): string {
  const wrapper = data as { ok?: boolean; data?: TitleResponse };
  const resp = (wrapper?.data ?? (data as TitleResponse)) as TitleResponse;
  const content = resp?.choices?.[0]?.message?.content;

  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    return content
      .filter((part: TitleContentPart) => part?.type === 'text' || part?.type === 'output_text')
      .map((part: TitleContentPart) => part?.text ?? '')
      .join('');
  }

  return '';
}

// Simple recursive-ish chunker: splits on paragraph breaks first, then
// falls back to splitting oversized paragraphs by sentence, accumulating
// into ~targetChars-sized chunks with a small overlap between them.
function chunkText(text: string, targetChars = 3200, overlapChars = 400): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    if (current.length + para.length + 2 <= targetChars) {
      current = current ? `${current}\n\n${para}` : para;
      continue;
    }

    if (current) {
      chunks.push(current);
      current = current.slice(Math.max(0, current.length - overlapChars));
    }

    if (para.length <= targetChars) {
      current = current ? `${current}\n\n${para}` : para;
    } else {
      // Oversized single paragraph: split by sentence.
      const sentences = para.split(/(?<=[.?!])\s+/);
      let piece = current;
      for (const sentence of sentences) {
        if (piece.length + sentence.length + 1 > targetChars) {
          if (piece) chunks.push(piece);
          piece = piece.slice(Math.max(0, piece.length - overlapChars));
        }
        piece = piece ? `${piece} ${sentence}` : sentence;
      }
      current = piece;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

await createApp({
  plugins: [
    server(),
    serving({
      endpoints: {
        gpt_oss_120b: { env: 'MODEL_GPT_OSS_ENDPOINT_NAME' },
        llama_3_3_70b: { env: 'MODEL_LLAMA_ENDPOINT_NAME' },
        qwen35_122b: { env: 'MODEL_QWEN_ENDPOINT_NAME' },
        bge_embed: { env: 'MODEL_EMBED_ENDPOINT_NAME' },
      },
    }),
    lakebase(),
  ],
  async onPluginsReady(AppKit) {
    await AppKit.lakebase.query(`CREATE SCHEMA IF NOT EXISTS chat`);
    await AppKit.lakebase.query(`
      CREATE TABLE IF NOT EXISTS chat.chats (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title TEXT,
        last_model TEXT,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    await AppKit.lakebase.query(`
      CREATE TABLE IF NOT EXISTS chat.messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        chat_id UUID REFERENCES chat.chats(id) ON DELETE CASCADE,
        role TEXT CHECK (role IN ('user','assistant')),
        content TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);

    await AppKit.lakebase.query(`CREATE SCHEMA IF NOT EXISTS rag`);
    await AppKit.lakebase.query(`
      CREATE TABLE IF NOT EXISTS rag.documents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        filename TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        error_message TEXT,
        chunk_count INT DEFAULT 0,
        uploaded_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    await AppKit.lakebase.query(`
      CREATE TABLE IF NOT EXISTS rag.chunks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        document_id UUID REFERENCES rag.documents(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        chunk_order INT NOT NULL
      )
    `);

    async function maybeGenerateTitle(chatId: string, userContent: string, assistantContent: string) {
      const { rows: countRows } = await AppKit.lakebase.query(
        `SELECT count(*)::int AS count FROM chat.messages WHERE chat_id = $1`,
        [chatId],
      );
      if (countRows[0]?.count !== 2) return;

      try {
        const result = await AppKit.serving('gpt_oss_120b').invoke({
          messages: [
            {
              role: 'user',
              content: `Generate a concise 3-6 word title summarizing the conversation below. Respond with only the title text - no quotes, no punctuation at the end, no preamble.\n\nUser: ${userContent}\nAssistant: ${assistantContent}`,
            },
          ],
        });
        const title = extractText(result).trim().replace(/^["']|["']$/g, '').slice(0, 80);
        if (title) {
          await AppKit.lakebase.query(`UPDATE chat.chats SET title = $1 WHERE id = $2`, [
            title,
            chatId,
          ]);
        }
      } catch (err) {
        console.error('[title-generation] failed:', err);
      }
    }

    async function ingestDocument(documentId: string, text: string) {
      await AppKit.lakebase.query(`UPDATE rag.documents SET status = 'processing' WHERE id = $1`, [
        documentId,
      ]);

      try {
        const chunks = chunkText(text);
        if (chunks.length === 0) {
          throw new Error('Document produced no chunks (empty content?)');
        }

        for (let i = 0; i < chunks.length; i++) {
          await AppKit.lakebase.query(
            `INSERT INTO rag.chunks (id, document_id, content, chunk_order) VALUES ($1, $2, $3, $4)`,
            [randomUUID(), documentId, chunks[i], i],
          );
        }

        await AppKit.lakebase.query(
          `UPDATE rag.documents SET status = 'indexed', chunk_count = $2 WHERE id = $1`,
          [documentId, chunks.length],
        );
      } catch (err) {
        console.error('[rag-ingest] failed:', err);
        await AppKit.lakebase.query(
          `UPDATE rag.documents SET status = 'failed', error_message = $2 WHERE id = $1`,
          [documentId, String(err)],
        );
      }
    }

    AppKit.server.extend((app) => {
      app.post('/api/rag/documents', async (req, res) => {
        const { filename, content } = req.body as { filename?: string; content?: string };
        if (!filename || !content) {
          res.status(400).json({ error: 'filename and content are required' });
          return;
        }

        const { rows } = await AppKit.lakebase.query(
          `INSERT INTO rag.documents (filename) VALUES ($1) RETURNING id, filename, status, error_message, chunk_count, uploaded_at`,
          [filename],
        );
        const document = rows[0];

        // Fire-and-forget: respond immediately, ingest in the background.
        void ingestDocument(document.id, content);

        res.json(document);
      });

      app.get('/api/rag/documents', async (_req, res) => {
        const { rows } = await AppKit.lakebase.query(
          `SELECT id, filename, status, error_message, chunk_count, uploaded_at FROM rag.documents ORDER BY uploaded_at DESC`,
        );
        res.json(rows);
      });

      app.post('/api/chats', async (_req, res) => {
        const { rows } = await AppKit.lakebase.query(
          `INSERT INTO chat.chats DEFAULT VALUES RETURNING id, title, last_model, created_at, updated_at`,
        );
        res.json(rows[0]);
      });

      app.get('/api/chats', async (_req, res) => {
        const { rows } = await AppKit.lakebase.query(
          `SELECT id, title, last_model, created_at, updated_at FROM chat.chats ORDER BY updated_at DESC`,
        );
        res.json(rows);
      });

      app.patch('/api/chats/:chatId', async (req, res) => {
        const { title } = req.body as { title: string };
        const { rows } = await AppKit.lakebase.query(
          `UPDATE chat.chats SET title = $1 WHERE id = $2 RETURNING id, title, last_model, created_at, updated_at`,
          [title, req.params.chatId],
        );
        res.json(rows[0]);
      });

      app.delete('/api/chats/:chatId', async (req, res) => {
        await AppKit.lakebase.query(`DELETE FROM chat.chats WHERE id = $1`, [req.params.chatId]);
        res.status(204).end();
      });

      app.get('/api/chats/:chatId/messages', async (req, res) => {
        const { rows } = await AppKit.lakebase.query(
          `SELECT id, role, content, created_at FROM chat.messages WHERE chat_id = $1 ORDER BY created_at ASC`,
          [req.params.chatId],
        );
        res.json(rows);
      });

      app.post('/api/chats/:chatId/messages', async (req, res) => {
        const { role, content, model } = req.body as {
          role: 'user' | 'assistant';
          content: string;
          model?: string;
        };
        const { rows } = await AppKit.lakebase.query(
          `INSERT INTO chat.messages (chat_id, role, content) VALUES ($1, $2, $3) RETURNING id, role, content, created_at`,
          [req.params.chatId, role, content],
        );
        if (model) {
          await AppKit.lakebase.query(
            `UPDATE chat.chats SET updated_at = now(), last_model = $2 WHERE id = $1`,
            [req.params.chatId, model],
          );
        } else {
          await AppKit.lakebase.query(`UPDATE chat.chats SET updated_at = now() WHERE id = $1`, [
            req.params.chatId,
          ]);
        }

        if (role === 'assistant') {
          const { rows: priorUser } = await AppKit.lakebase.query(
            `SELECT content FROM chat.messages WHERE chat_id = $1 AND role = 'user' ORDER BY created_at ASC LIMIT 1`,
            [req.params.chatId],
          );
          if (priorUser[0]) {
            await maybeGenerateTitle(req.params.chatId, priorUser[0].content, content);
          }
        }

        res.json(rows[0]);
      });
    });
  },
}).catch(console.error);