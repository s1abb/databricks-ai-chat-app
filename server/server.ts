import { createApp, server, serving, lakebase } from '@databricks/appkit';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { PDFParse } from 'pdf-parse';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

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

interface EmbeddingResponse {
  data?: { embedding?: number[]; index?: number }[];
}

function extractEmbeddings(data: unknown): number[][] {
  const wrapper = data as { ok?: boolean; data?: EmbeddingResponse };
  const resp = (wrapper?.data ?? (data as EmbeddingResponse)) as EmbeddingResponse;
  const items = resp?.data ?? [];
  return items
    .slice()
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((item) => item.embedding ?? []);
}

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

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

async function extractTextFromUpload(filename: string, buffer: Buffer): Promise<string> {
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'pdf') {
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    await parser.destroy();
    return result.text;
  }
  // .txt, .md, and anything else: treat as plain UTF-8 text.
  return buffer.toString('utf-8');
}

interface RetrievedSource {
  chunkId: string;
  documentId: string;
  filename: string;
  snippet: string;
  similarity: number;
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
    await AppKit.lakebase.query(
      `ALTER TABLE chat.chats ADD COLUMN IF NOT EXISTS rag_enabled BOOLEAN DEFAULT false`,
    );
    await AppKit.lakebase.query(`
      CREATE TABLE IF NOT EXISTS chat.messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        chat_id UUID REFERENCES chat.chats(id) ON DELETE CASCADE,
        role TEXT CHECK (role IN ('user','assistant')),
        content TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `);
    await AppKit.lakebase.query(
      `ALTER TABLE chat.messages ADD COLUMN IF NOT EXISTS sources JSONB`,
    );

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
        embedding VECTOR(1024),
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

        const embedResult = await AppKit.serving('bge_embed').invoke({ input: chunks });
        const embeddings = extractEmbeddings(embedResult);
        if (embeddings.length !== chunks.length) {
          throw new Error(
            `Embedding count mismatch: got ${embeddings.length} vectors for ${chunks.length} chunks`,
          );
        }

        for (let i = 0; i < chunks.length; i++) {
          await AppKit.lakebase.query(
            `INSERT INTO rag.chunks (id, document_id, content, embedding, chunk_order) VALUES ($1, $2, $3, $4::vector, $5)`,
            [randomUUID(), documentId, chunks[i], toVectorLiteral(embeddings[i]), i],
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

    async function retrieveContext(
      query: string,
      topK = 5,
    ): Promise<{ context: string; sources: RetrievedSource[] }> {
      const embedResult = await AppKit.serving('bge_embed').invoke({ input: [query] });
      const [queryEmbedding] = extractEmbeddings(embedResult);
      if (!queryEmbedding) {
        return { context: '', sources: [] };
      }

      const { rows } = await AppKit.lakebase.query(
        `
          SELECT c.id AS chunk_id, c.content, d.id AS document_id, d.filename,
                 1 - (c.embedding <=> $1::vector) AS similarity
          FROM rag.chunks c
          JOIN rag.documents d ON d.id = c.document_id
          ORDER BY c.embedding <=> $1::vector
          LIMIT $2
        `,
        [toVectorLiteral(queryEmbedding), topK],
      );

      const sources: RetrievedSource[] = rows.map(
        (row: {
          chunk_id: string;
          document_id: string;
          filename: string;
          content: string;
          similarity: number;
        }) => ({
          chunkId: row.chunk_id,
          documentId: row.document_id,
          filename: row.filename,
          snippet: row.content.slice(0, 240),
          similarity: row.similarity,
        }),
      );

      const context = rows
        .map(
          (row: { filename: string; content: string }, i: number) =>
            `[Source ${i + 1}: ${row.filename}]\n${row.content}`,
        )
        .join('\n\n---\n\n');

      return { context, sources };
    }

    AppKit.server.extend((app) => {
      app.post('/api/rag/documents', upload.single('file'), async (req, res) => {
        const file = req.file;
        if (!file) {
          res.status(400).json({ error: 'file is required (multipart field name: "file")' });
          return;
        }

        let text: string;
        try {
          text = await extractTextFromUpload(file.originalname, file.buffer);
        } catch (err) {
          console.error('[rag-upload] text extraction failed:', err);
          res.status(400).json({ error: 'Could not extract text from this file' });
          return;
        }

        const { rows } = await AppKit.lakebase.query(
          `INSERT INTO rag.documents (filename) VALUES ($1) RETURNING id, filename, status, error_message, chunk_count, uploaded_at`,
          [file.originalname],
        );
        const document = rows[0];

        void ingestDocument(document.id, text);

        res.json(document);
      });

      app.get('/api/rag/documents', async (_req, res) => {
        const { rows } = await AppKit.lakebase.query(
          `SELECT id, filename, status, error_message, chunk_count, uploaded_at FROM rag.documents ORDER BY uploaded_at DESC`,
        );
        res.json(rows);
      });

      app.delete('/api/rag/documents/:id', async (req, res) => {
        await AppKit.lakebase.query(`DELETE FROM rag.documents WHERE id = $1`, [req.params.id]);
        res.status(204).end();
      });

      app.post('/api/rag/retrieve', async (req, res) => {
        const { query } = req.body as { query?: string };
        if (!query) {
          res.status(400).json({ error: 'query is required' });
          return;
        }
        try {
          const result = await retrieveContext(query);
          res.json(result);
        } catch (err) {
          console.error('[rag-retrieve] failed:', err);
          res.status(500).json({ error: String(err) });
        }
      });

      app.post('/api/chats', async (_req, res) => {
        const { rows } = await AppKit.lakebase.query(
          `INSERT INTO chat.chats DEFAULT VALUES RETURNING id, title, last_model, rag_enabled, created_at, updated_at`,
        );
        res.json(rows[0]);
      });

      app.get('/api/chats', async (_req, res) => {
        const { rows } = await AppKit.lakebase.query(
          `SELECT id, title, last_model, rag_enabled, created_at, updated_at FROM chat.chats ORDER BY updated_at DESC`,
        );
        res.json(rows);
      });

      app.patch('/api/chats/:chatId', async (req, res) => {
        const { title, rag_enabled } = req.body as { title?: string; rag_enabled?: boolean };

        if (title !== undefined) {
          const { rows } = await AppKit.lakebase.query(
            `UPDATE chat.chats SET title = $1 WHERE id = $2 RETURNING id, title, last_model, rag_enabled, created_at, updated_at`,
            [title, req.params.chatId],
          );
          res.json(rows[0]);
          return;
        }

        if (rag_enabled !== undefined) {
          const { rows } = await AppKit.lakebase.query(
            `UPDATE chat.chats SET rag_enabled = $1 WHERE id = $2 RETURNING id, title, last_model, rag_enabled, created_at, updated_at`,
            [rag_enabled, req.params.chatId],
          );
          res.json(rows[0]);
          return;
        }

        res.status(400).json({ error: 'title or rag_enabled is required' });
      });

      app.delete('/api/chats/:chatId', async (req, res) => {
        await AppKit.lakebase.query(`DELETE FROM chat.chats WHERE id = $1`, [req.params.chatId]);
        res.status(204).end();
      });

      app.get('/api/chats/:chatId/messages', async (req, res) => {
        const { rows } = await AppKit.lakebase.query(
          `SELECT id, role, content, sources, created_at FROM chat.messages WHERE chat_id = $1 ORDER BY created_at ASC`,
          [req.params.chatId],
        );
        res.json(rows);
      });

      app.post('/api/chats/:chatId/messages', async (req, res) => {
        const { role, content, model, sources } = req.body as {
          role: 'user' | 'assistant';
          content: string;
          model?: string;
          sources?: RetrievedSource[];
        };
        const { rows } = await AppKit.lakebase.query(
          `INSERT INTO chat.messages (chat_id, role, content, sources) VALUES ($1, $2, $3, $4) RETURNING id, role, content, sources, created_at`,
          [req.params.chatId, role, content, sources ? JSON.stringify(sources) : null],
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