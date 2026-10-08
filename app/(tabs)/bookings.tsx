import { useEffect, useRef, useState } from 'react';
import { useIsFocused } from 'expo-router';
import { Alert, StyleSheet } from 'react-native';
import { Button, Card, Text } from 'react-native-paper';
import { hydrateBookingGuardIfNeeded, normalizeActiveGuard } from '@/src/bookingRules';
import { auth, db } from '@/src/firebase';
import { unbookScheduleSlot } from '@/src/scheduleActions';
import type { ActiveBookingGuard } from '@/src/types';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';

export default function MyBookingsScreen() {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [bookings, setBookings] = useState<ActiveBookingGuard[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const isFocused = useIsFocused();
  const hydratedGuardUids = useRef<Set<string>>(new Set());

  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);

  useEffect(() => onAuthStateChanged(auth, (u) => setUid(u?.uid ?? null)), []);

  useEffect(() => {
    if (!uid) {
      setBookings([]);
      setLoadError(null);
      return;
    }
    if (!isFocused) return;

    if (!hydratedGuardUids.current.has(uid)) {
      hydratedGuardUids.current.add(uid);
      void hydrateBookingGuardIfNeeded(uid, Date.now(), db).catch((e) => {
        console.warn('[MyBookingsScreen] Guard hydration failed', e);
        setLoadError('Could not load your bookings right now.');
      });
    }

    const guardRef = doc(db, 'bookingGuards', uid);
    const unsub = onSnapshot(
      guardRef,
      (snap) => {
        setLoadError(null);
        setBookings(
          normalizeActiveGuard((snap.data() as { active?: unknown } | undefined)?.active, Date.now()).sort((a, b) =>
            `${a.date}_${a.slot}`.localeCompare(`${b.date}_${b.slot}`)
          )
        );
      },
      (e) => {
        console.warn('[MyBookingsScreen] Live booking guard subscription failed', e);
        setLoadError('Could not load your bookings right now.');
      }
    );
    return unsub;
  }, [uid, isFocused]);

  async function unbook(b: ActiveBookingGuard) {
    const u = auth.currentUser;
    if (!u) return;

    const key = b.id;

    try {
      setBusyKey(key);
      await unbookScheduleSlot({
        db,
        userId: u.uid,
        booking: b,
      });
    } catch (e: any) {
      console.warn('[MyBookingsScreen] Unbook failed', e);
      Alert.alert('Error', e?.message ?? 'Failed to unbook');
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <Card style={styles.card} mode="elevated">
      <Card.Title title="My bookings" />
      <Card.Content>
        {!!loadError && <Text style={styles.error}>{loadError}</Text>}
        {bookings.length === 0 ? (
          <Text>You have no active bookings.</Text>
        ) : (
          bookings.map((b) => {
            const key = b.id;
            const busy = busyKey === key;
            return (
              <Card key={key} style={styles.item} mode="outlined">
                <Card.Title title={`${b.date} — ${b.slot}`} subtitle="Active booking" />
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
  error: { marginBottom: 10, color: '#D7263D' },
  item: { marginTop: 12, borderRadius: 14 },
});
