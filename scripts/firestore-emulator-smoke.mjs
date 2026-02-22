import { deleteApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, doc, getFirestore, runTransaction, setDoc } from 'firebase/firestore';

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
  const password = 'password123';
  const date = '2099-01-01';

  await flushFirestore();

  const owner = createClient('owner-client');
  const admin = createClient('admin-client');
  const user = createClient('user-client');

  try {
    const ownerCred = await createUserWithEmailAndPassword(owner.auth, ownerEmail, password);
    const adminCred = await createUserWithEmailAndPassword(admin.auth, adminEmail, password);
    const userCred = await createUserWithEmailAndPassword(user.auth, userEmail, password);

    const now = Date.now();
    await adminPatchDoc(`owners/${ownerEmail}`, { email: ownerEmail, createdAt: now, createdBy: ownerEmail });
    await adminPatchDoc(`admins/${adminEmail}`, { email: adminEmail, createdAt: now, createdBy: ownerEmail });
    await adminPatchDoc(`allowedEmails/${userEmail}`, { email: userEmail, createdAt: now, createdBy: ownerEmail });

    await expectAllow('ALLOW user booking transaction (slot + booking)', async () => {
      const slot = '09:00';
      const slotRef = doc(user.db, 'schedule', date, 'slots', slot);
      const bookingRef = doc(user.db, 'bookings', `${date}_${slot}_${userCred.user.uid}`);
      const payload = bookingPayload({
        date,
        slot,
        uid: userCred.user.uid,
        email: userEmail,
        name: 'Member User',
      });
      await runTransaction(user.db, async (tx) => {
        tx.set(slotRef, payload);
        tx.set(bookingRef, payload);
      });
    });

    await expectDeny('DENY user schedule-only create', async () => {
      const slot = '10:00';
      await setDoc(
        doc(user.db, 'schedule', date, 'slots', slot),
        bookingPayload({
          date,
          slot,
          uid: userCred.user.uid,
          email: userEmail,
          name: 'Member User',
        })
      );
    });

    await expectDeny('DENY user reservation payload create', async () => {
      const slot = '11:00';
      await setDoc(
        doc(user.db, 'schedule', date, 'slots', slot),
        reservationPayload({
          date,
          slot,
          uid: userCred.user.uid,
          email: userEmail,
          reason: 'Attempted reservation',
          role: 'admin',
        })
      );
    });

    await expectAllow('ALLOW admin reservation with explicit metadata', async () => {
      const slot = '12:00';
      await setDoc(
        doc(admin.db, 'schedule', date, 'slots', slot),
        reservationPayload({
          date,
          slot,
          uid: adminCred.user.uid,
          email: adminEmail,
          reason: 'Maintenance window',
          role: 'admin',
        })
      );
    });

    await expectDeny('DENY admin reservation missing reason', async () => {
      const slot = '13:00';
      const payload = reservationPayload({
        date,
        slot,
        uid: adminCred.user.uid,
        email: adminEmail,
        reason: 'Temporary',
        role: 'admin',
      });
      delete payload.reason;
      await setDoc(doc(admin.db, 'schedule', date, 'slots', slot), payload);
    });

    await expectDeny('DENY booking-only create without matching schedule', async () => {
      const slot = '14:00';
      await setDoc(
        doc(user.db, 'bookings', `${date}_${slot}_${userCred.user.uid}`),
        bookingPayload({
          date,
          slot,
          uid: userCred.user.uid,
          email: userEmail,
          name: 'Member User',
        })
      );
    });

    await expectAllow('ALLOW user writing own booking guard (<=2)', async () => {
      await setDoc(doc(user.db, 'bookingGuards', userCred.user.uid), {
        updatedAt: Date.now(),
        active: [
          { id: `${date}_15:00_${userCred.user.uid}`, date, slot: '15:00', endMs: Date.now() + 60 * 60 * 1000 },
        ],
      });
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
          { id: `${date}_15:00_${userCred.user.uid}`, date, slot: '15:00', endMs: Date.now() + 60 * 60 * 1000 },
          { id: `${date}_16:00_${userCred.user.uid}`, date, slot: '16:00', endMs: Date.now() + 2 * 60 * 60 * 1000 },
          { id: `${date}_17:00_${userCred.user.uid}`, date, slot: '17:00', endMs: Date.now() + 3 * 60 * 60 * 1000 },
        ],
      });
    });
  } finally {
    await Promise.all([deleteApp(owner.app), deleteApp(admin.app), deleteApp(user.app)]);
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
  console.error('rules smoke test failed:', e);
  process.exitCode = 1;
});
