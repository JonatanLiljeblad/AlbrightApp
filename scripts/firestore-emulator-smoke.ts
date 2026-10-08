// @ts-nocheck
import { deleteApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } from 'firebase/auth';
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  runTransaction,
  setLogLevel,
  setDoc,
} from 'firebase/firestore';

import {
  bookScheduleSlot,
  reserveScheduleSlots,
  unbookScheduleSlot,
  unreserveScheduleSlot,
} from '../src/scheduleActions';
import { slotEndMs } from '../src/time';

const projectId = process.env.FIREBASE_PROJECT_ID ?? 'demo-albright';
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const authUrl = authHost.startsWith('http://') || authHost.startsWith('https://')
  ? authHost
  : `http://${authHost}`;

const [firestoreEmulatorHost, firestorePortRaw] = firestoreHost.split(':');
const firestoreEmulatorPort = Number(firestorePortRaw ?? '8080');

if (!firestoreEmulatorHost || !Number.isFinite(firestoreEmulatorPort)) {
  throw new Error(`Invalid FIRESTORE_EMULATOR_HOST: "${firestoreHost}"`);
}

setLogLevel('silent');

function asFirestoreValue(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(asFirestoreValue) } };
  }
  if (typeof value === 'object') {
    const fields = {};
    for (const [k, v] of Object.entries(value)) {
      fields[k] = asFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  throw new Error(`Unsupported Firestore value type: ${typeof value}`);
}

async function adminPatchDoc(path, data) {
  const fields = {};
  for (const [k, v] of Object.entries(data)) {
    fields[k] = asFirestoreValue(v);
  }

  const res = await fetch(
    `http://${firestoreHost}/v1/projects/${projectId}/databases/(default)/documents/${path}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: 'Bearer owner',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fields }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Admin seed failed (${res.status}): ${body}`);
  }
}

async function flushFirestore() {
  const res = await fetch(
    `http://${firestoreHost}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: 'DELETE' }
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Firestore flush failed (${res.status}): ${body}`);
  }
}

function createClient(name) {
  const app = initializeApp({ apiKey: 'demo-key', projectId }, name);
  const auth = getAuth(app);
  connectAuthEmulator(auth, authUrl, { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, firestoreEmulatorHost, firestoreEmulatorPort);
  return { app, auth, db };
}

function actionUser(user, email, displayName = null) {
  return {
    uid: user.uid,
    email,
    displayName,
  };
}

function emailDoc(email, createdBy) {
  return {
    email,
    createdAt: Date.now(),
    createdBy,
  };
}

function accessRequestPayload({ name, email }) {
  return {
    name,
    email,
    status: 'pending',
    createdAt: Date.now(),
  };
}

function bookingPayload({ date, slot, uid, email, name }) {
  return {
    date,
    slot,
    userId: uid,
    name,
    email,
    createdAt: Date.now(),
  };
}

function reservationPayload({ date, slot, uid, email, reason, role }) {
  return {
    date,
    slot,
    userId: uid,
    name: reason,
    email,
    createdAt: Date.now(),
    reservedByRole: role,
    reservedByUid: uid,
    reason,
  };
}

function guardEntry({ date, slot, uid, hoursFromNow = 1 }) {
  return {
    id: `${date}_${slot}_${uid}`,
    date,
    slot,
    endMs: Date.now() + hoursFromNow * 60 * 60 * 1000,
  };
}

function scheduleDayPayload(slots = {}) {
  return { slots };
}

function scheduleDayRef(db, date) {
  return doc(db, 'schedule', date);
}

function bookingRefs(db, date, slot, uid) {
  return {
    dayRef: scheduleDayRef(db, date),
    bookingRef: doc(db, 'bookings', `${date}_${slot}_${uid}`),
  };
}

async function addScheduleSlots(db, date, entries) {
  const dayRef = scheduleDayRef(db, date);
  await runTransaction(db, async (tx) => {
    const daySnap = await tx.get(dayRef);
    const current = daySnap.exists() ? (daySnap.data().slots ?? {}) : {};
    tx.set(dayRef, scheduleDayPayload({ ...current, ...entries }));
  });
}

async function createBookingPair(db, { date, slot, uid, email, name }) {
  const { dayRef, bookingRef } = bookingRefs(db, date, slot, uid);
  const payload = bookingPayload({ date, slot, uid, email, name });
  await runTransaction(db, async (tx) => {
    const daySnap = await tx.get(dayRef);
    const current = daySnap.exists() ? (daySnap.data().slots ?? {}) : {};
    tx.set(dayRef, scheduleDayPayload({ ...current, [slot]: payload }));
    tx.set(bookingRef, payload);
  });
}

async function deleteBookingPair(db, { date, slot, uid }) {
  const { dayRef, bookingRef } = bookingRefs(db, date, slot, uid);
  await runTransaction(db, async (tx) => {
    const daySnap = await tx.get(dayRef);
    if (daySnap.exists()) {
      const current = daySnap.data().slots ?? {};
      const next = { ...current };
      delete next[slot];
      tx.set(dayRef, scheduleDayPayload(next));
    }
    tx.delete(bookingRef);
  });
}

const results = [];

async function expectAllow(name, op) {
  try {
    await op();
    results.push({ name, pass: true, expected: 'allow' });
  } catch (e) {
    results.push({
      name,
      pass: false,
      expected: 'allow',
      detail: e instanceof Error ? e.message : String(e),
    });
  }
}

async function expectDeny(name, op) {
  try {
    await op();
    results.push({ name, pass: false, expected: 'deny', detail: 'Operation unexpectedly allowed' });
  } catch (e) {
    const code = typeof e === 'object' && e && 'code' in e ? String(e.code) : '';
    const permissionDenied = code.includes('permission-denied');
    results.push({
      name,
      pass: permissionDenied,
      expected: 'deny',
      detail: permissionDenied ? '' : (e instanceof Error ? e.message : String(e)),
    });
  }
}

async function main() {
  const ownerEmail = 'owner@example.com';
  const adminEmail = 'admin@example.com';
  const userEmail = 'member@example.com';
  const otherUserEmail = 'other@example.com';
  const outsiderEmail = 'outsider@example.com';
  const inviteeEmail = 'invitee@example.com';
  const password = 'password123';
  const date = '2099-01-01';
  const nextDate = '2099-01-02';
  const helperBookDate = '2099-01-03';
  const helperUnbookDate = '2099-01-06';
  const helperReserveDate = '2099-01-04';
  const helperUnreserveDate = '2099-01-05';

  await flushFirestore();

  const owner = createClient('owner-client');
  const admin = createClient('admin-client');
  const user = createClient('user-client');
  const otherUser = createClient('other-user-client');
  const outsider = createClient('outsider-client');
  const anon = createClient('anon-client');

  try {
    const ownerCred = await createUserWithEmailAndPassword(owner.auth, ownerEmail, password);
    const adminCred = await createUserWithEmailAndPassword(admin.auth, adminEmail, password);
    const userCred = await createUserWithEmailAndPassword(user.auth, userEmail, password);
    const otherUserCred = await createUserWithEmailAndPassword(otherUser.auth, otherUserEmail, password);
    const outsiderCred = await createUserWithEmailAndPassword(outsider.auth, outsiderEmail, password);

    await adminPatchDoc(`owners/${ownerEmail}`, emailDoc(ownerEmail, ownerEmail));
    await adminPatchDoc(`admins/${adminEmail}`, emailDoc(adminEmail, ownerEmail));
    await adminPatchDoc(`allowedEmails/${userEmail}`, emailDoc(userEmail, ownerEmail));
    await adminPatchDoc(`allowedEmails/${otherUserEmail}`, emailDoc(otherUserEmail, ownerEmail));

    await expectAllow('ALLOW public allowlist get by document id', async () => {
      await getDoc(doc(anon.db, 'allowedEmails', userEmail));
    });

    await expectDeny('DENY public allowlist list', async () => {
      await getDocs(query(collection(anon.db, 'allowedEmails')));
    });

    await expectAllow('ALLOW public access request create', async () => {
      await setDoc(
        doc(anon.db, 'accessRequests', outsiderEmail),
        accessRequestPayload({ name: 'Outsider User', email: outsiderEmail })
      );
    });

    await expectAllow('ALLOW public pending access request update', async () => {
      await setDoc(
        doc(anon.db, 'accessRequests', outsiderEmail),
        accessRequestPayload({ name: 'Updated Outsider', email: outsiderEmail })
      );
    });

    await expectAllow('ALLOW requester read own access request after sign-in', async () => {
      await getDoc(doc(outsider.db, 'accessRequests', outsiderEmail));
    });

    await expectDeny('DENY regular user list access requests', async () => {
      await getDocs(query(collection(user.db, 'accessRequests')));
    });

    await expectAllow('ALLOW admin list access requests', async () => {
      await getDocs(query(collection(admin.db, 'accessRequests')));
    });

    await expectDeny('DENY admin decision update without decision metadata', async () => {
      await setDoc(
        doc(admin.db, 'accessRequests', outsiderEmail),
        { status: 'approved' },
        { merge: true }
      );
    });

    await expectAllow('ALLOW admin decision update with decision metadata', async () => {
      await setDoc(
        doc(admin.db, 'accessRequests', outsiderEmail),
        { status: 'approved', decidedAt: Date.now(), decidedBy: adminEmail },
        { merge: true }
      );
    });

    await expectDeny('DENY public update after request already approved', async () => {
      await setDoc(
        doc(anon.db, 'accessRequests', outsiderEmail),
        accessRequestPayload({ name: 'Try Again', email: outsiderEmail })
      );
    });

    await expectDeny('DENY regular user writing allowlist doc', async () => {
      await setDoc(doc(user.db, 'allowedEmails', inviteeEmail), emailDoc(inviteeEmail, userEmail));
    });

    await expectAllow('ALLOW admin writing allowlist doc', async () => {
      await setDoc(doc(admin.db, 'allowedEmails', inviteeEmail), emailDoc(inviteeEmail, adminEmail));
    });

    await expectAllow('ALLOW owner writing admin role doc', async () => {
      await setDoc(
        doc(owner.db, 'admins', 'newadmin@example.com'),
        emailDoc('newadmin@example.com', ownerEmail)
      );
    });

    await expectDeny('DENY admin writing admin role doc', async () => {
      await setDoc(
        doc(admin.db, 'admins', 'shadowadmin@example.com'),
        emailDoc('shadowadmin@example.com', adminEmail)
      );
    });

    await expectDeny('DENY admin writing owner role doc', async () => {
      await setDoc(
        doc(admin.db, 'owners', 'newowner@example.com'),
        emailDoc('newowner@example.com', adminEmail)
      );
    });

    await expectAllow('ALLOW user booking transaction (day + booking)', async () => {
      await createBookingPair(user.db, {
        date,
        slot: '09:00',
        uid: userCred.user.uid,
        email: userEmail,
        name: 'Member User',
      });
    });

    await expectDeny('DENY outsider booking transaction without allowlist', async () => {
      await createBookingPair(outsider.db, {
        date,
        slot: '10:00',
        uid: outsiderCred.user.uid,
        email: outsiderEmail,
        name: 'Outsider User',
      });
    });

    await expectDeny('DENY user schedule-only create', async () => {
      await addScheduleSlots(user.db, date, {
        '11:00': bookingPayload({
          date,
          slot: '11:00',
          uid: userCred.user.uid,
          email: userEmail,
          name: 'Member User',
        }),
      });
    });

    await expectDeny('DENY user reservation payload create', async () => {
      await addScheduleSlots(user.db, date, {
        '12:00': reservationPayload({
          date,
          slot: '12:00',
          uid: userCred.user.uid,
          email: userEmail,
          reason: 'Attempted reservation',
          role: 'admin',
        }),
      });
    });

    await expectAllow('ALLOW admin reservation with explicit metadata', async () => {
      await addScheduleSlots(admin.db, date, {
        '13:00': reservationPayload({
          date,
          slot: '13:00',
          uid: adminCred.user.uid,
          email: adminEmail,
          reason: 'Maintenance window',
          role: 'admin',
        }),
      });
    });

    await expectAllow('ALLOW owner reservation with owner metadata', async () => {
      await addScheduleSlots(owner.db, date, {
        '14:00': reservationPayload({
          date,
          slot: '14:00',
          uid: ownerCred.user.uid,
          email: ownerEmail,
          reason: 'Owner hold',
          role: 'owner',
        }),
      });
    });

    await expectAllow('ALLOW owner reservation using admin role metadata', async () => {
      await addScheduleSlots(owner.db, date, {
        '15:00': reservationPayload({
          date,
          slot: '15:00',
          uid: ownerCred.user.uid,
          email: ownerEmail,
          reason: 'Wrong role metadata',
          role: 'admin',
        }),
      });
    });

    await expectAllow('ALLOW admin schedule collection query', async () => {
      const q = query(collection(admin.db, 'schedule'));
      await getDocs(q);
    });

    await expectDeny('DENY outsider schedule collection query', async () => {
      const q = query(collection(outsider.db, 'schedule'));
      await getDocs(q);
    });

    await expectAllow('ALLOW admin reservation missing reason', async () => {
      const payload = reservationPayload({
        date,
        slot: '16:00',
        uid: adminCred.user.uid,
        email: adminEmail,
        reason: 'Temporary',
        role: 'admin',
      });
      delete payload.reason;
      await addScheduleSlots(admin.db, date, { '16:00': payload });
    });

    await expectDeny('DENY booking-only create without matching schedule', async () => {
      await setDoc(
        doc(user.db, 'bookings', `${date}_17:00_${userCred.user.uid}`),
        bookingPayload({
          date,
          slot: '17:00',
          uid: userCred.user.uid,
          email: userEmail,
          name: 'Member User',
        })
      );
    });

    await expectAllow('ALLOW admin read another user booking doc', async () => {
      await getDoc(doc(admin.db, 'bookings', `${date}_09:00_${userCred.user.uid}`));
    });

    await expectDeny('DENY other user read another user booking doc', async () => {
      await getDoc(doc(otherUser.db, 'bookings', `${date}_09:00_${userCred.user.uid}`));
    });

    await expectDeny('DENY outsider read schedule day', async () => {
      await getDoc(scheduleDayRef(outsider.db, date));
    });

    await expectAllow('ALLOW user delete own booking transaction', async () => {
      await createBookingPair(user.db, {
        date: nextDate,
        slot: '09:00',
        uid: userCred.user.uid,
        email: userEmail,
        name: 'Member User',
      });
      await deleteBookingPair(user.db, {
        date: nextDate,
        slot: '09:00',
        uid: userCred.user.uid,
      });
    });

    await expectDeny('DENY other user delete another user booking transaction', async () => {
      await createBookingPair(user.db, {
        date: nextDate,
        slot: '10:00',
        uid: userCred.user.uid,
        email: userEmail,
        name: 'Member User',
      });
      await deleteBookingPair(otherUser.db, {
        date: nextDate,
        slot: '10:00',
        uid: userCred.user.uid,
      });
    });

    await expectAllow('ALLOW admin delete another user booking transaction', async () => {
      await createBookingPair(user.db, {
        date: nextDate,
        slot: '11:00',
        uid: userCred.user.uid,
        email: userEmail,
        name: 'Member User',
      });
      await deleteBookingPair(admin.db, {
        date: nextDate,
        slot: '11:00',
        uid: userCred.user.uid,
      });
    });

    await expectAllow('ALLOW shared booking helper creates booking, schedule slot, and guard', async () => {
      await bookScheduleSlot({
        db: otherUser.db,
        user: actionUser(otherUserCred.user, otherUserEmail, 'Other User'),
        date: helperBookDate,
        slot: '09:00',
      });

      const bookingId = `${helperBookDate}_09:00_${otherUserCred.user.uid}`;
      const [bookingSnap, daySnap, guardSnap] = await Promise.all([
        getDoc(doc(otherUser.db, 'bookings', bookingId)),
        getDoc(scheduleDayRef(otherUser.db, helperBookDate)),
        getDoc(doc(otherUser.db, 'bookingGuards', otherUserCred.user.uid)),
      ]);

      if (!bookingSnap.exists()) throw new Error('Shared booking helper did not create booking doc.');
      if (!daySnap.exists() || !daySnap.data().slots?.['09:00']) {
        throw new Error('Shared booking helper did not create schedule slot.');
      }
      if (!guardSnap.exists() || !Array.isArray(guardSnap.data().active) || guardSnap.data().active.length !== 1) {
        throw new Error('Shared booking helper did not create booking guard entry.');
      }
    });

    await expectDeny('DENY shared booking helper without allowlist', async () => {
      await bookScheduleSlot({
        db: outsider.db,
        user: actionUser(outsiderCred.user, outsiderEmail, 'Outsider User'),
        date: helperBookDate,
        slot: '10:00',
      });
    });

    await expectAllow('ALLOW shared unbook helper removes booking, schedule slot, and guard', async () => {
      await bookScheduleSlot({
        db: otherUser.db,
        user: actionUser(otherUserCred.user, otherUserEmail, 'Other User'),
        date: helperUnbookDate,
        slot: '10:00',
      });

      const bookingId = `${helperUnbookDate}_10:00_${otherUserCred.user.uid}`;
      await unbookScheduleSlot({
        db: otherUser.db,
        userId: otherUserCred.user.uid,
        booking: {
          id: bookingId,
          date: helperUnbookDate,
          slot: '10:00',
          endMs: slotEndMs(helperUnbookDate, '10:00'),
        },
      });

      const [bookingSnap, daySnap, guardSnap] = await Promise.all([
        getDoc(doc(otherUser.db, 'bookings', bookingId)),
        getDoc(scheduleDayRef(otherUser.db, helperUnbookDate)),
        getDoc(doc(otherUser.db, 'bookingGuards', otherUserCred.user.uid)),
      ]);

      if (bookingSnap.exists()) throw new Error('Shared unbook helper left booking doc behind.');
      if (daySnap.data()?.slots?.['10:00']) throw new Error('Shared unbook helper left schedule slot behind.');
      if ((guardSnap.data()?.active ?? []).some((entry) => entry?.id === bookingId)) {
        throw new Error('Shared unbook helper left booking guard entry behind.');
      }
    });

    await expectAllow('ALLOW shared admin reserve helper creates reservations', async () => {
      await reserveScheduleSlots({
        db: admin.db,
        user: actionUser(adminCred.user, adminEmail, 'Admin User'),
        date: helperReserveDate,
        slots: ['13:00', '14:00'],
        reason: 'Shared helper reserve',
        reservedByRole: 'admin',
      });

      const daySnap = await getDoc(scheduleDayRef(admin.db, helperReserveDate));
      const slots = daySnap.data()?.slots ?? {};
      if (slots['13:00']?.reservedByRole !== 'admin' || slots['14:00']?.reservedByRole !== 'admin') {
        throw new Error('Shared reserve helper did not create admin reservations.');
      }
    });

    await expectAllow('ALLOW shared admin unreserve helper removes reservation', async () => {
      await reserveScheduleSlots({
        db: admin.db,
        user: actionUser(adminCred.user, adminEmail, 'Admin User'),
        date: helperUnreserveDate,
        slots: ['15:00'],
        reason: 'Shared helper unreserve',
        reservedByRole: 'admin',
      });

      await unreserveScheduleSlot({
        db: admin.db,
        date: helperUnreserveDate,
        slot: '15:00',
      });

      const daySnap = await getDoc(scheduleDayRef(admin.db, helperUnreserveDate));
      if (daySnap.data()?.slots?.['15:00']) {
        throw new Error('Shared unreserve helper left reservation slot behind.');
      }
    });

    await expectAllow('ALLOW user writing own booking guard (<=2)', async () => {
      await setDoc(doc(user.db, 'bookingGuards', userCred.user.uid), {
        updatedAt: Date.now(),
        active: [
          guardEntry({ date, slot: '18:00', uid: userCred.user.uid, hoursFromNow: 1 }),
          guardEntry({ date: nextDate, slot: '08:00', uid: userCred.user.uid, hoursFromNow: 2 }),
        ],
      });
    });

    await expectAllow('ALLOW admin read another user booking guard', async () => {
      await getDoc(doc(admin.db, 'bookingGuards', userCred.user.uid));
    });

    await expectDeny('DENY other user read another user booking guard', async () => {
      await getDoc(doc(otherUser.db, 'bookingGuards', userCred.user.uid));
    });

    await expectDeny('DENY user writing another user booking guard', async () => {
      await setDoc(doc(user.db, 'bookingGuards', adminCred.user.uid), {
        updatedAt: Date.now(),
        active: [],
      });
    });

    await expectDeny('DENY user writing booking guard with >2 active entries', async () => {
      await setDoc(doc(user.db, 'bookingGuards', userCred.user.uid), {
        updatedAt: Date.now(),
        active: [
          guardEntry({ date, slot: '18:00', uid: userCred.user.uid, hoursFromNow: 1 }),
          guardEntry({ date: nextDate, slot: '08:00', uid: userCred.user.uid, hoursFromNow: 2 }),
          guardEntry({ date: nextDate, slot: '12:00', uid: userCred.user.uid, hoursFromNow: 3 }),
        ],
      });
    });
  } finally {
    await Promise.all([
      deleteApp(owner.app),
      deleteApp(admin.app),
      deleteApp(user.app),
      deleteApp(otherUser.app),
      deleteApp(outsider.app),
      deleteApp(anon.app),
    ]);
  }

  let failed = 0;
  for (const result of results) {
    const marker = result.pass ? 'PASS' : 'FAIL';
    const suffix = result.detail ? ` -> ${result.detail}` : '';
    console.log(`${marker} [expected ${result.expected}] ${result.name}${suffix}`);
    if (!result.pass) failed += 1;
  }

  if (failed > 0) {
    throw new Error(`${failed} emulator checks failed`);
  }
}

main().catch((e) => {
  console.error('emulator smoke test failed:', e);
  process.exitCode = 1;
});
