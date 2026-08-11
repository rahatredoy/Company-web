import type { invoices } from '../db/schema/index';

type Invoice = typeof invoices.$inferSelect;

function line(label: string, value: string): string {
  return `${label.padEnd(20)}${value}`;
}

/**
 * Plain-text invoice. Deliberately dependency-free for V1 — swapping in a PDF
 * renderer later only changes this function and the two content headers.
 */
export function renderInvoiceText(invoice: Invoice, planName: string | null, storeName: string): string {
  const billTo = invoice.billTo;
  const issued = invoice.issuedAt.toISOString().slice(0, 10);
  const paid = invoice.paidAt ? invoice.paidAt.toISOString().slice(0, 10) : '—';

  return [
    '='.repeat(56),
    `INVOICE ${invoice.invoiceNumber}`,
    '='.repeat(56),
    '',
    line('Issued', issued),
    line('Paid', paid),
    line('Status', invoice.status.toUpperCase()),
    '',
    'BILL TO',
    '-'.repeat(56),
    billTo?.businessName ?? storeName,
    billTo?.ownerName ?? '',
    billTo?.email ?? '',
    billTo?.address ?? '',
    billTo?.country ?? '',
    '',
    'DETAILS',
    '-'.repeat(56),
    line('Store', storeName),
    line('Plan', planName ?? '—'),
    line('Billing cycle', invoice.billingCycle),
    '',
    '-'.repeat(56),
    line('TOTAL', `${invoice.currency} ${invoice.amount}`),
    '='.repeat(56),
    '',
    'Thank you for your business.',
    '',
  ].join('\n');
}
