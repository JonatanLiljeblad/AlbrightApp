import { useEffect, useState } from 'react';
import { Alert, StyleSheet } from 'react-native';
import { Button, Card, Text } from 'react-native-paper';
import { auth, db } from '@/src/firebase';
import { slotEndMs } from '@/src/time';
import type { Booking } from '@/src/types';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, onSnapshot, query, runTransaction, where } from 'firebase/firestore';

export default function MyBookingsScreen() {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);

  function activeBookings(docs: Array<{ data: Booking }>) {
    const now = Date.now();
    const active = docs
      .map((d) => d.data)
      .filter((b) => {
        const endMs = slotEndMs(b.date, b.slot);
        return Number.isFinite(endMs) && endMs > now;
      });
    active.sort((a, b) => `${a.date}_${a.slot}`.localeCompare(`${b.date}_${b.slot}`));
    return active;
  }

  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);

  useEffect(() => onAuthStateChanged(auth, (u) => setUid(u?.uid ?? null)), []);

  useEffect(() => {
    if (!uid) return;
    const q = query(collection(db, 'bookings'), where('userId', '==', uid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setBookings(activeBookings(snap.docs.map((d) => ({ data: d.data() as Booking }))));
      },
      () => {
        // Ignore permission errors during auth transitions.
      }
    );
    return unsub;
  }, [uid]);

  async function unbook(b: Booking) {
    const u = auth.currentUser;
    if (!u) return;

    const key = `${b.date}_${b.slot}`;

    try {
      setBusyKey(key);
      const slotRef = doc(db, 'schedule', b.date, 'slots', b.slot);
      const bookingRef = doc(db, 'bookings', `${b.date}_${b.slot}_${u.uid}`);

      await runTransaction(db, async (tx) => {
        const slotSnap = await tx.get(slotRef);
        if (slotSnap.exists()) {
          const data = slotSnap.data() as { userId?: string };
          if (data.userId && data.userId !== u.uid) {
            throw new Error('You can only unbook your own slot.');
          }
        }

        tx.delete(bookingRef);
        tx.delete(slotRef);
      });
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to unbook');
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <Card style={styles.card} mode="elevated">
      <Card.Title title="My bookings" />
      <Card.Content>
        {bookings.length === 0 ? (
          <Text>You have no active bookings.</Text>
        ) : (
          bookings.map((b) => {
            const key = `${b.date}_${b.slot}`;
            const busy = busyKey === key;
            return (
              <Card key={key} style={styles.item} mode="outlined">
                <Card.Title title={`${b.date} — ${b.slot}`} subtitle={`Booked as ${b.name}`} />
                <Card.Actions>
                  <Button mode="contained" onPress={() => unbook(b)} loading={busy} disabled={busy}>
                    Unbook
                  </Button>
                </Card.Actions>
              </Card>
            );
          })
        )}
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { margin: 16, borderRadius: 16 },
  item: { marginTop: 12, borderRadius: 14 },
});
