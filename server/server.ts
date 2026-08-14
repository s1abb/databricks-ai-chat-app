import { createApp, server, serving, lakebase } from '@databricks/appkit';

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

await createApp({
  plugins: [server(), serving(), lakebase()],
  async onPluginsReady(AppKit) {
    await AppKit.lakebase.query(`CREATE SCHEMA IF NOT EXISTS chat`);
    await AppKit.lakebase.query(`
      CREATE TABLE IF NOT EXISTS chat.chats (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title TEXT,
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

    async function maybeGenerateTitle(chatId: string, userContent: string, assistantContent: string) {
      const { rows: countRows } = await AppKit.lakebase.query(
        `SELECT count(*)::int AS count FROM chat.messages WHERE chat_id = $1`,
        [chatId],
      );
      if (countRows[0]?.count !== 2) return;

      try {
        const result = await AppKit.serving().invoke({
          messages: [
            {
              role: 'system',
              content:
                'Generate a concise 3-6 word title summarizing this conversation. Respond with only the title text - no quotes, no punctuation at the end, no preamble.',
            },
            { role: 'user', content: userContent },
            { role: 'assistant', content: assistantContent },
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

    AppKit.server.extend((app) => {
      app.post('/api/chats', async (_req, res) => {
        const { rows } = await AppKit.lakebase.query(
          `INSERT INTO chat.chats DEFAULT VALUES RETURNING id, title, created_at, updated_at`,
        );
        res.json(rows[0]);
      });

      app.get('/api/chats', async (_req, res) => {
        const { rows } = await AppKit.lakebase.query(
          `SELECT id, title, created_at, updated_at FROM chat.chats ORDER BY updated_at DESC`,
        );
        res.json(rows);
      });

      app.patch('/api/chats/:chatId', async (req, res) => {
        const { title } = req.body as { title: string };
        const { rows } = await AppKit.lakebase.query(
          `UPDATE chat.chats SET title = $1 WHERE id = $2 RETURNING id, title, created_at, updated_at`,
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
        const { role, content } = req.body as { role: 'user' | 'assistant'; content: string };
        const { rows } = await AppKit.lakebase.query(
          `INSERT INTO chat.messages (chat_id, role, content) VALUES ($1, $2, $3) RETURNING id, role, content, created_at`,
          [req.params.chatId, role, content],
        );
        await AppKit.lakebase.query(`UPDATE chat.chats SET updated_at = now() WHERE id = $1`, [
          req.params.chatId,
        ]);

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