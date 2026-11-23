import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Escapes text for insertion into HTML strings (printed receipts, tickets).
 * Item names, branch names etc. are user-editable and must never be written
 * raw into a same-origin popup, where a script could read the staff session.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c] || c));
}

/**
 * One-off ID for an order attempt. Sent as `clientRequestId` and reused on
 * every retry (including the offline queue), so the server never creates the
 * same order twice.
 */
export function newRequestId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch { /* fall through */ }
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}
