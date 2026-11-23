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
