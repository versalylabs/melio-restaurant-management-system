import type { Approval } from '../services/api';
import { approvalDialog } from './dialogs';

/** Thrown when the person closes the manager PIN dialog; callers just stop. */
export class ApprovalCancelled extends Error {
  constructor() {
    super('Approval cancelled');
    this.name = 'ApprovalCancelled';
  }
}

export const isApprovalCancelled = (err: unknown) => err instanceof ApprovalCancelled;

const approvalCode = (err: any): string | undefined => err?.response?.data?.errors?.approval?.[0];

/**
 * Runs a request that may need a manager's PIN (voids after the kitchen has
 * the order, discounts above your limit, refunds). The first attempt goes
 * without approval; if the server asks for one, the PIN dialog opens and the
 * request is retried with it. A wrong PIN re-opens the dialog with the
 * server's message. Closing the dialog throws ApprovalCancelled.
 *
 *   await withApproval((approval) => paymentApi.refundPayment(id, { reason, approval }));
 */
export async function withApproval<T>(run: (approval?: Approval) => Promise<T>, options: { branchId?: string } = {}): Promise<T> {
  let approval: Approval | undefined;
  let message = '';
  for (;;) {
    try {
      return await run(approval);
    } catch (err: any) {
      const code = approvalCode(err);
      if (code !== 'APPROVAL_REQUIRED' && code !== 'APPROVAL_INVALID') throw err;
      const serverMessage: string = err.response?.data?.message || "A manager's approval is needed.";
      if (code === 'APPROVAL_REQUIRED') message = serverMessage;
      const answer = await approvalDialog(message || "A manager's approval is needed.", {
        error: code === 'APPROVAL_INVALID' ? serverMessage : undefined,
        branchId: options.branchId,
        lastApproverId: approval?.approverId,
      });
      if (!answer) throw new ApprovalCancelled();
      approval = answer;
    }
  }
}
