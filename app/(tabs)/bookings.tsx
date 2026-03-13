import { useEffect, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import { Alert, StyleSheet } from 'react-native';
import { Button, Card, Text } from 'react-native-paper';
import { hydrateBookingGuardIfNeeded, normalizeActiveGuard, removeBookingFromGuardInTransaction } from '@/src/bookingRules';
import { auth, db } from '@/src/firebase';
import {
  detectScheduleBackend,
  normalizeScheduleDay,
  removeScheduleSlot,
  scheduleDayRef,
  scheduleSlotRef,
} from '@/src/schedule';
import type { ActiveBookingGuard } from '@/src/types';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot, runTransaction } from 'firebase/firestore';

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
      void hydrateBookingGuardIfNeeded(uid).catch((e) => {
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
      const backend = await detectScheduleBackend(b.date);
      const bookingRef = doc(db, 'bookings', b.id);

      await runTransaction(db, async (tx) => {
        if (backend === 'legacy-slot-subcollection') {
          const slotRef = scheduleSlotRef(b.date, b.slot);
          const slotSnap = await tx.get(slotRef);
          const slotData = slotSnap.data() as { userId?: unknown } | undefined;
          if (typeof slotData?.userId === 'string' && slotData.userId !== u.uid) {
            throw new Error('You can only unbook your own slot.');
          }
          await removeBookingFromGuardInTransaction(tx, u.uid, b.date, b.slot);
          if (slotSnap.exists()) {
            tx.delete(slotRef);
          }
        } else {
          const dayRef = scheduleDayRef(b.date);
          const daySnap = await tx.get(dayRef);
          let nextSlots: ReturnType<typeof removeScheduleSlot> | null = null;
          let shouldUpdateDay = false;
          if (daySnap.exists()) {
            const day = normalizeScheduleDay(daySnap.data());
            const data = day.slots[b.slot];
            if (data?.userId && data.userId !== u.uid) {
              throw new Error('You can only unbook your own slot.');
            }
            nextSlots = removeScheduleSlot(day.slots, b.slot);
            shouldUpdateDay = nextSlots !== day.slots;
          }

          await removeBookingFromGuardInTransaction(tx, u.uid, b.date, b.slot);

          if (daySnap.exists() && nextSlots && shouldUpdateDay) {
            tx.set(dayRef, { slots: nextSlots });
          }
        }

        tx.delete(bookingRef);
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
