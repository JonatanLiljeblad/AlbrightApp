import { collection, doc, getDocs, query, type Transaction, where } from 'firebase/firestore';
import { db } from './firebase';
import { slotEndMs } from './time';
import type { Booking } from './types';

type CanBookResult = { ok: true } | { ok: false; reason: string };
type ActiveBookingGuard = { id: string; date: string; slot: string; endMs: number };

function evaluateBookingCaps(bookings: Booking[], date: string, now: number): CanBookResult {
  let active = 0;
  let dailyActive = 0;

  for (const b of bookings) {
    const endMs = slotEndMs(b.date, b.slot);
    if (!Number.isFinite(endMs) || endMs <= now) continue;
    active += 1;
    if (b.date === date) dailyActive += 1;
  }

  if (dailyActive >= 1) {
    return { ok: false, reason: 'You already have an active booking for this day.' };
  }
  if (active >= 2) {
    return { ok: false, reason: 'You already have 2 active bookings.' };
  }
  return { ok: true };
}

export async function canBook(userId: string, date: string) {
  const now = Date.now();
  const byUserQ = query(collection(db, 'bookings'), where('userId', '==', userId));
  const byUser = await getDocs(byUserQ);
  return evaluateBookingCaps(byUser.docs.map((d) => d.data() as Booking), date, now);
}

function normalizeActiveGuard(value: unknown, now: number): ActiveBookingGuard[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is ActiveBookingGuard => {
      if (!item || typeof item !== 'object') return false;
      const x = item as Partial<ActiveBookingGuard>;
      return (
        typeof x.id === 'string' &&
        typeof x.date === 'string' &&
        typeof x.slot === 'string' &&
        typeof x.endMs === 'number'
      );
    })
    .filter((item) => Number.isFinite(item.endMs) && item.endMs > now);
}

function guardRef(userId: string) {
  return doc(db, 'bookingGuards', userId);
}

export async function assertCanBookInTransaction(
  tx: Transaction,
  userId: string,
  date: string,
  slot: string,
  now = Date.now()
) {
  const ref = guardRef(userId);
  const snap = await tx.get(ref);
  const active = normalizeActiveGuard((snap.data() as { active?: unknown } | undefined)?.active, now);

  if (active.some((b) => b.date === date)) {
    throw new Error('You already have an active booking for this day.');
  }
  if (active.length >= 2) {
    throw new Error('You already have 2 active bookings.');
  }

  const endMs = slotEndMs(date, slot);
  if (!Number.isFinite(endMs)) {
    throw new Error('Invalid booking slot.');
  }

  const bookingId = `${date}_${slot}_${userId}`;
  tx.set(
    ref,
    {
      active: active
        .filter((b) => b.id !== bookingId)
        .concat([{ id: bookingId, date, slot, endMs } satisfies ActiveBookingGuard]),
      updatedAt: now,
    },
    { merge: true }
  );
}

export async function removeBookingFromGuardInTransaction(
  tx: Transaction,
  userId: string,
  date: string,
  slot: string,
  now = Date.now()
) {
  const ref = guardRef(userId);
  const snap = await tx.get(ref);
  const active = normalizeActiveGuard((snap.data() as { active?: unknown } | undefined)?.active, now);
  const bookingId = `${date}_${slot}_${userId}`;

  tx.set(
    ref,
    {
      active: active.filter((b) => b.id !== bookingId),
      updatedAt: now,
    },
    { merge: true }
  );
}
