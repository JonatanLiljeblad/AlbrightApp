import { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, StyleSheet, View } from 'react-native';
import { Button, Card, ProgressBar, Text } from 'react-native-paper';
import { auth, db } from '@/src/firebase';
import { canBook } from '@/src/bookingRules';
import { hourLabel, hourSlot, hoursRange, toYmd } from '@/src/time';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, doc, onSnapshot, runTransaction } from 'firebase/firestore';

type SlotRow = { slot: string; label: string; bookedBy?: string };

export default function ScheduleScreen() {
  const date = useMemo(() => toYmd(new Date()), []);
  const [rows, setRows] = useState<SlotRow[]>([]);
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const hours = useMemo(() => hoursRange(8, 21), []);

  const nowLabel = useMemo(() => {
    const d = new Date(nowMs);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, [nowMs]);

  function slotStartMs(slot: string) {
    const [y, m, d] = date.split('-').map(Number);
    const [hh] = slot.split(':').map(Number);
    return new Date(y, m - 1, d, hh, 0, 0, 0).getTime();
  }

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  function setFromSnapshot(docs: Array<{ id: string; data: any }>) {
    const booked = new Map<string, any>();
    docs.forEach((d) => booked.set(d.id, d.data));

    setRows(
      hours.map((h) => {
        const slot = hourSlot(h);
        const b = booked.get(slot);
        return { slot, label: hourLabel(h), bookedBy: b?.name };
      })
    );
  }

  async function refreshOnce() {
    try {
      const ref = collection(db, 'schedule', date, 'slots');
      const snap = await (await import('firebase/firestore')).getDocs(ref);
      setFromSnapshot(snap.docs.map((d) => ({ id: d.id, data: d.data() })));
    } catch {
      // Ignore permission errors; UI will still be usable after rules are set.
    }
  }

  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);

  useEffect(() => onAuthStateChanged(auth, (u) => setUid(u?.uid ?? null)), []);

  useEffect(() => {
    if (!uid) return;
    const ref = collection(db, 'schedule', date, 'slots');
    const unsub = onSnapshot(
      ref,
      (snap) => setFromSnapshot(snap.docs.map((d) => ({ id: d.id, data: d.data() }))),
      () => {
        // Ignore permission errors during auth transitions.
      }
    );
    return unsub;
  }, [uid]);

  async function book(slot: string) {
    const u = auth.currentUser;
    if (!u) return;

    const start = slotStartMs(slot);
    const end = start + 60 * 60 * 1000;
    if (nowMs >= end) {
      Alert.alert('Cannot book', 'That time has already passed.');
      return;
    }

    const allowed = await canBook(u.uid, date);
    if (!allowed.ok) {
      Alert.alert('Cannot book', allowed.reason);
      return;
    }

    try {
      setBusySlot(slot);
      const slotRef = doc(db, 'schedule', date, 'slots', slot);
      const bookingRef = doc(db, 'bookings', `${date}_${slot}_${u.uid}`);

      await runTransaction(db, async (tx) => {
        const existing = await tx.get(slotRef);
        if (existing.exists()) throw new Error('This slot is already booked.');

        const payload = {
          date,
          slot,
          userId: u.uid,
          name: u.displayName || u.email || 'User',
          email: u.email || '',
          createdAt: Date.now(),
        };

        tx.set(slotRef, payload);
        tx.set(bookingRef, payload);
      });

      await refreshOnce();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to book');
    } finally {
      setBusySlot(null);
    }
  }

  return (
    <View style={styles.container}>
      <Card style={styles.header} mode="elevated">
        <Card.Title title="Schedule" subtitle={`${date} • ${nowLabel}`} />
        <Card.Content>
          <Text style={styles.muted}>Tap a time to book it. Booked slots show the name.</Text>
          <Button mode="outlined" onPress={refreshOnce} style={styles.refresh}>
            Refresh
          </Button>
        </Card.Content>
      </Card>

      <FlatList
        contentContainerStyle={styles.list}
        data={rows}
        keyExtractor={(r) => r.slot}
        renderItem={({ item }) => {
          const start = slotStartMs(item.slot);
          const end = start + 60 * 60 * 1000;
          const isPast = nowMs >= end;
          const isCurrent = nowMs >= start && nowMs < end;
          const progress = isCurrent ? (nowMs - start) / (60 * 60 * 1000) : isPast ? 1 : 0;

          const subtitle = item.bookedBy
            ? `Booked by ${item.bookedBy}`
            : isPast
              ? 'Passed'
              : isCurrent
                ? 'In progress'
                : 'Available';

          const disabled = !!item.bookedBy || busySlot === item.slot || isPast;

          return (
            <Card style={[styles.row, isPast && styles.rowPast]} mode="outlined">
              <Card.Title title={item.label} subtitle={subtitle} />
              {isCurrent && (
                <Card.Content>
                  <ProgressBar progress={progress} style={styles.progress} />
                </Card.Content>
              )}
              <Card.Actions>
                <Button
                  mode={item.bookedBy ? 'outlined' : 'contained'}
                  disabled={disabled}
                  loading={busySlot === item.slot}
                  onPress={() => book(item.slot)}>
                  Book
                </Button>
              </Card.Actions>
            </Card>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { margin: 16, borderRadius: 16 },
  muted: { opacity: 0.7 },
  refresh: { marginTop: 10, alignSelf: 'flex-start' },
  list: { padding: 16, paddingTop: 0, gap: 10 },
  row: { borderRadius: 14 },
  rowPast: { opacity: 0.45 },
  progress: { marginTop: 6, borderRadius: 999 },
});
