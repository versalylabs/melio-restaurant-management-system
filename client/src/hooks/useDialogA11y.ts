import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/** Dialogs currently open, innermost last; only the top one handles keys. */
const openStack: HTMLElement[] = [];

/**
 * Page scroll is locked on <html> (not <body>): html has overflow-x: clip, so
 * a body overflow would not reach the viewport and would turn body into a
 * scroll container, un-pinning sticky headers. Saved once when the first
 * dialog opens and restored when the last one closes, whatever the order.
 */
let savedRootOverflow: string | null = null;
function lockScroll() {
  if (savedRootOverflow === null) {
    savedRootOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
  }
}
function unlockScrollIfIdle() {
  if (openStack.length === 0 && savedRootOverflow !== null) {
    document.documentElement.style.overflow = savedRootOverflow;
    savedRootOverflow = null;
  }
}

/** True when the dialog is mounted but hidden by CSS (e.g. an lg:hidden drawer after rotating). */
const isHidden = (node: HTMLElement) => node.getClientRects().length === 0;

/**
 * Makes an overlay behave like a real dialog:
 * - Escape closes it (only the top-most dialog when they are stacked);
 * - Tab / Shift+Tab stay inside it;
 * - focus moves into it on open and returns to the opener on close;
 * - the page behind does not scroll.
 *
 * Usage: const ref = useDialogA11y<HTMLDivElement>(onClose);
 *        <div ref={ref} role="dialog" aria-modal="true" aria-labelledby=...>
 */
export function useDialogA11y<T extends HTMLElement>(onClose?: () => void, { open = true }: { open?: boolean } = {}) {
  const ref = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const node = ref.current;
    if (!open || !node) return;

    const opener = document.activeElement as HTMLElement | null;
    openStack.push(node);
    lockScroll();

    // Focus the first field (or the dialog itself) unless something inside
    // already asked for focus via autoFocus.
    if (!node.contains(document.activeElement)) {
      // A field marked data-autofocus wins even when another field comes first.
      const first =
        node.querySelector<HTMLElement>('[data-autofocus]') ||
        node.querySelector<HTMLElement>('input, select, textarea') ||
        node.querySelector<HTMLElement>(FOCUSABLE);
      (first || node).focus({ preventScroll: true });
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (openStack[openStack.length - 1] !== node) return;
      // A drawer hidden by a breakpoint must not keep trapping the keyboard.
      if (isHidden(node)) return;
      if (event.key === 'Escape' && onCloseRef.current) {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!items.length) {
        event.preventDefault();
        node.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !node.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      const index = openStack.lastIndexOf(node);
      if (index >= 0) openStack.splice(index, 1);
      unlockScrollIfIdle();
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [open]);

  return ref;
}
