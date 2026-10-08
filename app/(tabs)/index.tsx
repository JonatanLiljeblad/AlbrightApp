import { useEffect, useMemo, useState } from 'react';
import { useIsFocused } from 'expo-router';
import { Alert, FlatList, StyleSheet, View } from 'react-native';
import { Button, Card, IconButton, ProgressBar, Text } from 'react-native-paper';
import { auth, db } from '@/src/firebase';
import { bookScheduleSlot } from '@/src/scheduleActions';
import {
  loadScheduleDay,
  subscribeToScheduleDay,
} from '@/src/schedule';
import { addDays, hourLabel, hourSlot, hoursRange, slotStartMs as slotStartMsUtil, startOfDay, toYmd } from '@/src/time';
import type { ScheduleDay } from '@/src/types';
import { onAuthStateChanged } from 'firebase/auth';

type SlotRow = { slot: string; label: string; bookedBy?: string };

export default function ScheduleScreen() {
  const [rows, setRows] = useState<SlotRow[]>([]);
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const isFocused = useIsFocused();

  const [selectedDay, setSelectedDay] = useState(() => startOfDay(new Date()));
  const date = useMemo(() => toYmd(selectedDay), [selectedDay]);

  const hours = useMemo(() => hoursRange(8, 21), []);

  const nowLabel = useMemo(() => {
    const d = new Date(nowMs);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, [nowMs]);

  const todayYmd = useMemo(() => toYmd(new Date(nowMs)), [nowMs]);
  const selectedLabel = useMemo(() => {
    return selectedDay.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  }, [selectedDay]);

  function isPastSlot(slot: string) {
    if (date < todayYmd) return true;
    if (date > todayYmd) return false;
    const start = slotStartMsUtil(date, slot);
    const end = start + 60 * 60 * 1000;
    return nowMs >= end;
  }

  function isCurrentSlot(slot: string) {
    if (date !== todayYmd) return false;
    const start = slotStartMsUtil(date, slot);
    const end = start + 60 * 60 * 1000;
    return nowMs >= start && nowMs < end;
  }

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  function setFromSnapshot(day: ScheduleDay) {
    setRows(
      hours.map((h) => {
        const slot = hourSlot(h);
        const b = day.slots[slot];
        return { slot, label: hourLabel(h), bookedBy: b?.name };
      })
    );
  }

  async function refreshOnce() {
    try {
      setLoadError(null);
      setFromSnapshot(await loadScheduleDay(date, db));
    } catch (e) {
      console.warn('[ScheduleScreen] Refresh failed', e);
      setLoadError('Could not refresh schedule right now.');
    }
  }

  const [uid, setUid] = useState<string | null>(auth.currentUser?.uid ?? null);

  useEffect(() => onAuthStateChanged(auth, (u) => setUid(u?.uid ?? null)), []);

  useEffect(() => {
    if (!uid) {
      setRows([]);
      setLoadError(null);
      return;
    }
    if (!isFocused) return;

    let active = true;
    let unsub: (() => void) | undefined;

    void subscribeToScheduleDay(
      date,
      (day) => {
        if (!active) return;
        setLoadError(null);
        setFromSnapshot(day);
      },
      (e) => {
        if (!active) return;
        console.warn('[ScheduleScreen] Live schedule subscription failed', e);
        setLoadError('Could not load schedule right now.');
      },
      db,
    )
      .then((nextUnsub) => {
        if (active) {
          unsub = nextUnsub;
          return;
        }
        nextUnsub();
      })
      .catch((e) => {
        if (!active) return;
        console.warn('[ScheduleScreen] Live schedule subscription failed', e);
        setLoadError('Could not load schedule right now.');
      });

    return () => {
      active = false;
      unsub?.();
    };
  }, [uid, date, isFocused]);

  async function book(slot: string) {
    const u = auth.currentUser;
    if (!u) return;

    if (isPastSlot(slot)) {
      Alert.alert('Cannot book', 'That time has already passed.');
      return;
    }

    try {
      setBusySlot(slot);
      await bookScheduleSlot({
        db,
        user: {
          uid: u.uid,
          email: u.email,
          displayName: u.displayName,
        },
        date,
        slot,
      });
    } catch (e: any) {
      console.warn('[ScheduleScreen] Booking failed', e);
      Alert.alert('Error', e?.message ?? 'Failed to book');
    } finally {
      setBusySlot(null);
    }
  }

  return (
    <View style={styles.container}>
      <Card style={styles.header} mode="elevated">
        <Card.Title title="Schedule" subtitle={`${selectedLabel} • ${nowLabel}`} />
        <Card.Content>
          <View style={styles.navRow}>
            <IconButton icon="chevron-left" onPress={() => setSelectedDay((d) => addDays(d, -1))} />
            <Button mode="contained" onPress={() => setSelectedDay(startOfDay(new Date()))}>
              Today
            </Button>
            <IconButton icon="chevron-right" onPress={() => setSelectedDay((d) => addDays(d, 1))} />
            <View style={{ flex: 1 }} />
            <Button mode="contained" onPress={refreshOnce}>
              Refresh
            </Button>
          </View>
          <Text style={styles.muted}>Tap a time to book it. Booked slots show the name.</Text>
          {!!loadError && <Text style={styles.error}>{loadError}</Text>}
        </Card.Content>
      </Card>

      <FlatList
        contentContainerStyle={styles.list}
        data={rows}
        keyExtractor={(r) => r.slot}
        renderItem={({ item }) => {
          const start = slotStartMsUtil(date, item.slot);
          const isPast = isPastSlot(item.slot);
          const isCurrent = isCurrentSlot(item.slot);
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
                  mode="contained"
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
  error: { marginTop: 8, color: '#D7263D' },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  list: { padding: 16, paddingTop: 0, gap: 10 },
  row: { borderRadius: 14 },
  rowPast: { opacity: 0.45 },
  progress: { marginTop: 6, borderRadius: 999 },
});
