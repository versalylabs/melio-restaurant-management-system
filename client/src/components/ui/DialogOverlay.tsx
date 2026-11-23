import React from 'react';
import { useDialogA11y } from '../../hooks/useDialogA11y';

interface DialogOverlayProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Called on Escape. */
  onClose: () => void;
  /** Accessible name when there is no visible heading to point at. */
  label: string;
}

/**
 * Full-screen overlay for custom-styled modals and drawers. Gives them the
 * same behaviour as <Modal>: role="dialog", Escape to close, focus kept
 * inside and returned to the opener, and no background scrolling.
 */
export default function DialogOverlay({ onClose, label, children, ...rest }: DialogOverlayProps) {
  const ref = useDialogA11y<HTMLDivElement>(onClose);
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} {...rest} style={{ outline: 'none', ...rest.style }}>
      {children}
    </div>
  );
}
