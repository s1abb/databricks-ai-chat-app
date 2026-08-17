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

function parseJsonLoose(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : raw;

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  const jsonSlice = start !== -1 && end !== -1 ? candidate.slice(start, end + 1) : candidate;

  return JSON.parse(jsonSlice.trim());
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

async function embedInBatches(
  invokeEmbed: (input: string[]) => Promise<unknown>,
  texts: string[],
  batchSize = 15,
): Promise<number[][]> {
  const allEmbeddings: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const result = await invokeEmbed(batch);
    const embeddings = extractEmbeddings(result);
    if (embeddings.length !== batch.length) {
      throw new Error(
        `Embedding batch mismatch: got ${embeddings.length} vectors for ${batch.length} texts`,
      );
    }
    allEmbeddings.push(...embeddings);
  }
  return allEmbeddings;
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
  return buffer.toString('utf-8');
}

interface RetrievedSource {
  kind: 'chunk' | 'entity' | 'relationship';
  chunkId: string;
  documentId: string | null;
  filename: string;
  snippet: string;
  similarity: number;
}

interface ExtractedEntity {
  name: string;
  type: string;
  description: string;
}

interface ExtractedRelationship {
  source: string;
  target: string;
  description: string;
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
    await AppKit.lakebase.query(
      `ALTER TABLE chat.chats ADD COLUMN IF NOT EXISTS retrieval_mode TEXT DEFAULT 'chunks'`,
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
    await AppKit.lakebase.query(`
      CREATE TABLE IF NOT EXISTS rag.entities (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_name TEXT NOT NULL,
        entity_type TEXT,
        description TEXT,
        embedding VECTOR(1024),
        source_chunk_ids UUID[] DEFAULT '{}'
      )
    `);
    await AppKit.lakebase.query(`
      CREATE TABLE IF NOT EXISTS rag.relationships (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        source_entity_id UUID REFERENCES rag.entities(id) ON DELETE CASCADE,
        target_entity_id UUID REFERENCES rag.entities(id) ON DELETE CASCADE,
        description TEXT,
        embedding VECTOR(1024),
        source_chunk_ids UUID[] DEFAULT '{}'
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

    async function rewriteQueryForRetrieval(
      history: { role: 'user' | 'assistant'; content: string }[],
      newMessage: string,
    ): Promise<string> {
      if (history.length === 0) return newMessage;

      try {
        const historyText = history
          .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
          .join('\n');

        const result = await AppKit.serving('gpt_oss_120b').invoke({
          messages: [
            {
              role: 'user',
              content: `Given the conversation history below and a new follow-up message, rewrite the follow-up into a standalone search query that includes any context needed to understand it on its own (e.g. resolve "it", "that", "the second one" into what they actually refer to).

If the follow-up message is already standalone and doesn't depend on the history, just return it unchanged.

Respond with ONLY the rewritten query text - no quotes, no explanation, no preamble.

Conversation history:
${historyText}

Follow-up message: ${newMessage}`,
            },
          ],
        });

        const rewritten = extractText(result).trim().replace(/^["']|["']$/g, '');
        return rewritten || newMessage;
      } catch (err) {
        console.error('[query-rewrite] failed, falling back to raw query:', err);
        return newMessage;
      }
    }

    async function extractEntitiesAndRelationships(
      chunkText: string,
    ): Promise<{ entities: ExtractedEntity[]; relationships: ExtractedRelationship[] }> {
      try {
        const result = await AppKit.serving('gpt_oss_120b').invoke({
          messages: [
            {
              role: 'user',
              content: `Extract entities and relationships from the text below.

For each entity, give a short "type" (e.g. Person, Organization, Concept, Policy, Location) and a one-sentence description.
For each relationship, name the "source" entity, the "target" entity, and a one-sentence description of how they relate.
Only extract entities and relationships that are explicitly present in the text. Use the entity names consistently between the entities list and the relationships list.

Respond with ONLY a raw JSON object in exactly this shape - no markdown formatting, no headers, no code fences, no explanation before or after:
{"entities": [{"name": "...", "type": "...", "description": "..."}], "relationships": [{"source": "...", "target": "...", "description": "..."}]}

If there are no entities or relationships, respond with {"entities": [], "relationships": []}.

Text:
${chunkText}`,
            },
          ],
        });

        const raw = extractText(result).trim();
        const parsed = parseJsonLoose(raw) as {
          entities?: ExtractedEntity[];
          relationships?: ExtractedRelationship[];
        };
        return {
          entities: parsed.entities ?? [],
          relationships: parsed.relationships ?? [],
        };
      } catch (err) {
        console.error('[entity-extraction] failed for chunk:', err);
        return { entities: [], relationships: [] };
      }
    }

    async function upsertEntity(
      name: string,
      type: string,
      description: string,
      chunkId: string,
    ): Promise<string> {
      const normalized = name.trim();

      const { rows: existing } = await AppKit.lakebase.query(
        `SELECT id, source_chunk_ids FROM rag.entities WHERE lower(entity_name) = lower($1) LIMIT 1`,
        [normalized],
      );

      if (existing[0]) {
        const updatedChunkIds = Array.from(
          new Set([...(existing[0].source_chunk_ids ?? []), chunkId]),
        );
        await AppKit.lakebase.query(`UPDATE rag.entities SET source_chunk_ids = $2 WHERE id = $1`, [
          existing[0].id,
          updatedChunkIds,
        ]);
        return existing[0].id;
      }

      const embedResult = await AppKit.serving('bge_embed').invoke({
        input: [description || normalized],
      });
      const [embedding] = extractEmbeddings(embedResult);
      const newId = randomUUID();

      await AppKit.lakebase.query(
        `INSERT INTO rag.entities (id, entity_name, entity_type, description, embedding, source_chunk_ids) VALUES ($1, $2, $3, $4, $5::vector, $6)`,
        [newId, normalized, type || 'Unknown', description || '', toVectorLiteral(embedding), [chunkId]],
      );
      return newId;
    }

    async function processChunkGraph(chunkId: string, text: string) {
      const { entities, relationships } = await extractEntitiesAndRelationships(text);
      if (entities.length === 0 && relationships.length === 0) return;

      const entityIdByName = new Map<string, string>();
      for (const entity of entities) {
        const id = await upsertEntity(entity.name, entity.type, entity.description, chunkId);
        entityIdByName.set(entity.name.trim().toLowerCase(), id);
      }

      for (const rel of relationships) {
        const sourceKey = rel.source.trim().toLowerCase();
        const targetKey = rel.target.trim().toLowerCase();

        let sourceId = entityIdByName.get(sourceKey);
        if (!sourceId) {
          sourceId = await upsertEntity(rel.source, 'Unknown', '', chunkId);
          entityIdByName.set(sourceKey, sourceId);
        }

        let targetId = entityIdByName.get(targetKey);
        if (!targetId) {
          targetId = await upsertEntity(rel.target, 'Unknown', '', chunkId);
          entityIdByName.set(targetKey, targetId);
        }

        try {
          const embedResult = await AppKit.serving('bge_embed').invoke({
            input: [rel.description || `${rel.source} - ${rel.target}`],
          });
          const [embedding] = extractEmbeddings(embedResult);

          await AppKit.lakebase.query(
            `INSERT INTO rag.relationships (id, source_entity_id, target_entity_id, description, embedding, source_chunk_ids) VALUES ($1, $2, $3, $4, $5::vector, $6)`,
            [randomUUID(), sourceId, targetId, rel.description ?? '', toVectorLiteral(embedding), [chunkId]],
          );
        } catch (err) {
          console.error('[relationship-embed] failed:', err);
        }
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

        const embeddings = await embedInBatches(
          (batch) => AppKit.serving('bge_embed').invoke({ input: batch }),
          chunks,
        );

        const chunkIds: string[] = [];
        for (let i = 0; i < chunks.length; i++) {
          const chunkId = randomUUID();
          chunkIds.push(chunkId);
          await AppKit.lakebase.query(
            `INSERT INTO rag.chunks (id, document_id, content, embedding, chunk_order) VALUES ($1, $2, $3, $4::vector, $5)`,
            [chunkId, documentId, chunks[i], toVectorLiteral(embeddings[i]), i],
          );
        }

        await AppKit.lakebase.query(
          `UPDATE rag.documents SET status = 'indexed', chunk_count = $2 WHERE id = $1`,
          [documentId, chunks.length],
        );

        for (let i = 0; i < chunks.length; i++) {
          await processChunkGraph(chunkIds[i], chunks[i]);
        }
      } catch (err) {
        console.error('[rag-ingest] failed:', err);
        await AppKit.lakebase.query(
          `UPDATE rag.documents SET status = 'failed', error_message = $2 WHERE id = $1`,
          [documentId, String(err)],
        );
      }
    }

    async function representativeFilename(chunkIds: string[]): Promise<string | null> {
      if (!chunkIds || chunkIds.length === 0) return null;
      const { rows } = await AppKit.lakebase.query(
        `SELECT d.filename FROM rag.chunks c JOIN rag.documents d ON d.id = c.document_id WHERE c.id = $1 LIMIT 1`,
        [chunkIds[0]],
      );
      return rows[0]?.filename ?? null;
    }

    async function retrieveContext(
      query: string,
      mode: 'chunks' | 'graph' | 'both' = 'chunks',
      topK = 5,
      minSimilarity = 0.5,
    ): Promise<{ context: string; sources: RetrievedSource[] }> {
      const embedResult = await AppKit.serving('bge_embed').invoke({ input: [query] });
      const [queryEmbedding] = extractEmbeddings(embedResult);
      if (!queryEmbedding) {
        return { context: '', sources: [] };
      }
      const vecLiteral = toVectorLiteral(queryEmbedding);

      const rawChunkRows =
        mode === 'chunks' || mode === 'both'
          ? (
              await AppKit.lakebase.query(
                `
          SELECT c.id AS chunk_id, c.content, d.id AS document_id, d.filename,
                 1 - (c.embedding <=> $1::vector) AS similarity
          FROM rag.chunks c
          JOIN rag.documents d ON d.id = c.document_id
          ORDER BY c.embedding <=> $1::vector
          LIMIT $2
        `,
                [vecLiteral, topK],
              )
            ).rows
          : [];

      const rawEntityRows =
        mode === 'graph' || mode === 'both'
          ? (
              await AppKit.lakebase.query(
                `
          SELECT id, entity_name, entity_type, description, source_chunk_ids,
                 1 - (embedding <=> $1::vector) AS similarity
          FROM rag.entities
          ORDER BY embedding <=> $1::vector
          LIMIT $2
        `,
                [vecLiteral, topK],
              )
            ).rows
          : [];

      const chunkRows = (rawChunkRows as { similarity: number }[]).filter(
        (row) => row.similarity >= minSimilarity,
      );
      const entityRows = (rawEntityRows as { similarity: number }[]).filter(
        (row) => row.similarity >= minSimilarity,
      );

      const entityIds: string[] = (entityRows as { id: string; similarity: number }[]).map(
        (r) => r.id,
      );
      let relRows: {
        description: string;
        source_name: string;
        target_name: string;
        source_chunk_ids: string[];
      }[] = [];
      if (entityIds.length > 0) {
        const relResult = await AppKit.lakebase.query(
          `
            SELECT r.description, se.entity_name AS source_name, te.entity_name AS target_name,
                   r.source_chunk_ids
            FROM rag.relationships r
            JOIN rag.entities se ON se.id = r.source_entity_id
            JOIN rag.entities te ON te.id = r.target_entity_id
            WHERE r.source_entity_id = ANY($1::uuid[]) OR r.target_entity_id = ANY($1::uuid[])
            LIMIT 10
          `,
          [entityIds],
        );
        relRows = relResult.rows;
      }

      const sources: RetrievedSource[] = [];
      const contextLines: string[] = [];

      for (const row of chunkRows as {
        chunk_id: string;
        document_id: string;
        filename: string;
        content: string;
        similarity: number;
      }[]) {
        sources.push({
          kind: 'chunk',
          chunkId: row.chunk_id,
          documentId: row.document_id,
          filename: row.filename,
          snippet: row.content.slice(0, 240),
          similarity: row.similarity,
        });
        contextLines.push(
          `[${sources.length}] Document excerpt from "${row.filename}":\n${row.content}`,
        );
      }

      for (const row of entityRows as {
        id: string;
        entity_name: string;
        entity_type: string | null;
        description: string | null;
        source_chunk_ids: string[];
        similarity: number;
      }[]) {
        const filename = await representativeFilename(row.source_chunk_ids ?? []);
        sources.push({
          kind: 'entity',
          chunkId: row.id,
          documentId: null,
          filename: `${row.entity_name}${row.entity_type ? ` (${row.entity_type})` : ''}${filename ? ` — from ${filename}` : ''}`,
          snippet: row.description ?? '',
          similarity: row.similarity,
        });
        contextLines.push(
          `[${sources.length}] Entity — ${row.entity_name} (${row.entity_type || 'Entity'}):\n${row.description ?? ''}`,
        );
      }

      for (const row of relRows) {
        const filename = await representativeFilename(row.source_chunk_ids ?? []);
        sources.push({
          kind: 'relationship',
          chunkId: randomUUID(),
          documentId: null,
          filename: `${row.source_name} → ${row.target_name}${filename ? ` — from ${filename}` : ''}`,
          snippet: row.description ?? '',
          similarity: 0,
        });
        contextLines.push(
          `[${sources.length}] Relationship — ${row.source_name} → ${row.target_name}:\n${row.description ?? ''}`,
        );
      }

      const context = contextLines.join('\n\n---\n\n');

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

      app.get('/api/rag/graph-stats', async (_req, res) => {
        const { rows: entityRows } = await AppKit.lakebase.query(
          `SELECT count(*)::int AS count FROM rag.entities`,
        );
        const { rows: relRows } = await AppKit.lakebase.query(
          `SELECT count(*)::int AS count FROM rag.relationships`,
        );
        res.json({
          entityCount: entityRows[0]?.count ?? 0,
          relationshipCount: relRows[0]?.count ?? 0,
        });
      });

      app.post('/api/rag/retrieve', async (req, res) => {
        const { query, history, mode } = req.body as {
          query?: string;
          history?: { role: 'user' | 'assistant'; content: string }[];
          mode?: 'chunks' | 'graph' | 'both';
        };
        if (!query) {
          res.status(400).json({ error: 'query is required' });
          return;
        }
        try {
          const searchQuery = await rewriteQueryForRetrieval(history ?? [], query);
          const result = await retrieveContext(searchQuery, mode ?? 'chunks');
          res.json({ ...result, searchQuery });
        } catch (err) {
          console.error('[rag-retrieve] failed:', err);
          res.status(500).json({ error: String(err) });
        }
      });

      app.post('/api/chats', async (_req, res) => {
        const { rows } = await AppKit.lakebase.query(
          `INSERT INTO chat.chats DEFAULT VALUES RETURNING id, title, last_model, rag_enabled, retrieval_mode, created_at, updated_at`,
        );
        res.json(rows[0]);
      });

      app.get('/api/chats', async (_req, res) => {
        const { rows } = await AppKit.lakebase.query(
          `SELECT id, title, last_model, rag_enabled, retrieval_mode, created_at, updated_at FROM chat.chats ORDER BY updated_at DESC`,
        );
        res.json(rows);
      });

      app.patch('/api/chats/:chatId', async (req, res) => {
        const { title, rag_enabled, retrieval_mode } = req.body as {
          title?: string;
          rag_enabled?: boolean;
          retrieval_mode?: 'chunks' | 'graph';
        };

        if (title !== undefined) {
          const { rows } = await AppKit.lakebase.query(
            `UPDATE chat.chats SET title = $1 WHERE id = $2 RETURNING id, title, last_model, rag_enabled, retrieval_mode, created_at, updated_at`,
            [title, req.params.chatId],
          );
          res.json(rows[0]);
          return;
        }

        if (rag_enabled !== undefined) {
          const { rows } = await AppKit.lakebase.query(
            `UPDATE chat.chats SET rag_enabled = $1 WHERE id = $2 RETURNING id, title, last_model, rag_enabled, retrieval_mode, created_at, updated_at`,
            [rag_enabled, req.params.chatId],
          );
          res.json(rows[0]);
          return;
        }

        if (retrieval_mode !== undefined) {
          const { rows } = await AppKit.lakebase.query(
            `UPDATE chat.chats SET retrieval_mode = $1 WHERE id = $2 RETURNING id, title, last_model, rag_enabled, retrieval_mode, created_at, updated_at`,
            [retrieval_mode, req.params.chatId],
          );
          res.json(rows[0]);
          return;
        }

        res.status(400).json({ error: 'title, rag_enabled, or retrieval_mode is required' });
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