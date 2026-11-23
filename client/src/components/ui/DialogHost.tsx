import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { dialogStore, type ConfirmRequest, type PromptRequest } from '../../lib/dialogs';
import { useDialogA11y } from '../../hooks/useDialogA11y';
import Button from './Button';

function DialogFrame({ title, onCancel, children }: { title: string; onCancel: () => void; children: React.ReactNode }) {
  const titleId = useId();
  const ref = useDialogA11y<HTMLDivElement>(onCancel);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-md rounded-2xl border border-orange-500/20 bg-white p-6 text-gray-900 shadow-2xl outline-none dark:border-white/15 dark:bg-[#121218] dark:text-gray-100"
      >
        <h2 id={titleId} className="text-base font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function ConfirmView({ request }: { request: ConfirmRequest }) {
  const finish = (ok: boolean) => {
    dialogStore.settle(request.id);
    request.resolve(ok);
  };
  return (
    <DialogFrame title={request.title || 'Please confirm'} onCancel={() => finish(false)}>
      <p className="mt-2 whitespace-pre-line text-sm text-gray-600 dark:text-gray-300">{request.message}</p>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={() => finish(false)} {...(request.danger ? { 'data-autofocus': true } : {})}>{request.cancelLabel || 'Cancel'}</Button>
        <Button variant={request.danger ? 'danger' : 'primary'} onClick={() => finish(true)} {...(request.danger ? {} : { 'data-autofocus': true })}>
          {request.confirmLabel || 'Confirm'}
        </Button>
      </div>
    </DialogFrame>
  );
}

function PromptView({ request }: { request: PromptRequest }) {
  const [value, setValue] = useState(request.defaultValue || '');
  const inputId = useId();
  const finish = (result: string | null) => {
    dialogStore.settle(request.id);
    request.resolve(result);
  };
  const canSubmit = !request.required || value.trim().length > 0;
  return (
    <DialogFrame title={request.title || request.message} onCancel={() => finish(null)}>
      <form
        className="mt-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) finish(value);
        }}
      >
        <label htmlFor={inputId} className={request.title ? 'mb-1 block text-sm text-gray-600 dark:text-gray-300' : 'sr-only'}>
          {request.message}
        </label>
        {request.multiline ? (
          <textarea
            id={inputId}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={request.placeholder}
            rows={3}
            data-autofocus
            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/30 dark:border-white/15 dark:bg-[#0d0d11]"
          />
        ) : (
          <input
            id={inputId}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={request.placeholder}
            data-autofocus
            className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/30 dark:border-white/15 dark:bg-[#0d0d11]"
          />
        )}
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => finish(null)}>Cancel</Button>
          <Button type="submit" disabled={!canSubmit}>{request.confirmLabel || 'OK'}</Button>
        </div>
      </form>
    </DialogFrame>
  );
}

const TONE = {
  error: { icon: AlertCircle, className: 'border-red-500/30 bg-red-50 text-red-800 dark:bg-red-950/90 dark:text-red-200' },
  success: { icon: CheckCircle2, className: 'border-emerald-500/30 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/90 dark:text-emerald-200' },
  info: { icon: Info, className: 'border-orange-500/30 bg-white text-gray-800 dark:bg-[#121218] dark:text-gray-100' },
};

/** Renders confirmDialog / promptDialog / notify. Mount once near the root. */
export default function DialogHost() {
  const dialogs = useSyncExternalStore(dialogStore.subscribe, dialogStore.getDialogs);
  const notices = useSyncExternalStore(dialogStore.subscribe, dialogStore.getNotices);

  const { pathname } = useLocation();
  const firstPath = useRef(pathname);
  useEffect(() => {
    if (pathname === firstPath.current) return;
    firstPath.current = pathname;
    dialogStore.cancelAll();
  }, [pathname]);

  const current = dialogs[0];
  return (
    <>
      {current?.kind === 'confirm' && <ConfirmView key={current.id} request={current} />}
      {current?.kind === 'prompt' && <PromptView key={current.id} request={current} />}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[80] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6" aria-live="polite" role="status">
        {notices.map((notice) => {
          const tone = TONE[notice.tone];
          const Icon = tone.icon;
          return (
            <div key={notice.id} className={`pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-xl border px-4 py-3 text-sm shadow-lg ${tone.className}`}>
              <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="flex-1">{notice.message}</span>
              <button type="button" aria-label="Dismiss" onClick={() => dialogStore.dismissNotice(notice.id)} className="-m-1 rounded p-1 opacity-70 hover:opacity-100">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
