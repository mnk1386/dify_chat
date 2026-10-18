"use strict";
/**
 * Input validation schemas (zod) for all backend endpoints.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminSettingsSchema = exports.sttSchema = exports.ttsSchema = exports.workflowRunSchema = exports.variableUpdateSchema = exports.feedbackSchema = exports.renameSchema = exports.conversationIdSchema = exports.stopSchema = exports.chatSendSchema = exports.loginSchema = void 0;
exports.validate = validate;
exports.validateFileMeta = validateFileMeta;
exports.classifyFileType = classifyFileType;
const zod_1 = require("zod");
exports.loginSchema = zod_1.z.object({
    username: zod_1.z.string().min(1).max(64),
    password: zod_1.z.string().min(1).max(256),
});
exports.chatSendSchema = zod_1.z.object({
    query: zod_1.z.string().min(1, 'متن پیام نمی‌تواند خالی باشد').max(30000, 'طول پیام بیش از حد مجاز است'),
    conversationId: zod_1.z.string().max(128).nullable().optional(),
    files: zod_1.z.array(zod_1.z.object({
        type: zod_1.z.enum(['image', 'audio', 'video', 'document', 'custom']),
        transfer_method: zod_1.z.enum(['local_file', 'remote_url']),
        upload_file_id: zod_1.z.string().max(128).optional(),
        url: zod_1.z.string().url().max(2048).optional(),
    })).max(10).optional(),
    inputs: zod_1.z.record(zod_1.z.union([zod_1.z.string().max(4000), zod_1.z.number(), zod_1.z.boolean()])).optional(),
    clientMsgId: zod_1.z.string().max(64).optional(), // idempotency key to prevent accidental double sends
});
exports.stopSchema = zod_1.z.object({
    taskId: zod_1.z.string().min(1).max(128),
});
exports.conversationIdSchema = zod_1.z.string().min(1).max(128);
exports.renameSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(200),
});
exports.feedbackSchema = zod_1.z.object({
    rating: zod_1.z.enum(['like', 'dislike', 'null']),
    content: zod_1.z.string().max(1000).optional(),
});
exports.variableUpdateSchema = zod_1.z.object({
    value: zod_1.z.string().max(4000),
});
exports.workflowRunSchema = zod_1.z.object({
    inputs: zod_1.z.record(zod_1.z.union([zod_1.z.string().max(8000), zod_1.z.number(), zod_1.z.boolean()])),
});
exports.ttsSchema = zod_1.z.object({
    text: zod_1.z.string().min(1).max(4000),
    messageId: zod_1.z.string().max(128).optional(),
});
exports.sttSchema = zod_1.z.object({
    filename: zod_1.z.string().max(255),
    mimeType: zod_1.z.string().max(128),
});
exports.adminSettingsSchema = zod_1.z.object({
    difyBaseUrl: zod_1.z.string().max(512).optional(),
    difyApiKey: zod_1.z.string().max(256).optional(), // empty string == leave unchanged handled at route level
    difyTimeoutMs: zod_1.z.number().int().min(5000).max(600000).optional(),
    difyAppType: zod_1.z.enum(['chat', 'completion', 'workflow']).optional(),
    maxUploadSizeMb: zod_1.z.number().int().min(1).max(100).optional(),
    uiFont: zod_1.z.enum(['local', 'vazirmatn', 'system']).optional(),
    uiThemeDefault: zod_1.z.enum(['light', 'dark', 'auto']).optional(),
});
function validate(schema, data) {
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
        const first = parsed.error.errors[0];
        const err = new Error(first?.message || 'ورودی نامعتبر است');
        err.status = 400;
        err.code = 'invalid_input';
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
function validateFileMeta(filename, sizeBytes, maxMb) {
    const clean = filename.replace(/[\\/]/g, '');
    const ext = (clean.split('.').pop() || '').toLowerCase();
    if (!ext || ext === clean.toLowerCase())
        return { ok: false, reason: 'file_no_extension' };
    if (BLOCKED_EXTENSIONS.has(ext))
        return { ok: false, reason: 'blocked_type' };
    if (!ALLOWED_EXTENSIONS.has(ext))
        return { ok: false, reason: 'unsupported_type' };
    const maxBytes = maxMb * 1024 * 1024;
    if (sizeBytes <= 0)
        return { ok: false, reason: 'empty_file' };
    if (sizeBytes > maxBytes)
        return { ok: false, reason: 'too_large' };
    return { ok: true };
}
/** Classify file type for Dify `files[].type` field. */
function classifyFileType(filename) {
    const ext = (filename.split('.').pop() || '').toLowerCase();
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext))
        return 'image';
    if (['mp3', 'wav', 'm4a', 'ogg', 'flac', 'mpga'].includes(ext))
        return 'audio';
    if (['mp4', 'mov', 'mpeg', 'mpg', 'avi'].includes(ext))
        return 'video';
    if (['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'txt', 'md', 'markdown', 'html', 'csv'].includes(ext))
        return 'document';
    return 'custom';
}
//# sourceMappingURL=validation.js.map