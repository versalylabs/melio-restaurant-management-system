/**
 * In-app replacements for the browser's alert / confirm / prompt.
 *
 *   if (!(await confirmDialog('Delete this recipe?'))) return;
 *   const reason = await promptDialog('Refund reason:', { required: true });
 *   notify('Could not save', 'error');
 *
 * They render through <DialogHost /> (mounted once in main.tsx) as accessible
 * dialogs and toasts that match the app, work in installed/PWA mode, and
 * don't block the page (so realtime updates keep flowing while one is open).
 */

export type NoticeTone = 'info' | 'success' | 'error';

export interface ConfirmRequest {
  kind: 'confirm';
  id: number;
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger: boolean;
  resolve: (ok: boolean) => void;
}

export interface PromptRequest {
  kind: 'prompt';
  id: number;
  message: string;
  title?: string;
  defaultValue?: string;
  placeholder?: string;
  required: boolean;
  multiline: boolean;
  confirmLabel?: string;
  resolve: (value: string | null) => void;
}

export interface ApprovalRequest {
  kind: 'approval';
  id: number;
  /** What is being approved, e.g. "A manager's approval is needed to refund a payment." */
  message: string;
  /** Shown in red, e.g. after a wrong PIN. */
  error?: string;
  branchId?: string;
  lastApproverId?: string;
  resolve: (value: { approverId: string; pin: string } | null) => void;
}

export type DialogRequest = ConfirmRequest | PromptRequest | ApprovalRequest;

export interface Notice {
  id: number;
  message: string;
  tone: NoticeTone;
}

type Listener = () => void;

let nextId = 1;
let dialogs: DialogRequest[] = [];
let notices: Notice[] = [];
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((listener) => listener());

export const dialogStore = {
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getDialogs: () => dialogs,
  getNotices: () => notices,
  settle(id: number) {
    dialogs = dialogs.filter((d) => d.id !== id);
    emit();
  },
  /** Answers every open dialog with "cancel" (used when the page changes). */
  cancelAll() {
    const pending = dialogs;
    dialogs = [];
    emit();
    pending.forEach((d) => (d.kind === 'confirm' ? d.resolve(false) : d.resolve(null)));
  },
  dismissNotice(id: number) {
    notices = notices.filter((n) => n.id !== id);
    emit();
  },
};

const DANGER_WORDS = /\b(delete|remove|deactivate|cancel|refund|discard)\b/i;

export function confirmDialog(
  message: string,
  options: { title?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean } = {}
): Promise<boolean> {
  return new Promise((resolve) => {
    dialogs = [
      ...dialogs,
      {
        kind: 'confirm',
        id: nextId++,
        message,
        title: options.title,
        confirmLabel: options.confirmLabel,
        cancelLabel: options.cancelLabel,
        danger: options.danger ?? DANGER_WORDS.test(message),
        resolve,
      },
    ];
    emit();
  });
}

/** Resolves to the entered text, or null when cancelled (like window.prompt). */
export function promptDialog(
  message: string,
  options: { title?: string; defaultValue?: string; placeholder?: string; required?: boolean; multiline?: boolean; confirmLabel?: string } = {}
): Promise<string | null> {
  return new Promise((resolve) => {
    dialogs = [
      ...dialogs,
      {
        kind: 'prompt',
        id: nextId++,
        message,
        title: options.title,
        defaultValue: options.defaultValue,
        placeholder: options.placeholder,
        required: options.required ?? false,
        multiline: options.multiline ?? false,
        confirmLabel: options.confirmLabel,
        resolve,
      },
    ];
    emit();
  });
}

/** A short, non-blocking message in the corner of the screen. */
export function notify(message: string, tone: NoticeTone = 'error') {
  const id = nextId++;
  notices = [...notices.slice(-3), { id, message, tone }];
  emit();
  setTimeout(() => dialogStore.dismissNotice(id), tone === 'error' ? 7000 : 4000);
}

/** Asks a manager to pick their name and enter their PIN. Resolves null when cancelled. */
export function approvalDialog(
  message: string,
  options: { error?: string; branchId?: string; lastApproverId?: string } = {}
): Promise<{ approverId: string; pin: string } | null> {
  return new Promise((resolve) => {
    dialogs = [...dialogs, { kind: 'approval', id: nextId++, message, ...options, resolve }];
    emit();
  });
}
