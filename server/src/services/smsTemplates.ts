import { smsReplyCode, type SmsLanguage } from './smsService';

/** "Reply STOP" only when there is a shortcode to reply to; a sender name can't receive replies. */
const stopHint = (lang: SmsLanguage) => {
  const code = smsReplyCode();
  if (!code) return '';
  return lang === 'sw' ? ` Tuma STOP kwa ${code} kusitisha SMS.` : ` Reply STOP to ${code} to stop SMS.`;
};

const kes = (n: number) => `KES ${Math.round(n).toLocaleString('en-KE')}`;
export const smsLanguage = (l?: string | null): SmsLanguage => (l === 'sw' ? 'sw' : 'en');

/** Receipt after a paid visit, with the points earned and the balance. Kept to one SMS (160 characters) where possible. */
export function receiptSms(lang: SmsLanguage, v: { restaurant: string; orderNumber: string; total: number; points: number; balance: number }) {
  if (lang === 'sw') {
    const pts = v.points > 0 ? ` Umepata pointi ${v.points}, salio pointi ${v.balance}.` : v.balance > 0 ? ` Salio pointi ${v.balance}.` : '';
    return `${v.restaurant}: Asante! Oda ${v.orderNumber}, ${kes(v.total)} imelipwa.${pts}${stopHint('sw')}`;
  }
  const pts = v.points > 0 ? ` You earned ${v.points} points, balance ${v.balance}.` : v.balance > 0 ? ` Points balance: ${v.balance}.` : '';
  return `${v.restaurant}: Thank you! Order ${v.orderNumber}, ${kes(v.total)} paid.${pts}${stopHint('en')}`;
}

/** Website order updates, by status. */
export function orderUpdateSms(lang: SmsLanguage, status: string, v: { restaurant: string; orderNumber: string; trackingLink: string }) {
  const en: Record<string, string> = {
    SUBMITTED: `${v.restaurant}: we got your order ${v.orderNumber}.${v.trackingLink ? ` Track it here: ${v.trackingLink}` : ''}`,
    PREPARING: `${v.restaurant}: the kitchen is preparing your order ${v.orderNumber}.`,
    READY: `${v.restaurant}: your order ${v.orderNumber} is ready.`,
    OUT_FOR_DELIVERY: `${v.restaurant}: your order ${v.orderNumber} is on its way.`,
    SERVED: `${v.restaurant}: your order ${v.orderNumber} has been served. Enjoy!`,
    COMPLETED: `${v.restaurant}: order ${v.orderNumber} is complete. Thank you!`,
    CANCELLED: `${v.restaurant}: your order ${v.orderNumber} was cancelled. Call us if you have questions.`,
  };
  const sw: Record<string, string> = {
    SUBMITTED: `${v.restaurant}: tumepokea oda yako ${v.orderNumber}.${v.trackingLink ? ` Ifuatilie hapa: ${v.trackingLink}` : ''}`,
    PREPARING: `${v.restaurant}: jikoni wanaandaa oda yako ${v.orderNumber}.`,
    READY: `${v.restaurant}: oda yako ${v.orderNumber} iko tayari.`,
    OUT_FOR_DELIVERY: `${v.restaurant}: oda yako ${v.orderNumber} iko njiani.`,
    SERVED: `${v.restaurant}: oda yako ${v.orderNumber} imeletwa. Furahia mlo wako!`,
    COMPLETED: `${v.restaurant}: oda ${v.orderNumber} imekamilika. Asante!`,
    CANCELLED: `${v.restaurant}: oda yako ${v.orderNumber} imeghairiwa. Tupigie kama una maswali.`,
  };
  const table = lang === 'sw' ? sw : en;
  return table[status] || (lang === 'sw' ? `${v.restaurant}: oda yako ${v.orderNumber} imesasishwa.` : `${v.restaurant}: order ${v.orderNumber} is now ${status.toLowerCase().replace(/_/g, ' ')}.`);
}

/** Booking received. */
export function reservationSms(lang: SmsLanguage, v: { restaurant: string; branch: string; reference: string; guests: number; date: string; time: string }) {
  return lang === 'sw'
    ? `${v.restaurant}: tumepokea ombi lako la meza (${v.reference}) kwa watu ${v.guests}, ${v.branch}, ${v.date} saa ${v.time}. Tutakuthibitishia.`
    : `${v.restaurant}: we got your table request (${v.reference}) for ${v.guests}, ${v.branch}, ${v.date} at ${v.time}. We'll confirm shortly.`;
}
