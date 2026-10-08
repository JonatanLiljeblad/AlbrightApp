import {
  collection,
  collectionGroup,
  doc,
  documentId,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  where,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import type { ScheduleDay, ScheduleSlot } from './types';

export type ScheduleBackend = 'day-doc' | 'legacy-slot-subcollection';
export type ScheduleReservation = { date: string; slot: string; name: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function scheduleDayRef(date: string, firestore: Firestore) {
  return doc(firestore, 'schedule', date);
}

export function scheduleSlotsCollection(date: string, firestore: Firestore) {
  return collection(firestore, 'schedule', date, 'slots');
}

export function scheduleSlotRef(date: string, slot: string, firestore: Firestore) {
  return doc(firestore, 'schedule', date, 'slots', slot);
}

export function isPermissionDeniedError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error
    && String((error as { code?: unknown }).code).includes('permission-denied');
}

export function isScheduleSlot(value: unknown): value is ScheduleSlot {
  if (!isRecord(value)) return false;

  const { date, slot, userId, name, email, createdAt, reservedByRole, reservedByUid, reason } = value;
  const hasReservationMetadata = reservedByRole !== undefined || reservedByUid !== undefined || reason !== undefined;

  if (
    typeof date !== 'string' ||
    typeof slot !== 'string' ||
    typeof userId !== 'string' ||
    typeof name !== 'string' ||
    typeof email !== 'string' ||
    typeof createdAt !== 'number'
  ) {
    return false;
  }

  if (!hasReservationMetadata) return true;

  return (
    (reservedByRole === 'owner' || reservedByRole === 'admin') &&
    typeof reservedByUid === 'string' &&
    typeof reason === 'string'
  );
}

export function isReservationSlot(value: Partial<ScheduleSlot> | undefined) {
  if (!value) return false;
  return Boolean(value.reservedByRole || value.reservedByUid || value.reason);
}

function scheduleDayFromEntries(entries: Iterable<readonly [string, unknown]>): ScheduleDay {
  const slots: Record<string, ScheduleSlot> = {};

  for (const [slot, entry] of entries) {
    if (isScheduleSlot(entry)) {
      slots[slot] = entry;
    }
  }

  return { slots };
}

export function normalizeScheduleDay(value: unknown): ScheduleDay {
  if (!isRecord(value) || !isRecord(value.slots)) return { slots: {} };

  return scheduleDayFromEntries(
    Object.entries(value.slots).map(([slot, entry]) => [slot, entry] as const),
  );
}

export function upsertScheduleSlot(slots: Record<string, ScheduleSlot>, slot: string, value: ScheduleSlot) {
  return {
    ...slots,
    [slot]: value,
  };
}

export function removeScheduleSlot(slots: Record<string, ScheduleSlot>, slot: string) {
  if (!(slot in slots)) return slots;

  const next = { ...slots };
  delete next[slot];
  return next;
}

async function loadLegacyScheduleDay(date: string, firestore: Firestore): Promise<ScheduleDay> {
  const snap = await getDocs(scheduleSlotsCollection(date, firestore));
  return scheduleDayFromEntries(
    snap.docs.map((slotDoc) => [slotDoc.id, slotDoc.data()] as const),
  );
}

export async function detectScheduleBackend(
  date: string,
  firestore: Firestore,
): Promise<ScheduleBackend> {
  try {
    const daySnap = await getDoc(scheduleDayRef(date, firestore));
    const day = normalizeScheduleDay(daySnap.data());
    if (daySnap.exists() && Object.keys(day.slots).length > 0) {
      return 'day-doc';
    }

    try {
      const legacyDay = await loadLegacyScheduleDay(date, firestore);
      return Object.keys(legacyDay.slots).length > 0
        ? 'legacy-slot-subcollection'
        : 'day-doc';
    } catch (legacyError) {
      if (isPermissionDeniedError(legacyError)) {
        return 'day-doc';
      }
      throw legacyError;
    }
  } catch (error) {
    if (!isPermissionDeniedError(error)) {
      throw error;
    }
    return 'legacy-slot-subcollection';
  }
}

export async function loadScheduleDay(date: string, firestore: Firestore): Promise<ScheduleDay> {
  const backend = await detectScheduleBackend(date, firestore);
  if (backend === 'legacy-slot-subcollection') {
    return loadLegacyScheduleDay(date, firestore);
  }

  const snap = await getDoc(scheduleDayRef(date, firestore));
  return normalizeScheduleDay(snap.data());
}

export async function subscribeToScheduleDay(
  date: string,
  onData: (day: ScheduleDay) => void,
  onError: (error: unknown) => void,
  firestore: Firestore,
): Promise<Unsubscribe> {
  const backend = await detectScheduleBackend(date, firestore);

  if (backend === 'legacy-slot-subcollection') {
    const initialDay = await loadLegacyScheduleDay(date, firestore);
    onData(initialDay);
    return onSnapshot(
      scheduleSlotsCollection(date, firestore),
      (snap) =>
        onData(
          scheduleDayFromEntries(
            snap.docs.map((slotDoc) => [slotDoc.id, slotDoc.data()] as const),
          ),
        ),
      onError,
    );
  }

  const dayRef = scheduleDayRef(date, firestore);
  const initialSnap = await getDoc(dayRef);
  onData(normalizeScheduleDay(initialSnap.data()));
  return onSnapshot(
    dayRef,
    (snap) => onData(normalizeScheduleDay(snap.data())),
    onError,
  );
}

function reservationsFromDay(date: string, day: ScheduleDay): ScheduleReservation[] {
  return Object.entries(day.slots).reduce<ScheduleReservation[]>((acc, [slot, data]) => {
    if (isReservationSlot(data)) {
      acc.push({ date, slot, name: data.name });
    }
    return acc;
  }, []);
}

async function loadLegacyScheduleReservations(
  startDate: string,
  firestore: Firestore,
): Promise<ScheduleReservation[]> {
  const reservationsQ = query(
    collectionGroup(firestore, 'slots'),
    where('reservedByRole', 'in', ['owner', 'admin']),
  );
  const snap = await getDocs(reservationsQ);
  return snap.docs.reduce<ScheduleReservation[]>((acc, reservationDoc) => {
    const data = reservationDoc.data();
    if (isScheduleSlot(data) && isReservationSlot(data) && data.date >= startDate) {
      acc.push({ date: data.date, slot: data.slot, name: data.name });
    }
    return acc;
  }, []);
}

export async function loadScheduleReservations(
  startDate: string,
  firestore: Firestore,
): Promise<ScheduleReservation[]> {
  try {
    const reservationsQ = query(
      collection(firestore, 'schedule'),
      where(documentId(), '>=', startDate),
      orderBy(documentId()),
    );
    const snap = await getDocs(reservationsQ);
    const reservations = snap.docs.flatMap((dayDoc) =>
      reservationsFromDay(dayDoc.id, normalizeScheduleDay(dayDoc.data())),
    );
    if (reservations.length > 0 || !snap.empty) {
      return reservations;
    }

    try {
      return await loadLegacyScheduleReservations(startDate, firestore);
    } catch (legacyError) {
      if (isPermissionDeniedError(legacyError)) {
        return reservations;
      }
      throw legacyError;
    }
  } catch (error) {
    if (!isPermissionDeniedError(error)) {
      throw error;
    }
    return loadLegacyScheduleReservations(startDate, firestore);
  }
}
