/**
 * Persian UI strings in one place (simple i18n module — the app is Persian-first,
 * but keeping strings centralized makes future localization easy).
 */

export const t = {
  app: {
    title: 'دستیار هوشمند چت',
    subtitle: 'سامانه گفت‌وگوی سازمانی متصل به Dify',
    loading: 'در حال بارگذاری…',
  },
  auth: {
    login: 'ورود به سامانه',
    username: 'نام کاربری',
    password: 'رمز عبور',
    submit: 'ورود',
    loggingIn: 'در حال ورود…',
    invalid: 'نام کاربری یا رمز عبور نادرست است.',
    logout: 'خروج',
    providerHeader: 'احراز هویت',
    signedHeaderHint: 'احراز هویت از طریق درگاه سازمانی انجام می‌شود.',
  },
  chat: {
    newChat: 'گفت‌وگوی جدید',
    placeholder: 'پیام خود را بنویسید…',
    send: 'ارسال',
    sending: 'در حال ارسال…',
    generating: 'در حال تولید پاسخ…',
    stop: 'توقف',
    stopped: 'پاسخ متوقف شد.',
    thinking: 'دستیار در حال فکر کردن…',
    copy: 'کپی',
    copied: 'کپی شد',
    copyCode: 'کپی کد',
    like: 'پسندیدم',
    dislike: 'نپسندیدم',
    feedbackTitle: 'ثبت بازخورد',
    feedbackPlaceholder: 'توضیح اختیاری درباره پاسخ…',
    feedbackSave: 'ثبت',
    feedbackSaved: 'بازخورد ثبت شد.',
    regenerate: 'ارسال مجدد سؤال',
    regenerateHint: 'با توجه به محدودیت API، سؤال دوباره به‌عنوان درخواست جدید ارسال می‌شود.',
    retry: 'تلاش مجدد',
    suggested: 'سؤال‌های پیشنهادی',
    emptyTitle: 'گفت‌وگو را شروع کنید',
    emptyHint: 'سؤال خود را بپرسید یا از سؤالات پیشنهادی استفاده کنید.',
    offlineBanner: 'اتصال به سرویس هوش مصنوعی برقرار نیست. تلاش مجدد…',
    connectionDown: 'سرویس در دسترس نیست',
    statusConnected: 'متصل',
    statusDisconnected: 'قطع',
    statusChecking: 'بررسی…',
    notConfigured: 'اتصال به Dify پیکربندی نشده است. با مدیر سامانه تماس بگیرید.',
    networkError: 'ارتباط شبکه با سرور قطع شد. اتصال خود را بررسی کنید.',
    errorPrefix: 'خطا:',
    sources: 'منابع',
    attachments: 'پیوست‌ها',
    charLimit: 'حداکثر طول پیام ۳۰٬۰۰۰ نویسه است.',
    autoScrollOn: 'اسکرول خودکار روشن',
    autoScrollOff: 'اسکرول خودکار خاموش',
    scrollToEnd: 'رفتن به انتهای پیام',
    micStart: 'شروع ضبط صدا',
    micStop: 'توقف ضبط',
    transcribing: 'در حال تبدیل گفتار به متن…',
    micUnsupported: 'مرورگر شما از ضبط صدا پشتیبانی نمی‌کند.',
    micDenied: 'دسترسی میکروفون رد شد. از تنظیمات مرورگر اجازه دهید.',
    ttsPlay: 'پخش صوت پاسخ',
    ttsStop: 'توقف پخش',
    ttsLoading: 'در حال آماده‌سازی صوت…',
    ttsUnavailable: 'امکان تبدیل متن به گفتار برای این برنامه فعال نیست.',
    sttUnavailable: 'امکان تبدیل گفتار به متن برای این برنامه فعال نیست.',
  },
  sidebar: {
    history: 'تاریخچه گفت‌وگوها',
    search: 'جست‌وجو در گفت‌وگوها…',
    searchLocalNote: 'جست‌وجو روی فهرست محلی انجام می‌شود.',
    empty: 'گفت‌وگویی وجود ندارد.',
    loadMore: 'بارگذاری بیشتر',
    rename: 'تغییر نام',
    renamePrompt: 'نام جدید گفت‌وگو:',
    delete: 'حذف',
    deleteConfirm: 'آیا از حذف این گفت‌وگو مطمئن هستید؟ این عمل قابل بازگشت نیست.',
    deleted: 'گفت‌وگو حذف شد.',
    renamed: 'نام گفت‌وگو تغییر کرد.',
    collapse: 'جمع کردن پنل',
    expand: 'باز کردن پنل',
    loadError: 'بارگذاری تاریخچه با خطا مواجه شد.',
    today: 'امروز',
    yesterday: 'دیروز',
    week: 'هفته اخیر',
    older: 'قدیمی‌تر',
  },
  files: {
    attach: 'پیوست فایل',
    remove: 'حذف فایل',
    uploading: 'در حال بارگذاری…',
    tooLarge: `حجم فایل بیش از حد مجاز است.`,
    wrongType: 'نوع فایل پشتیبانی نمی‌شود.',
    limitReached: 'به حداکثر تعداد فایل مجاز رسیدید.',
    uploadFailed: 'بارگذاری فایل ناموفق بود.',
  },
  admin: {
    title: 'تنظیمات مدیریتی',
    connection: 'اتصال به Dify',
    baseUrl: 'آدرس پایه Dify',
    baseUrlHint: 'مثال: http://dify.internal/v1',
    apiKey: 'کلید API برنامه',
    apiKeySet: 'کلید API ذخیره شده است (برای تغییر، مقدار جدید وارد کنید).',
    apiKeyNeverShown: 'کلید API هرگز نمایش داده نمی‌شود و فقط در سرور نگهداری می‌شود.',
    appType: 'نوع برنامه Dify',
    appTypes: { chat: 'چت (Chatbot/Chatflow)', completion: 'تکمیل متن (Completion)', workflow: 'گردش کار (Workflow)' },
    timeout: 'مهلت زمانی درخواست (میلی‌ثانیه)',
    maxUpload: 'حداکثر حجم فایل (مگابایت)',
    appearance: 'ظاهر',
    font: 'فونت رابط',
    fonts: { vazirmatn: 'وزیرمتن (محلی)', local: 'فونت محلی سازمانی', system: 'فونت سیستم' },
    theme: 'پوسته پیش‌فرض',
    themes: { light: 'روشن', dark: 'تاریک', auto: 'خودکار' },
    testConnection: 'بررسی اتصال',
    testing: 'در حال بررسی…',
    testOk: 'اتصال موفق است.',
    save: 'ذخیره تنظیمات',
    saved: 'تنظیمات ذخیره شد.',
    events: 'رویدادهای فنی',
    refreshEvents: 'نوسازی',
    noEvents: 'رویدادی ثبت نشده است.',
    apiStatus: 'وضعیت API',
    versions: 'نسخه‌ها',
    accessDenied: 'دسترسی به این بخش فقط برای مدیر مجاز است.',
  },
  nav: {
    chat: 'گفت‌وگو',
    settings: 'تنظیمات',
  },
  common: {
    close: 'بستن',
    cancel: 'انصراف',
    confirm: 'تأیید',
    ok: 'باشه',
    time: 'زمان',
    justNow: 'همین حالا',
    minutesAgo: 'دقیقه پیش',
    hoursAgo: 'ساعت پیش',
    daysAgo: 'روز پیش',
    kb: 'کیلوبایت',
    mb: 'مگابایت',
  },
};

/** Format unix seconds/ms into a Persian-friendly relative or absolute time. */
export function formatTime(tsSecondsOrMs: number): string {
  // heuristic: values above 1e12 are ms
  const ms = tsSecondsOrMs > 1e12 ? tsSecondsOrMs : tsSecondsOrMs * 1000;
  const d = new Date(ms);
  try {
    return new Intl.DateTimeFormat('fa-IR', {
      calendar: 'persian',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  } catch {
    return d.toLocaleString();
  }
}

export function relativeTimeFa(ts: number): string {
  const ms = ts > 1e12 ? ts : ts * 1000;
  const diff = Date.now() - ms;
  if (diff < 60_000) return t.common.justNow;
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${toFa(mins)} ${t.common.minutesAgo}`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${toFa(hours)} ${t.common.hoursAgo}`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${toFa(days)} ${t.common.daysAgo}`;
  return formatTime(ms);
}

/** Convert ASCII digits to Persian digits for display. */
export function toFa(input: string | number): string {
  const map = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  return String(input).replace(/[0-9]/g, (d) => map[Number(d)]);
}

export function formatBytesFa(bytes: number): string {
  if (bytes < 1024) return `${toFa(bytes)} بایت`;
  if (bytes < 1024 * 1024) return `${toFa(Math.round(bytes / 1024))} ${t.common.kb}`;
  return `${toFa((bytes / (1024 * 1024)).toFixed(1))} ${t.common.mb}`;
}
