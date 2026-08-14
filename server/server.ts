import { createApp, server, serving, lakebase } from '@databricks/appkit';

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
        res.json(rows[0]);
      });
    });
  },
}).catch(console.error);