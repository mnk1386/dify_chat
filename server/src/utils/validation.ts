/**
 * Input validation schemas (zod) for all backend endpoints.
 */

import { z } from 'zod';

export const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

export const chatSendSchema = z.object({
  query: z.string().min(1, 'متن پیام نمی‌تواند خالی باشد').max(30000, 'طول پیام بیش از حد مجاز است'),
  conversationId: z.string().max(128).nullable().optional(),
  files: z.array(z.object({
    type: z.enum(['image', 'audio', 'video', 'document', 'custom']),
    transfer_method: z.enum(['local_file', 'remote_url']),
    upload_file_id: z.string().max(128).optional(),
    url: z.string().url().max(2048).optional(),
  })).max(10).optional(),
  inputs: z.record(z.union([z.string().max(4000), z.number(), z.boolean()])).optional(),
  clientMsgId: z.string().max(64).optional(), // idempotency key to prevent accidental double sends
});

export const stopSchema = z.object({
  taskId: z.string().min(1).max(128),
});

export const conversationIdSchema = z.string().min(1).max(128);

export const renameSchema = z.object({
  name: z.string().min(1).max(200),
});

export const feedbackSchema = z.object({
  rating: z.enum(['like', 'dislike', 'null']),
  content: z.string().max(1000).optional(),
});

export const variableUpdateSchema = z.object({
  value: z.string().max(4000),
});

export const workflowRunSchema = z.object({
  inputs: z.record(z.union([z.string().max(8000), z.number(), z.boolean()])),
});

export const ttsSchema = z.object({
  text: z.string().min(1).max(4000),
  messageId: z.string().max(128).optional(),
});

export const sttSchema = z.object({
  filename: z.string().max(255),
  mimeType: z.string().max(128),
});

export const adminSettingsSchema = z.object({
  difyBaseUrl: z.string().max(512).optional(),
  difyApiKey: z.string().max(256).optional(),          // empty string == leave unchanged handled at route level
  difyTimeoutMs: z.number().int().min(5000).max(600000).optional(),
  difyAppType: z.enum(['chat', 'completion', 'workflow']).optional(),
  maxUploadSizeMb: z.number().int().min(1).max(100).optional(),
  uiFont: z.enum(['local', 'vazirmatn', 'system']).optional(),
  uiThemeDefault: z.enum(['light', 'dark', 'auto']).optional(),
});

export function validate<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const first = parsed.error.errors[0];
    const err = new Error(first?.message || 'ورودی نامعتبر است');
    (err as Error & { status?: number; code?: string }).status = 400;
    (err as Error & { code?: string }).code = 'invalid_input';
    throw err;
  }
  return parsed.data;
}

/* ---------- File validation helpers ---------- */

const ALLOWED_EXTENSIONS = new Set([
  // images
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg',
  // documents
  'pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'txt', 'md', 'markdown', 'html', 'csv',
  // audio
  'mp3', 'wav', 'm4a', 'ogg', 'flac', 'webm', 'mpga',
  // video
  'mp4', 'mov', 'mpeg', 'mpg', 'webm', 'avi',
]);

const BLOCKED_EXTENSIONS = new Set([
  'exe', 'bat', 'cmd', 'sh', 'ps1', 'js', 'jar', 'msi', 'dll', 'com', 'scr', 'vbs', 'apk',
]);

export function validateFileMeta(filename: string, sizeBytes: number, maxMb: number): { ok: boolean; reason?: string } {
  const clean = filename.replace(/[\\/]/g, '');
  const ext = (clean.split('.').pop() || '').toLowerCase();
  if (!ext || ext === clean.toLowerCase()) return { ok: false, reason: 'file_no_extension' };
  if (BLOCKED_EXTENSIONS.has(ext)) return { ok: false, reason: 'blocked_type' };
  if (!ALLOWED_EXTENSIONS.has(ext)) return { ok: false, reason: 'unsupported_type' };
  const maxBytes = maxMb * 1024 * 1024;
  if (sizeBytes <= 0) return { ok: false, reason: 'empty_file' };
  if (sizeBytes > maxBytes) return { ok: false, reason: 'too_large' };
  return { ok: true };
}

/** Classify file type for Dify `files[].type` field. */
export function classifyFileType(filename: string): 'image' | 'audio' | 'video' | 'document' | 'custom' {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
  if (['mp3', 'wav', 'm4a', 'ogg', 'flac', 'mpga'].includes(ext)) return 'audio';
  if (['mp4', 'mov', 'mpeg', 'mpg', 'avi'].includes(ext)) return 'video';
  if (['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'txt', 'md', 'markdown', 'html', 'csv'].includes(ext)) return 'document';
  return 'custom';
}
