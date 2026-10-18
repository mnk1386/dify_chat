/**
 * Application error types and Persian user-facing messages.
 * Stack traces are never exposed to clients; technical details go to logs/events.
 */

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    public userMessage: string,
    public detail?: string,
  ) { super(detail || userMessage); }
}

export class DifyApiError extends AppError {
  constructor(status: number, code: string, serverMessage?: string) {
    super(status, `dify_${code}`, difyMessageFa(code, serverMessage), serverMessage);
    this.difyCode = code;
  }
  difyCode: string;
}

function difyMessageFa(code: string, serverMessage?: string): string {
  const map: Record<string, string> = {
    unauthorized: 'کلید API معتبر نیست یا منقضی شده است. با مدیر سامانه تماس بگیرید.',
    forbidden: 'دسترسی به این عملیات مجاز نیست.',
    not_found: 'منظور درخواستی (مکالمه یا پیام) یافت نشد.',
    bad_request: 'درخواست نامعتبر است. ورودی‌ها را بررسی کنید.',
    conversation_not_found: 'مکالمه موردنظر یافت نشد یا متعلق به شما نیست.',
    completed_message_quota_exceeded: 'سهم استفاده از مدل تکمیل شده است.',
    provider_not_initialize: 'ارائه‌دهنده مدل در تنظیمات Dify پیکربندی نشده است.',
    model_not_found: 'مدل انتخاب‌شده در دسترس نیست.',
    invalid_param: 'پارامتر درخواست نامعتبر است.',
    no_prompt_available: 'متن راهنمای برنامه در تنظیمات Dify تعریف نشده است.',
    file_too_large: 'حجم فایل بیش از حد مجاز است.',
    unsupported_file_type: 'نوع فایل پشتیبانی نمی‌شود.',
    too_many_requests: 'تعداد درخواست‌ها بیش از حد مجاز است. کمی صبر کنید و دوباره تلاش کنید.',
    timeout: 'مهلت اتصال به سرویس هوش مصنوعی به پایان رسید. دوباره تلاش کنید.',
    network_error: 'ارتباط با سرویس هوش مصنوعی برقرار نشد. اتصال شبکه را بررسی کنید.',
    not_configured: 'تنظیمات اتصال به Dify کامل نیست؛ مدیر باید آدرس و کلید API را تنظیم کند.',
    tts_no_provider: 'سرویس تبدیل متن به گفتار در این برنامه فعال نیست.',
    speech_to_text_no_provider: 'سرویس تبدیل گفتار به متن در این برنامه فعال نیست.',
    invalid_response: 'پاسخ نامعتبر از سرویس دریافت شد.',
    no_stream: 'جریان پاسخ قابل بازخوانی نیست.',
    server_error: 'خطای داخلی در سرویس هوش مصنوعی رخ داد. بعداً دوباره تلاش کنید.',
  };
  const normalized = code.replace(/^dify_/, '');
  if (map[normalized]) return map[normalized];
  // Never leak raw internal server messages to users; keep a generic fallback.
  return 'خطایی در ارتباط با سرویس هوش مصنوعی رخ داد. در صورت تکرار با مدیر سامانه تماس بگیرید.';
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
