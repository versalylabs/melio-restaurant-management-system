import prisma from '../config/database';
import { createNotification } from './notificationService';

const DAY = 24 * 60 * 60 * 1000;
const MANAGERS = ['OWNER', 'ADMIN', 'MANAGER'];
const lastRun = new Map<string, number>();

// Expiry is the end of that day, so whole days remaining is a floor (0 = today, -1 = expired yesterday).
export const daysLeft = (expiresAt: Date, now = Date.now()) => Math.floor((expiresAt.getTime() - now) / DAY);

/**
 * Reminds owners and managers 30 days and 7 days before a licence expires.
 * Runs when staff load notifications or the licences page (no scheduler
 * needed); each reminder is claimed in the database first, so it is sent once.
 */
export async function sendLicenceReminders(restaurantId: string, now = Date.now()) {
  if (now - (lastRun.get(restaurantId) || 0) < 10 * 60 * 1000) return 0;
  lastRun.set(restaurantId, now);
  let sent = 0;
  for (const [days, field] of [[7, 'reminded7At'], [30, 'reminded30At']] as const) {
    const due = await prisma.licence.findMany({
      where: { restaurantId, expiresAt: { lt: new Date(now + (days + 1) * DAY) }, [field]: null },
      select: { id: true, name: true, branchId: true, expiresAt: true },
    });
    for (const l of due) {
      // Claim it: a second server doing the same check finds nothing to send.
      const claimed = await prisma.licence.updateMany({
        where: { id: l.id, [field]: null },
        // A licence already inside 7 days needs no separate 30-day reminder.
        data: days === 7 ? { reminded7At: new Date(now), reminded30At: new Date(now) } : { reminded30At: new Date(now) },
      });
      if (!claimed.count) continue;
      try {
      const left = daysLeft(l.expiresAt, now);
      const when = l.expiresAt.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Nairobi' });
      const message = left < 0 ? `${l.name} expired on ${when}. Renew it now.` : left === 0 ? `${l.name} expires today.` : `${l.name} expires on ${when} (in ${left} ${left === 1 ? 'day' : 'days'}).`;
      const managers = await prisma.user.findMany({
        where: { restaurantId, status: 'ACTIVE', role: { name: { in: MANAGERS } }, ...(l.branchId ? { OR: [{ branchId: null }, { branchId: l.branchId }] } : {}) },
        select: { id: true },
      });
      await Promise.all(managers.map((u) => createNotification({ restaurantId, branchId: l.branchId, userId: u.id, type: 'LICENCE_EXPIRY', title: left < 0 ? 'Licence expired' : 'Licence expiring', message, referenceType: 'Licence', referenceId: l.id })));
      sent++;
      } catch (err) {
        // Give the reminder back so the next check sends it.
        await prisma.licence.updateMany({ where: { id: l.id }, data: days === 7 ? { reminded7At: null } : { reminded30At: null } }).catch(() => undefined);
        console.error('Licence reminder failed:', err);
      }
    }
  }
  return sent;
}

/** For tests: forget when the check last ran. */
export const resetLicenceReminderThrottle = () => lastRun.clear();
