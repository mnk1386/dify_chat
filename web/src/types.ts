/**
 * Shared TypeScript types for the frontend. These mirror the backend API contract
 * (see server/src/routes/*). The browser never talks to Dify directly.
 */

export interface UserInfo {
  id: string;
  username: string;
  displayName: string | null;
  role: 'user' | 'admin';
}

export interface AppStatus {
  configured: boolean;
  connected: boolean;
  appName: string | null;
  appDescription: string | null;
  siteTitle: string | null;
  appType: 'chat' | 'completion' | 'workflow';
  error: string | null;
  errorCode: string | null;
}

export interface FileUploadLimits {
  enabled: boolean;
  number_limits: number;
  image_file_size_limit_mb: number | null;
  audio_file_size_limit_mb: number | null;
  video_file_size_limit_mb: number | null;
  file_size_limit_mb: number | null;
  file_upload_limit: number | null;
}

export interface AppParameters {
  opening_statement: string;
  suggested_questions: string[];
  user_input_form: UserInputFormItem[];
  file_upload: FileUploadLimits;
  tts_available: boolean;
}

export interface UserInputFormItem {
  // Dify returns a list of single-key objects, e.g. { text_field: { variable, label, required, ... } }
  [key: string]: Record<string, unknown>;
}

export interface ConversationSummary {
  id: string;
  name: string;
  created_at: number; // unix seconds
}

export interface ConversationListResponse {
  data: ConversationSummary[];
  has_more: boolean;
  mode?: 'local_index_search' | 'local_index_fallback';
}

export interface DifyMessageRecord {
  id: string;
  conversation_id?: string;
  query?: string;
  answer?: string;
  created_at: number;
  feedback?: { rating: 'like' | 'dislike' } | null;
  message_files?: MessageFileRef[];
  retriever_resources?: RetrieverResource[];
}

export interface MessagesResponse {
  data: DifyMessageRecord[];
  has_more: boolean;
}

export interface MessageFileRef {
  id?: string;
  type?: string;
  url?: string;
  belongs_to?: string;
}

export interface RetrieverResource {
  position?: number;
  dataset_name?: string;
  document_name?: string;
  segment_id?: string;
  score?: number;
  content?: string;
}

export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  mime_type: string;
  extension: string;
  file_type: 'image' | 'audio' | 'video' | 'document' | 'custom';
}

/* ---------- Chat message model (UI) ---------- */

export type MessageStatus = 'sending' | 'streaming' | 'done' | 'error' | 'stopped';

export interface UiFile {
  id: string;            // local preview id or uploaded dify id
  difyId?: string;       // set after upload
  name: string;
  size: number;
  mime: string;
  fileType: 'image' | 'audio' | 'video' | 'document' | 'custom';
  previewUrl?: string;   // object URL for images chosen locally
  uploading: boolean;
  progress: number;      // 0..100 (best effort)
  error?: string;
}

export interface UiMessage {
  localId: string;
  difyMessageId?: string;
  role: 'user' | 'assistant';
  content: string;
  status: MessageStatus;
  errorText?: string;
  retryable?: boolean;
  createdAt: number;    // ms
  files?: UiFile[];     // attached files (user msg) / returned refs (assistant)
  taskId?: string;      // for stop
  feedback?: 'like' | 'dislike' | null;
  retrieverResources?: RetrieverResource[];
  usage?: Record<string, unknown>;
  query?: string;       // original question kept for regenerate/error recovery
}

/* ---------- SSE frames relayed by backend (POST /api/chat/send) ---------- */

export interface StreamDeltaFrame { event: 'delta'; answer: string; conversation_id?: string; message_id?: string; task_id?: string }
export interface StreamEndFrame {
  event: 'end';
  conversation_id?: string;
  message_id?: string;
  usage?: Record<string, unknown>;
  reference?: unknown;
  retriever_resources?: RetrieverResource[];
  note?: string;
}
export interface StreamErrorFrame { event: 'error'; code?: string; message?: string }
export interface AppErrorFrame { event: 'app_error'; code?: string; message?: string; retryable?: boolean }
export interface StreamEndFrameFinal { event: 'stream_end'; stream_id?: string }
export interface MessageFileFrame { event: 'message_file'; id?: string; type?: string; url?: string; belongs_to?: string }
export interface WorkflowEventFrame { event: string; data?: unknown; task_id?: string }

export type StreamFrame =
  | StreamDeltaFrame | StreamEndFrame | StreamErrorFrame | AppErrorFrame
  | StreamEndFrameFinal | MessageFileFrame | WorkflowEventFrame;

/* ---------- Admin ---------- */

export interface AdminSettings {
  difyBaseUrl: string;
  apiKeySet: boolean;
  apiKeyMasked: string;
  difyTimeoutMs: number;
  difyAppType: 'chat' | 'completion' | 'workflow';
  maxUploadSizeMb: number;
  uiFont: 'local' | 'vazirmatn' | 'system';
  uiThemeDefault: 'light' | 'dark' | 'auto';
  authProvider: string;
  versions: { node: string; server: string };
}

export interface TestConnectionResult {
  ok: boolean;
  appName: string | null;
  appDescription: string | null;
  siteTitle: string | null;
  error: string | null;
  errorCode: string | null;
}

export interface EventRow {
  id: number;
  created_at: number;
  level: string;
  type: string;
  user_id: string | null;
  request_id: string | null;
  detail: string;
}

export interface ApiErrorBody {
  error?: { code?: string; message?: string; requestId?: string };
}
