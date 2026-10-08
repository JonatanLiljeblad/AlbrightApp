import { deleteDoc, doc, runTransaction, type Firestore } from 'firebase/firestore';

import {
  assertCanBookInTransaction,
  removeBookingFromGuardInTransaction,
} from './bookingRules';
import {
  detectScheduleBackend,
  loadScheduleDay,
  normalizeScheduleDay,
  removeScheduleSlot,
  scheduleDayRef,
  scheduleSlotRef,
  upsertScheduleSlot,
} from './schedule';
import type { ActiveBookingGuard, ReservedByRole, ScheduleSlot } from './types';

export type ScheduleActionUser = {
  uid: string;
  email: string | null;
  displayName?: string | null;
};

type BookScheduleSlotInput = {
  db: Firestore;
  user: ScheduleActionUser;
  date: string;
  slot: string;
  now?: number;
};

type UnbookScheduleSlotInput = {
  db: Firestore;
  userId: string;
  booking: ActiveBookingGuard;
  now?: number;
};

type ReserveScheduleSlotsInput = {
  db: Firestore;
  user: ScheduleActionUser;
  date: string;
  slots: string[];
  reason: string;
  reservedByRole: ReservedByRole;
  now?: number;
};

type UnreserveScheduleSlotInput = {
  db: Firestore;
  date: string;
  slot: string;
};

function buildBookingPayload(
  user: ScheduleActionUser,
  date: string,
  slot: string,
  createdAt: number,
): ScheduleSlot {
  return {
    date,
    slot,
    userId: user.uid,
    name: user.displayName || user.email || 'User',
    email: user.email || '',
    createdAt,
  };
}

function buildReservationPayload(
  user: ScheduleActionUser,
  date: string,
  slot: string,
  createdAt: number,
  reason: string,
  reservedByRole: ReservedByRole,
): ScheduleSlot {
  return {
    date,
    slot,
    userId: user.uid,
    name: reason,
    email: user.email || '',
    createdAt,
    reservedByRole,
    reservedByUid: user.uid,
    reason,
  };
}

export async function bookScheduleSlot({
  db,
  user,
  date,
  slot,
  now = Date.now(),
}: BookScheduleSlotInput) {
  const backend = await detectScheduleBackend(date, db);
  const bookingRef = doc(db, 'bookings', `${date}_${slot}_${user.uid}`);
  const payload = buildBookingPayload(user, date, slot, now);

  await runTransaction(db, async (tx) => {
    if (backend === 'legacy-slot-subcollection') {
      const slotRef = scheduleSlotRef(date, slot, db);
      const existing = await tx.get(slotRef);
      if (existing.exists()) throw new Error('This slot is already booked.');
      await assertCanBookInTransaction(tx, user.uid, date, slot, now, db);
      tx.set(slotRef, payload);
    } else {
      const dayRef = scheduleDayRef(date, db);
      const daySnap = await tx.get(dayRef);
      const day = normalizeScheduleDay(daySnap.data());
      if (day.slots[slot]) throw new Error('This slot is already booked.');
      await assertCanBookInTransaction(tx, user.uid, date, slot, now, db);
      tx.set(dayRef, { slots: upsertScheduleSlot(day.slots, slot, payload) });
    }

    tx.set(bookingRef, payload);
  });

  return payload;
}

export async function unbookScheduleSlot({
  db,
  userId,
  booking,
  now = Date.now(),
}: UnbookScheduleSlotInput) {
  const backend = await detectScheduleBackend(booking.date, db);
  const bookingRef = doc(db, 'bookings', booking.id);

  await runTransaction(db, async (tx) => {
    if (backend === 'legacy-slot-subcollection') {
      const slotRef = scheduleSlotRef(booking.date, booking.slot, db);
      const slotSnap = await tx.get(slotRef);
      const slotData = slotSnap.data() as { userId?: unknown } | undefined;
      if (typeof slotData?.userId === 'string' && slotData.userId !== userId) {
        throw new Error('You can only unbook your own slot.');
      }
      await removeBookingFromGuardInTransaction(tx, userId, booking.date, booking.slot, now, db);
      if (slotSnap.exists()) {
        tx.delete(slotRef);
      }
    } else {
      const dayRef = scheduleDayRef(booking.date, db);
      const daySnap = await tx.get(dayRef);
      let nextSlots: ReturnType<typeof removeScheduleSlot> | null = null;
      let shouldUpdateDay = false;

      if (daySnap.exists()) {
        const day = normalizeScheduleDay(daySnap.data());
        const data = day.slots[booking.slot];
        if (data?.userId && data.userId !== userId) {
          throw new Error('You can only unbook your own slot.');
        }
        nextSlots = removeScheduleSlot(day.slots, booking.slot);
        shouldUpdateDay = nextSlots !== day.slots;
      }

      await removeBookingFromGuardInTransaction(tx, userId, booking.date, booking.slot, now, db);

      if (daySnap.exists() && nextSlots && shouldUpdateDay) {
        tx.set(dayRef, { slots: nextSlots });
      }
    }

    tx.delete(bookingRef);
  });
}

export async function reserveScheduleSlots({
  db,
  user,
  date,
  slots,
  reason,
  reservedByRole,
  now = Date.now(),
}: ReserveScheduleSlotsInput) {
  const selectedSlots = Array.from(new Set(slots)).sort();
  if (selectedSlots.length === 0) {
    throw new Error('Select at least one slot to reserve.');
  }

  const trimmedReason = reason.trim();
  if (trimmedReason.length === 0) {
    throw new Error('Reservation title is required.');
  }

  const backend = await detectScheduleBackend(date, db);

  if (backend === 'legacy-slot-subcollection') {
    await runTransaction(db, async (tx) => {
      const reads = await Promise.all(
        selectedSlots.map(async (slot) => {
          const slotRef = scheduleSlotRef(date, slot, db);
          const snap = await tx.get(slotRef);
          return { slot, exists: snap.exists(), slotRef };
        }),
      );

      const taken = reads.filter((entry) => entry.exists);
      if (taken.length > 0) {
        throw new Error(`Slot(s) ${taken.map((entry) => entry.slot).join(', ')} already taken.`);
      }

      for (const { slot, slotRef } of reads) {
        tx.set(
          slotRef,
          buildReservationPayload(user, date, slot, now, trimmedReason, reservedByRole),
        );
      }
    });
    return;
  }

  const dayRef = scheduleDayRef(date, db);
  const day = await loadScheduleDay(date, db);
  const taken = selectedSlots.filter((slot) => day.slots[slot]);
  if (taken.length > 0) {
    throw new Error(`Slot(s) ${taken.join(', ')} already taken.`);
  }

  for (const slot of selectedSlots) {
    await runTransaction(db, async (tx) => {
      const currentSnap = await tx.get(dayRef);
      const currentDay = normalizeScheduleDay(currentSnap.data());
      if (currentDay.slots[slot]) {
        throw new Error(`Slot ${slot} was taken while reserving.`);
      }

      tx.set(dayRef, {
        slots: upsertScheduleSlot(
          currentDay.slots,
          slot,
          buildReservationPayload(user, date, slot, now, trimmedReason, reservedByRole),
        ),
      });
    });
  }
}

export async function unreserveScheduleSlot({
  db,
  date,
  slot,
}: UnreserveScheduleSlotInput) {
  const backend = await detectScheduleBackend(date, db);
  if (backend === 'legacy-slot-subcollection') {
    await deleteDoc(scheduleSlotRef(date, slot, db));
    return;
  }

  await runTransaction(db, async (tx) => {
    const dayRef = scheduleDayRef(date, db);
    const daySnap = await tx.get(dayRef);
    if (!daySnap.exists()) return;

    const day = normalizeScheduleDay(daySnap.data());
    if (!day.slots[slot]) return;

    tx.set(dayRef, { slots: removeScheduleSlot(day.slots, slot) });
  });
}
