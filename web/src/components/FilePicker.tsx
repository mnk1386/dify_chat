/**
 * File attachment UI: pick files, show name/type/size, upload progress via backend
 * (proxied to Dify /files/upload), remove before sending, image previews.
 * Limits come from Dify /parameters (via backend) + backend hard limits.
 */

import React, { useCallback, useRef, useState } from 'react';
import { ApiError, chatApi } from '../api/client';
import type { FileUploadLimits, UiFile } from '../types';
import { t, formatBytesFa } from '../i18n/fa';

interface Props {
  files: UiFile[];
  onChange: (files: UiFile[]) => void;
  limits: FileUploadLimits | null;
  disabled?: boolean;
}

const ALLOWED_EXT = /\.(png|jpe?g|gif|webp|svg|pdf|docx?|pptx?|xlsx?|csv|txt|md|markdown|html|mp3|wav|m4a|ogg|flac|mpga|mp4|mov|mpeg|mpg|avi)$/i;

let fid = 0;
const localId = () => `f${Date.now().toString(36)}_${fid++}`;

export function validateClientSide(file: File, limits: FileUploadLimits | null): string | null {
  if (!ALLOWED_EXT.test(file.name)) return t.files.wrongType;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext);
  const isAudio = ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'mpga'].includes(ext);
  const isVideo = ['mp4', 'mov', 'mpeg', 'mpg', 'avi'].includes(ext);
  let maxMb: number | null = limits?.file_size_limit_mb ?? null;
  if (isImage && limits?.image_file_size_limit_mb != null) maxMb = limits.image_file_size_limit_mb;
  if (isAudio && limits?.audio_file_size_limit_mb != null) maxMb = limits.audio_file_size_limit_mb;
  if (isVideo && limits?.video_file_size_limit_mb != null) maxMb = limits.video_file_size_limit_mb;
  if (maxMb && file.size > maxMb * 1024 * 1024) {
    return `${t.files.tooLarge} (حداکثر ${maxMb.toLocaleString('fa-IR')} مگابایت)`;
  }
  if (file.size === 0) return 'فایل خالی است.';
  return null;
}

export function classifyExt(filename: string): UiFile['fileType'] {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'image';
  if (['mp3', 'wav', 'm4a', 'ogg', 'flac', 'mpga'].includes(ext)) return 'audio';
  if (['mp4', 'mov', 'mpeg', 'mpg', 'avi'].includes(ext)) return 'video';
  if (['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'txt', 'md', 'markdown', 'html', 'csv'].includes(ext)) return 'document';
  return 'custom';
}

export function FilePicker({ files, onChange, limits, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const maxCount = Math.max(1, limits?.enabled === false ? 1 : (limits?.number_limits || 1));

  const startUpload = useCallback((uf: UiFile, file: File) => {
    chatApi.uploadFile(file, (pct) => {
      onChangeRef.current(filesRef.current.map((f) => (f.id === uf.id ? { ...f, progress: pct } : f)));
    })
      .then((res) => {
        onChangeRef.current(filesRef.current.map((f) => (f.id === uf.id ? { ...f, uploading: false, progress: 100, difyId: res.id } : f)));
      })
      .catch((e: unknown) => {
        const msg = e instanceof ApiError ? e.message : t.files.uploadFailed;
        onChangeRef.current(filesRef.current.map((f) => (f.id === uf.id ? { ...f, uploading: false, error: msg } : f)));
        setNotice(msg);
      });
  }, []);

  // refs to avoid stale closures inside async callbacks
  const filesRef = useRef(files); filesRef.current = files;
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;

  const addFiles = useCallback((list: FileList | File[]) => {
    setNotice(null);
    const incoming = Array.from(list);
    const room = maxCount - filesRef.current.length;
    if (room <= 0) { setNotice(t.files.limitReached); return; }
    const accepted: UiFile[] = [];
    for (const file of incoming.slice(0, room)) {
      const err = validateClientSide(file, limits);
      const fileType = classifyExt(file.name);
      const uf: UiFile = {
        id: localId(), name: file.name.replace(/[\\/]/g, ''), size: file.size,
        mime: file.type || 'application/octet-stream', fileType,
        uploading: !err, progress: 0, ...(err ? { error: err } : {}),
        previewUrl: !err && fileType === 'image' && file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
      };
      accepted.push(uf);
      if (!err) startUpload(uf, file);
    }
    if (incoming.length > room) setNotice(t.files.limitReached);
    onChangeRef.current([...filesRef.current, ...accepted]);
  }, [limits, maxCount, startUpload]);

  const remove = useCallback((id: string) => {
    const target = filesRef.current.find((f) => f.id === id);
    if (target?.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(target.previewUrl);
    onChangeRef.current(filesRef.current.filter((f) => f.id !== id));
  }, []);

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        multiple={maxCount > 1}
        className="sr-only"
        aria-label={t.files.attach}
        onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
      />
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-live="polite">
          {files.map((f) => (
            <li key={f.id} className={`flex items-center gap-2 rounded-xl border px-2 py-1.5 text-sm max-w-full ${f.error ? 'border-red-400 bg-red-50 dark:bg-red-950/40 dark:border-red-700' : 'border-slate-200 bg-white dark:bg-slate-800 dark:border-slate-700'}`}>
              {f.previewUrl ? (
                <img src={f.previewUrl} alt={f.name} className="h-10 w-10 rounded-lg object-cover" />
              ) : (
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-slate-100 dark:bg-slate-700 text-lg" aria-hidden="true">📎</span>
              )}
              <div className="min-w-0 flex-1">
                <p dir="ltr" className="truncate text-right font-medium" title={f.name}>{f.name}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {formatBytesFa(f.size)}
                  {f.uploading && <span className="ms-2">{t.files.uploading} {f.progress > 0 ? `${Math.round(f.progress / 100 * 100) === f.progress ? '' : ''}${toFaPct(f.progress)}` : ''}</span>}
                  {f.error && <span className="ms-2 text-red-600 dark:text-red-400">{f.error}</span>}
                </p>
                {f.uploading && (
                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-600" role="progressbar" aria-valuenow={f.progress} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${f.progress}%` }} />
                  </div>
                )}
              </div>
              <button type="button" onClick={() => remove(f.id)} className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-red-500 dark:hover:bg-slate-700" aria-label={`${t.files.remove}: ${f.name}`} disabled={disabled}>✕</button>
            </li>
          ))}
        </ul>
      )}
      {notice && <p className="text-xs text-amber-600 dark:text-amber-400" role="alert">{notice}</p>}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || files.length >= maxCount}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files) addFiles(e.dataTransfer.files); }}
        className={`inline-flex items-center gap-1.5 rounded-lg border border-dashed px-3 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${dragOver ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20' : 'border-slate-300 dark:border-slate-600 hover:border-brand-400'}`}
      >
        <span aria-hidden="true">📎</span> {t.files.attach}
        {maxCount > 1 && <span className="text-xs text-slate-400">({toFaPct(maxCount).replace('%', '')} فایل حداکثر)</span>}
      </button>
    </div>
  );
}

function toFaPct(n: number): string {
  const map = ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'];
  return `${String(n).replace(/[0-9]/g, (d) => map[Number(d)])}%`;
}
