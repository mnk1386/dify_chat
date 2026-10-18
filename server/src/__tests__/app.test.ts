/**
 * End-to-end backend tests against a mock Dify server.
 * Covers: connection check, send/stream, stop, conversations lifecycle,
 * feedback, suggested questions, file upload validation, API-key errors,
 * network failure handling, authorization (foreign conversation access),
 * CSRF, and secret non-disclosure.
 */

import request from 'supertest';
import { createMockDify } from './mockDify';

// The mock Dify server must be listening on a fixed port BEFORE config/app modules load.
const MOCK_PORT = 39876;
const mock = createMockDify('app-testkey');
mock.server.listen(MOCK_PORT, '127.0.0.1');
const mockUrl = `http://127.0.0.1:${MOCK_PORT}/v1`;

process.env.DIFY_BASE_URL = mockUrl;
process.env.DIFY_API_KEY = 'app-testkey';
process.env.DIFY_TIMEOUT = '10000';
process.env.SESSION_SECRET = 'test-secret';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = ':memory:';
process.env.BOOTSTRAP_ADMIN_USERNAME = 'admin';
process.env.BOOTSTRAP_ADMIN_PASSWORD = 'AdminPass!23';

import { initDb } from '../db';
import { runtimeSettings } from '../config';
import { createApp } from '../app';
import { bootstrapAdminFromEnv } from '../services/auth';

initDb(':memory:');
bootstrapAdminFromEnv();
runtimeSettings.update({ difyBaseUrl: mockUrl, difyApiKey: 'app-testkey' });
const app = createApp();

afterAll(async () => { await new Promise<void>((r) => mock.server.close(() => r())); });

async function login(username: string, password: string) {
  const res = await request(app).post('/api/auth/login').send({ username, password });
  expect(res.status).toBe(200);
  const cookie = (res.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
  const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
  return { cookie, csrf: me.body.csrfToken as string };
}

/** Extract SSE `data:` JSON frames from a supertest response that used a raw-buffering parse(). */
function streamFrames(res: { body?: unknown; text?: string }): Array<Record<string, any>> {
  const text = String((res as { body?: unknown }).body ?? res.text ?? '');
  return text
    .split('\n\n')
    .filter((f) => f.startsWith('data: '))
    .map((f) => JSON.parse(f.slice(6)));
}

describe('auth & sessions', () => {
  test('rejects wrong credentials with Persian error', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'admin', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toContain('رمز عبور');
  });

  test('protected API requires session', async () => {
    const res = await request(app).get('/api/conversations');
    expect(res.status).toBe(401);
  });

  test('me returns user + csrf token but never api key', async () => {
    const { cookie } = await login('admin', 'AdminPass!23');
    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('admin');
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('app-testkey');
  });
});

describe('Dify connection check', () => {
  test('admin status endpoint reports connected app name', async () => {
    const { cookie } = await login('admin', 'AdminPass!23');
    const res = await request(app).get('/api/app/status').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    expect(res.body.appName).toBe('دستیار سازمانی');
  });

  test('invalid API key surfaces understandable Persian error without leaking key', async () => {
    const before = runtimeSettings.get().difyApiKey;
    runtimeSettings.update({ difyApiKey: 'app-wrong' });
    const { cookie } = await login('admin', 'AdminPass!23');
    const res = await request(app).get('/api/app/status').set('Cookie', cookie);
    expect(res.body.connected).toBe(false);
    expect(res.body.error).toContain('کلید API');
    expect(JSON.stringify(res.body)).not.toContain('app-wrong');
    runtimeSettings.update({ difyApiKey: before });
  });
});

describe('chat streaming', () => {
  let auth: { cookie: string; csrf: string };
  beforeAll(async () => { auth = await login('admin', 'AdminPass!23'); });

  async function collectStream(body: Record<string, unknown>): Promise<string[]> {
    const res = await request(app)
      .post('/api/chat/send')
      .set('Cookie', auth.cookie)
      .set('X-CSRF-Token', auth.csrf)
      .send(body)
      .buffer(true)
      .parse((r, cb) => {
        let data = '';
        r.setEncoding('utf8');
        r.on('data', (c) => (data += c));
        r.on('end', () => cb(null, data as never));
      });
    expect(res.status).toBe(200);
    // superagent >=10 delivers the custom parser's value on `res.body` (`res.text` is unset there)
    const text = String((res as { body?: unknown }).body ?? res.text ?? '');
    return text.split('\n\n').filter(f => f.startsWith('data: ')).map(f => f.slice(6));
  }

  test('streams deltas that concatenate to the full answer without duplication', async () => {
    const frames = (await collectStream({ query: 'سلام دنیا', clientMsgId: 'm-1' }))
      .map(f => JSON.parse(f));
    const deltas = frames.filter(f => f.event === 'delta').map(f => f.answer).join('');
    expect(deltas).toBe('پاسخ تستی: سلام دنیا');
    const end = frames.find(f => f.event === 'end');
    expect(end).toBeTruthy();
    expect(end.conversation_id).toBeTruthy();
    expect(end.message_id).toBeTruthy();
    // usage only forwarded because mock returned it
    expect(end.usage.total_tokens).toBe(10);
  });

  test('duplicate clientMsgId is rejected (double-send protection)', async () => {
    const first = await request(app).post('/api/chat/send').set('Cookie', auth.cookie).set('X-CSRF-Token', auth.csrf)
      .send({ query: 'تکراری', clientMsgId: 'dup-1' }).buffer(true).parse((r, cb) => { let d = ''; r.on('data', c => d += c); r.on('end', () => cb(null, d as never)); });
    expect(first.status).toBe(200);
    const second = await request(app).post('/api/chat/send').set('Cookie', auth.cookie).set('X-CSRF-Token', auth.csrf)
      .send({ query: 'تکراری', clientMsgId: 'dup-1' });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('duplicate_request');
  });

  test('missing CSRF token is rejected for state-changing calls', async () => {
    const res = await request(app).post('/api/chat/send').set('Cookie', auth.cookie).send({ query: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('csrf_failed');
  });

  test('empty query fails validation', async () => {
    const res = await request(app).post('/api/chat/send').set('Cookie', auth.cookie).set('X-CSRF-Token', auth.csrf).send({ query: '' });
    expect(res.status).toBe(400);
  });

  test('stop endpoint forwards to Dify stop API', async () => {
    // First create a real task by sending a message
    const frames = (await collectStream({ query: 'برای توقف', clientMsgId: 'st-1' })).map(f => JSON.parse(f));
    const taskId = frames.find(f => f.event === 'delta')?.task_id;
    expect(taskId).toBeTruthy();
    const res = await request(app).post('/api/chat/stop').set('Cookie', auth.cookie).set('X-CSRF-Token', auth.csrf).send({ taskId });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('API failure during stream yields app_error frame with Persian message and keeps no secrets', async () => {
    mock.setFailNextChat({ status: 500, code: 'internal_server_error' });
    const res = await request(app).post('/api/chat/send').set('Cookie', auth.cookie).set('X-CSRF-Token', auth.csrf)
      .send({ query: 'خطا', clientMsgId: 'err-1' }).buffer(true).parse((r, cb) => { let d = ''; r.on('data', c => d += c); r.on('end', () => cb(null, d as never)); });
    const frames = streamFrames(res);
    const errFrame = frames.find(f => f.event === 'app_error');
    expect(errFrame).toBeTruthy();
    expect(typeof errFrame.message).toBe('string');
    expect(JSON.stringify(res.body || {})).not.toContain('app-testkey');
  });

  test('network failure (unreachable Dify) handled gracefully', async () => {
    const before = runtimeSettings.get().difyBaseUrl;
    runtimeSettings.update({ difyBaseUrl: 'http://127.0.0.1:1/v1' }); // refused connection
    const res = await request(app).post('/api/chat/send').set('Cookie', auth.cookie).set('X-CSRF-Token', auth.csrf)
      .send({ query: 'قطعی شبکه', clientMsgId: 'net-1' }).buffer(true).parse((r, cb) => { let d = ''; r.on('data', c => d += c); r.on('end', () => cb(null, d as never)); });
    const frames = streamFrames(res);
    const errFrame = frames.find(f => f.event === 'app_error');
    expect(errFrame).toBeTruthy();
    expect(errFrame.retryable).toBe(true);
    runtimeSettings.update({ difyBaseUrl: before });
  });
});

describe('conversation management', () => {
  let auth: { cookie: string; csrf: string };
  let convId: string;
  let msgId: string;

  beforeAll(async () => {
    auth = await login('admin', 'AdminPass!23');
    const res = await request(app).post('/api/chat/send').set('Cookie', auth.cookie).set('X-CSRF-Token', auth.csrf)
      .send({ query: 'مکالمه آزمایشی', clientMsgId: 'c-1' }).buffer(true).parse((r, cb) => { let d = ''; r.on('data', c => d += c); r.on('end', () => cb(null, d as never)); });
    const frames = streamFrames(res);
    convId = frames.find(f => f.event === 'end').conversation_id;
    msgId = frames.find(f => f.event === 'end').message_id;
  });

  test('list conversations (from Dify) and index sync', async () => {
    const res = await request(app).get('/api/conversations').set('Cookie', auth.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.some((c: { id: string }) => c.id === convId)).toBe(true);
  });

  test('load previous messages of a conversation', async () => {
    const res = await request(app).get(`/api/conversations/${convId}/messages`).set('Cookie', auth.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data[0].query).toBe('مکالمه آزمایشی');
  });

  test('rename conversation via official API', async () => {
    const res = await request(app).post(`/api/conversations/${convId}/rename`).set('Cookie', auth.cookie).set('X-CSRF-Token', auth.csrf)
      .send({ name: 'عنوان جدید' });
    expect(res.status).toBe(200);
    expect(mock.state.conversations.get(convId)!.name).toBe('عنوان جدید');
  });

  test('search uses local index (documented fallback, not fake API)', async () => {
    const res = await request(app).get('/api/conversations?q=جدید').set('Cookie', auth.cookie);
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('local_index_search');
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  test('feedback like/dislike with optional content', async () => {
    const res = await request(app).post(`/api/chat/feedback/${msgId}`).set('Cookie', auth.cookie).set('X-CSRF-Token', auth.csrf)
      .send({ rating: 'dislike', content: 'پاسخ دقیق نبود' });
    expect(res.status).toBe(200);
  });

  test('suggested questions fetched from API', async () => {
    const res = await request(app).get(`/api/chat/suggested/${msgId}`).set('Cookie', auth.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(['پیشنهاد ۱', 'پیشنهاد ۲']);
  });

  test('conversation variables read/update', async () => {
    const g = await request(app).get(`/api/conversations/${convId}/variables`).set('Cookie', auth.cookie);
    expect(g.status).toBe(200);
    const u = await request(app).put(`/api/conversations/${convId}/variables/v1`).set('Cookie', auth.cookie).set('X-CSRF-Token', auth.csrf).send({ value: 'HR' });
    expect(u.status).toBe(200);
    expect(u.body.variable.value).toBe('HR');
  });

  test('delete conversation removes local index too', async () => {
    const res = await request(app).delete(`/api/conversations/${convId}`).set('Cookie', auth.cookie).set('X-CSRF-Token', auth.csrf);
    expect(res.status).toBe(200);
    const list = await request(app).get('/api/conversations?q=عنوان+جدید').set('Cookie', auth.cookie);
    expect(list.body.data.find((c: { id: string }) => c.id === convId)).toBeUndefined();
  });
});

describe('multi-user isolation', () => {
  test('user B cannot open user A conversation (backend-enforced)', async () => {
    // create users directly in DB via login flow requires accounts; provision through admin settings? Instead use bootstrap + direct insert helper.
    const dbMod = require('../db');
    const { hashPassword } = require('../services/auth');
    if (!dbMod.findUserByUsername('bob')) dbMod.createUser('bob', 'بابک', 'user', hashPassword('BobPass!23'));
    const a = await login('admin', 'AdminPass!23');
    const b = await login('bob', 'BobPass!23');

    const res = await request(app).post('/api/chat/send').set('Cookie', a.cookie).set('X-CSRF-Token', a.csrf)
      .send({ query: 'محرمانه الف', clientMsgId: 'iso-1' }).buffer(true).parse((r, cb) => { let d = ''; r.on('data', c => d += c); r.on('end', () => cb(null, d as never)); });
    const frames = streamFrames(res);
    const convId = frames.find(f => f.event === 'end').conversation_id;

    const attack = await request(app).get(`/api/conversations/${convId}/messages`).set('Cookie', b.cookie);
    expect(attack.status).toBe(403);
    expect(attack.body.error.message).toContain('متعلق به شما نیست');

    // also chat continuation into foreign conversation blocked
    const cont = await request(app).post('/api/chat/send').set('Cookie', b.cookie).set('X-CSRF-Token', b.csrf)
      .send({ query: 'سراغ', conversationId: convId });
    expect(cont.status).toBe(403);
  });
});

describe('file upload validation', () => {
  let auth: { cookie: string; csrf: string };
  beforeAll(async () => { auth = await login('admin', 'AdminPass!23'); });

  test('rejects executable files', async () => {
    const res = await request(app).post('/api/chat/files/upload').set('Cookie', auth.cookie).set('X-CSRF-Token', auth.csrf)
      .attach('file', Buffer.from('MZ'), 'evil.exe');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('blocked_type');
  });

  test('rejects unsupported types', async () => {
    const res = await request(app).post('/api/chat/files/upload').set('Cookie', auth.cookie).set('X-CSRF-Token', auth.csrf)
      .attach('file', Buffer.from('data'), 'weird.zzz');
    expect(res.status).toBe(400);
  });

  test('accepts valid png and returns metadata', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const res = await request(app).post('/api/chat/files/upload').set('Cookie', auth.cookie).set('X-CSRF-Token', auth.csrf)
      .attach('file', png, 'photo.png');
    expect(res.status).toBe(200);
    expect(res.body.file_type).toBe('image');
    expect(res.body.id).toBeTruthy();
  });
});

describe('audio endpoints (conditional features)', () => {
  let auth: { cookie: string; csrf: string };
  beforeAll(async () => { auth = await login('admin', 'AdminPass!23'); });

  test('speech-to-text relay works when provider available', async () => {
    const res = await request(app).post('/api/chat/audio/to-text').set('Cookie', auth.cookie).set('X-CSRF-Token', auth.csrf)
      .attach('audio', Buffer.from('fake-audio-bytes'), 'voice.webm');
    expect(res.status).toBe(200);
    expect(res.body.text).toBe('متن گفتار');
  });

  test('text-to-speech relay streams audio bytes', async () => {
    const res = await request(app).post('/api/chat/audio/from-text').set('Cookie', auth.cookie).set('X-CSRF-Token', auth.csrf)
      .send({ text: 'سلام' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('audio');
  });
});

describe('admin settings security', () => {
  test('normal user cannot access admin settings', async () => {
    const dbMod = require('../db');
    const { hashPassword } = require('../services/auth');
    if (!dbMod.findUserByUsername('carol')) dbMod.createUser('carol', 'مریم', 'user', hashPassword('CarolPass!23'));
    const c = await login('carol', 'CarolPass!23');
    const res = await request(app).get('/api/admin/settings').set('Cookie', c.cookie);
    expect(res.status).toBe(403);
  });

  test('settings response masks API key and never contains it', async () => {
    const a = await login('admin', 'AdminPass!23');
    const res = await request(app).get('/api/admin/settings').set('Cookie', a.cookie);
    expect(res.status).toBe(200);
    expect(res.body.apiKeySet).toBe(true);
    expect(res.body.apiKeyMasked).toContain('…');
    expect(JSON.stringify(res.body)).not.toContain('app-testkey');
  });

  test('connection test endpoint returns readable result', async () => {
    const a = await login('admin', 'AdminPass!23');
    const res = await request(app).post('/api/admin/test-connection').set('Cookie', a.cookie).set('X-CSRF-Token', a.csrf).send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.appName).toBe('دستیار سازمانی');
  });
});

describe('general hardening', () => {
  test('unknown API path returns safe 404 json', async () => {
    const a = await login('admin', 'AdminPass!23');
    const res = await request(app).get('/api/nope').set('Cookie', a.cookie);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('not_found');
  });

  test('no stack traces or secrets in error bodies', async () => {
    const a = await login('admin', 'AdminPass!23');
    const res = await request(app).post('/api/chat/send').set('Cookie', a.cookie).set('X-CSRF-Token', a.csrf).send({ query: 123 as never });
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/at .*\.ts:\d+/);
    expect(body).not.toContain('app-testkey');
    expect(body).not.toContain('test-secret');
  });
});
