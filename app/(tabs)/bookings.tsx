import { useEffect, useState } from 'react';
import { Alert, StyleSheet } from 'react-native';
import { Button, Card, Text } from 'react-native-paper';
import { auth, db } from '@/src/firebase';
import { collection, deleteDoc, doc, getDocs, query, where } from 'firebase/firestore';

export default function MyBookingsScreen() {
  const [busy, setBusy] = useState(false);
  const [booking, setBooking] = useState<any | null>(null);

  async function load() {
    const u = auth.currentUser;
    if (!u) return;
    const q = query(collection(db, 'bookings'), where('userId', '==', u.uid));
    const snap = await getDocs(q);

    const now = Date.now();
    const docs = snap.docs.map((d) => d.data() as any);
    const active = docs.filter((b) => {
      const endMs = Date.parse(`${b.date}T${b.slot}:00`) + 60 * 60 * 1000;
      return Number.isFinite(endMs) && endMs > now;
    });
    active.sort((a, b) => `${a.date}_${a.slot}`.localeCompare(`${b.date}_${b.slot}`));
    setBooking(active[0] ?? null);
  }

  useEffect(() => {
    load();
  }, []);

  async function unbook() {
    const u = auth.currentUser;
    if (!u || !booking) return;

    try {
      setBusy(true);
      const slotRef = doc(db, 'schedule', booking.date, 'slots', booking.slot);
      const bookingRef = doc(db, 'bookings', `${booking.date}_${booking.slot}_${u.uid}`);
      await deleteDoc(bookingRef);
      await deleteDoc(slotRef);
      setBooking(null);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to unbook');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={styles.card} mode="elevated">
      <Card.Title title="My bookings" />
      <Card.Content>
        {!booking ? (
          <Text>You have no active bookings.</Text>
        ) : (
          <>
            <Text style={styles.big}>
              {booking.date} — {booking.slot}
            </Text>
            <Text style={styles.muted}>Booked as {booking.name}</Text>
            <Button mode="contained" onPress={unbook} loading={busy} disabled={busy} style={styles.btn}>
              Unbook
            </Button>
          </>
        )}
      </Card.Content>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { margin: 16, borderRadius: 16 },
  big: { marginTop: 8, fontSize: 18 },
  muted: { opacity: 0.7, marginTop: 4 },
  btn: { marginTop: 14 },
});
