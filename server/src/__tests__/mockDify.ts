/**
 * Lightweight in-process mock of the Dify App Service API, used by backend tests.
 * Implements the real contract shapes (SSE streaming, conversations, feedback, files...).
 */

import http from 'http';
import { AddressInfo } from 'net';

interface MockState {
  apiKey: string;
  conversations: Map<string, { id: string; name: string; created_at: number; messages: Array<Record<string, unknown>> }>;
  tasks: Map<string, string>; // task_id -> conversation_id
}

export function createMockDify(apiKey = 'app-testkey') {
  const state: MockState = { apiKey, conversations: new Map(), tasks: new Map() };
  let failNextChatWith: { status: number; code: string } | null = null;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const auth = req.headers.authorization || '';
    const json = (code: number, obj: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    if (!auth.endsWith(apiKey)) return json(401, { code: 'unauthorized', message: 'Authorization header is invalid', status: 401 });

    const p = url.pathname.replace(/^\/v1/, '');
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? safeJson(raw) : {};

      if (p === '/info' && req.method === 'GET') return json(200, { name: 'دستیار سازمانی', description: 'توضیح آزمایشی', tags: [] });
      if (p === '/site' && req.method === 'GET') return json(200, { title: 'دستیار سازمانی', icon: '', app_id: 'a1', description: '', copyright: '' });
      if (p === '/parameters' && req.method === 'GET') {
        return json(200, {
          opening_statement: 'سلام! چطور می‌توانم کمک کنم؟', suggested_questions: ['سؤال نمونه ۱'],
          user_input_form: [], file_upload: { enabled: true, number_limits: 3 },
          system_parameters: { file_upload: { file_size_limit: 15 * 1024 * 1024, image_file_size_limit: 10 * 1024 * 1024, file_upload_limit: 6 } },
        });
      }
      if (p === '/chat-messages' && req.method === 'POST') {
        if (failNextChatWith) { const f = failNextChatWith; failNextChatWith = null; return json(f.status, { code: f.code, message: 'mock error' }); }
        const b = body as { query?: string; conversation_id?: string; user?: string; response_mode?: string };
        if (!b.query || !b.user) return json(400, { code: 'invalid_param', message: 'missing fields' });
        let convId = b.conversation_id || cryptoRandom();
        if (!state.conversations.has(convId)) {
          state.conversations.set(convId, { id: convId, name: (b.query || 'گفتگو').slice(0, 30), created_at: Math.floor(Date.now() / 1000), messages: [] });
        }
        const msgId = cryptoRandom();
        const taskId = cryptoRandom();
        state.tasks.set(taskId, convId);
        const answerText = 'پاسخ تستی: ' + b.query;
        state.conversations.get(convId)!.messages.push({ id: msgId, query: b.query, answer: answerText, created_at: Math.floor(Date.now() / 1000), feedback: null });

        if (b.response_mode === 'streaming') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          // simulate incremental deltas (proper delta semantics)
          const parts = splitChunks(answerText);
          let i = 0;
          const send = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
          const iv = setInterval(() => {
            if (i === 0) send({ event: 'message', task_id: taskId, conversation_id: convId, message_id: msgId, answer: parts[i] });
            else send({ event: 'message', conversation_id: convId, message_id: msgId, answer: parts[i] });
            i++;
            if (i >= parts.length) {
              clearInterval(iv);
              send({ event: 'message_end', conversation_id: convId, message_id: msgId, data: { usage: { total_tokens: 10 } } });
              res.end();
            }
          }, 5);
          return;
        }
        return json(200, { message_id: msgId, conversation_id: convId, answer: answerText });
      }
      const stopMatch = p.match(/^\/chat-messages\/([^/]+)\/stop$/);
      if (stopMatch && req.method === 'POST') {
        if (!state.tasks.has(stopMatch[1])) return json(404, { code: 'not_found', message: 'no task' });
        return json(200, { result: 'success' });
      }
      if (p === '/conversations' && req.method === 'GET') {
        const user = url.searchParams.get('user') || '';
        const data = [...state.conversations.values()].map(c => ({ id: c.id, name: c.name, inputs: {}, created_at: c.created_at }));
        void user;
        return json(200, { limit: 20, has_more: false, data });
      }
      if (p === '/messages' && req.method === 'GET') {
        const cid = url.searchParams.get('conversation_id') || '';
        const c = state.conversations.get(cid);
        if (!c) return json(404, { code: 'not_found', message: 'conversation not found' });
        return json(200, { limit: 20, has_more: false, data: c.messages.map(m => ({ ...m, conversation_id: cid })) });
      }
      const nameMatch = p.match(/^\/conversations\/([^/]+)\/name$/);
      if (nameMatch && req.method === 'POST') {
        const c = state.conversations.get(nameMatch[1]);
        if (!c) return json(404, { code: 'not_found', message: 'x' });
        c.name = String((body as { name?: string }).name || c.name);
        return json(200, { result: 'success', conversation: { ...c } });
      }
      const delMatch = p.match(/^\/conversations\/([^/]+)$/);
      if (delMatch && req.method === 'DELETE') {
        if (!state.conversations.has(delMatch[1])) return json(404, { code: 'not_found', message: 'x' });
        state.conversations.delete(delMatch[1]);
        return json(200, { result: 'success' });
      }
      const fbMatch = p.match(/^\/messages\/([^/]+)\/feedbacks$/);
      if (fbMatch && req.method === 'POST') return json(200, { result: 'success' });
      const sugMatch = p.match(/^\/messages\/([^/]+)\/suggested$/);
      if (sugMatch && req.method === 'GET') return json(200, { result: 'success', data: ['پیشنهاد ۱', 'پیشنهاد ۲'] });
      if (p === '/files/upload' && req.method === 'POST') {
        return json(200, { id: cryptoRandom(), name: 'file.png', size: 1234, extension: 'png', mime_type: 'image/png', created_at: Date.now() });
      }
      if (p === '/audio-to-text' && req.method === 'POST') return json(200, { text: 'متن گفتار', audio: null });
      if (p === '/text-to-audio' && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'audio/mpeg' });
        return res.end(Buffer.from([0x49, 0x44, 0x33])); // fake mp3 header bytes
      }
      if (p.startsWith('/conversations/') && p.endsWith('/variables') && req.method === 'GET') {
        return json(200, { user: '', data: [{ id: 'v1', name: 'department', value: 'IT', description: null }] });
      }
      const varPut = p.match(/^\/conversations\/([^/]+)\/variables\/([^/]+)$/);
      if (varPut && req.method === 'PUT') return json(200, { id: varPut[2], name: 'department', value: String((body as { value?: string }).value), description: null });
      return json(404, { code: 'not_found', message: `unknown path ${p}` });
    });
  });

  function cryptoRandom() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
  function safeJson(s: string) { try { return JSON.parse(s); } catch { return {}; } }
  function splitChunks(t: string): string[] {
    const out: string[] = []; for (let i = 0; i < t.length; i += 7) out.push(t.slice(i, i + 7)); return out.length ? out : [''];
  }

  return {
    server,
    start(): Promise<string> {
      return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          const addr = server.address() as AddressInfo;
          resolve(`http://127.0.0.1:${addr.port}/v1`);
        });
      });
    },
    stop(): Promise<void> { return new Promise((r) => server.close(() => r())); },
    setFailNextChat(spec: { status: number; code: string } | null) { failNextChatWith = spec; },
    state,
  };
}
