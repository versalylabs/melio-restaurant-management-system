import { escapeHtml } from './utils';

const kes = (n: number | null | undefined) => `KES ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The printable customer receipt, shared by the Orders and Payments pages.
 *
 * It shows the KRA PIN and VAT when the business is VAT-registered, and any
 * credit notes (refunds) against the bill. It never calls itself a "tax
 * invoice" or an eTIMS receipt: Melio is not a KRA-certified system.
 */
export function receiptHtml(data: any): string {
  const sale = data.sale;
  const receipt = data.receipt;
  const tax = data.tax || {};
  const creditNotes: any[] = data.creditNotes || [];
  const vatPct = Math.round((Number(tax.vatRate) || 0) * 10000) / 100;
  // Only a VAT-registered business may call it VAT on a receipt.
  const taxLabel = tax.vatRegistered ? `VAT ${vatPct}%` : 'Tax';

  const rows = (sale.items || [])
    .map((i: any) => `<tr><td>${escapeHtml(i.quantity)} × ${escapeHtml(i.itemNameSnapshot)}</td><td class="r">${kes(i.subtotal)}</td></tr>`)
    .join('');
  const line = (label: string, value: string, cls = '') => `<tr class="${cls}"><td>${escapeHtml(label)}</td><td class="r">${value}</td></tr>`;
  const totals = [
    line('Subtotal', kes(sale.subtotal)),
    sale.discountAmount > 0 ? line(`Discount${sale.discountReason ? ` (${sale.discountReason})` : ''}`, `-${kes(sale.discountAmount)}`) : '',
    sale.taxAmount > 0 && !tax.taxInclusive ? line(taxLabel, kes(sale.taxAmount)) : '',
    sale.serviceChargeAmount > 0 ? line('Service charge', kes(sale.serviceChargeAmount)) : '',
    line('Total', kes(sale.totalAmount), 'total'),
    sale.taxAmount > 0 && tax.taxInclusive ? line(`Includes ${taxLabel}`, kes(sale.taxAmount), 'muted') : '',
  ].join('');
  const payments = (sale.payments || [])
    .map((p: any) => line(String(p.method || '').replace('_', ' ').replace('MOBILE MONEY', 'M-Pesa'), `${kes(p.amount)}${p.reference && p.method === 'MOBILE_MONEY' ? ` (${escapeHtml(p.reference)})` : ''}`))
    .join('');
  const refunds = creditNotes.length
    ? `<p class="h">Refunds</p><table>${creditNotes.map((c) => line(`Credit note ${c.number}`, `-${kes(c.amount)}`)).join('')}</table>`
    : '';
  const business = escapeHtml(tax.businessName || sale.branch?.name || '');
  const pinLine = tax.vatRegistered && tax.kraPin ? `<br>KRA PIN ${escapeHtml(tax.kraPin)}` : '';

  return `<html><head><title>${escapeHtml(receipt.receiptNumber)}</title><style>
body{font-family:Arial,sans-serif;padding:24px;max-width:380px;margin:auto;color:#111}
table{width:100%;border-collapse:collapse}td{padding:4px 0;vertical-align:top}.r{text-align:right;white-space:nowrap}
.total td{font-size:17px;font-weight:700;border-top:1px solid #ccc;padding-top:8px}.muted td{color:#555;font-size:13px}
.h{margin:14px 0 4px;font-weight:700}hr{border:0;border-top:1px dashed #bbb;margin:12px 0}
</style></head><body>
<h2 style="text-align:center;margin-bottom:4px">${business}</h2>
<p style="text-align:center;margin-top:0">${escapeHtml(sale.branch?.name || '')}${pinLine}</p>
<p style="text-align:center">Receipt ${escapeHtml(receipt.receiptNumber)}<br>Order ${escapeHtml(sale.orderNumber)}<br>${new Date(receipt.issuedAt).toLocaleString()}</p>
<table>${rows}</table><hr><table>${totals}</table>
${payments ? `<p class="h">Paid</p><table>${payments}</table>` : ''}
${refunds}
<p style="text-align:center;margin-top:18px">Thank you for dining with us.</p>
<script>window.print();</script></body></html>`;
}
