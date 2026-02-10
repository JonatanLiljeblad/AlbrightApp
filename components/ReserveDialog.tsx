import { useEffect, useMemo, useState } from 'react';
import { Alert, Dimensions, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Button, Card, Dialog, IconButton, Portal, Text, TextInput } from 'react-native-paper';
import { auth, db } from '@/src/firebase';
import { addDays, hourLabel, hourSlot, hoursRange, startOfDay, toYmd } from '@/src/time';
import { collection, deleteDoc, doc, onSnapshot, query, runTransaction, where } from 'firebase/firestore';

type SlotInfo = { slot: string; name: string; userId: string };

export default function ReserveDialog({
  visible,
  onDismiss,
}: {
  visible: boolean;
  onDismiss: () => void;
}) {
  const [title, setTitle] = useState('');
  const [selectedDay, setSelectedDay] = useState(() => startOfDay(new Date()));
  const [slotData, setSlotData] = useState<Map<string, SlotInfo>>(new Map());
  const [bookingSlots, setBookingSlots] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const date = useMemo(() => toYmd(selectedDay), [selectedDay]);
  const todayYmd = useMemo(() => toYmd(new Date()), []);
  const canGoBack = date > todayYmd;
  const hours = useMemo(() => hoursRange(8, 21), []);

  const dayLabel = useMemo(
    () => selectedDay.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }),
    [selectedDay]
  );

  // Reservations = slots in schedule that have no matching booking doc
  const reservations = useMemo(() => {
    const res: { slot: string; name: string }[] = [];
    slotData.forEach((data, slot) => {
      if (!bookingSlots.has(slot)) {
        res.push({ slot, name: data.name });
      }
    });
    return res.sort((a, b) => a.slot.localeCompare(b.slot));
  }, [slotData, bookingSlots]);

  // Reset on open
  useEffect(() => {
    if (!visible) return;
    setTitle('');
    setSelected(new Set());
    setSelectedDay(startOfDay(new Date()));
  }, [visible]);

  // Live data for selected date: schedule slots + bookings
  useEffect(() => {
    if (!visible) return;
    setSelected(new Set());

    const slotsRef = collection(db, 'schedule', date, 'slots');
    const unsubSlots = onSnapshot(
      slotsRef,
      (snap) => {
        const map = new Map<string, SlotInfo>();
        snap.docs.forEach((d) => {
          const data = d.data() as SlotInfo;
          map.set(d.id, data);
        });
        setSlotData(map);
      },
      () => {}
    );

    const bookingsQ = query(collection(db, 'bookings'), where('date', '==', date));
    const unsubBookings = onSnapshot(
      bookingsQ,
      (snap) => setBookingSlots(new Set(snap.docs.map((d) => (d.data() as SlotInfo).slot))),
      () => {}
    );

    return () => {
      unsubSlots();
      unsubBookings();
    };
  }, [visible, date]);

  function toggleSlot(slot: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slot)) next.delete(slot);
      else next.add(slot);
      return next;
    });
  }

  // Reserve: write ONLY to schedule (no booking doc → won't appear in My Bookings)
  async function reserve() {
    const u = auth.currentUser;
    if (!u || selected.size === 0 || title.trim().length === 0) return;

    try {
      setBusy(true);
      const slots = Array.from(selected).sort();

      await runTransaction(db, async (tx) => {
        const reads = await Promise.all(
          slots.map(async (slot) => {
            const slotRef = doc(db, 'schedule', date, 'slots', slot);
            const snap = await tx.get(slotRef);
            return { slot, exists: snap.exists(), slotRef };
          })
        );

        const taken = reads.filter((r) => r.exists);
        if (taken.length > 0) {
          throw new Error(`Slot(s) ${taken.map((t) => t.slot).join(', ')} already taken.`);
        }

        for (const { slot, slotRef } of reads) {
          tx.set(slotRef, {
            date,
            slot,
            userId: u.uid,
            name: title.trim(),
            email: u.email || '',
            createdAt: Date.now(),
          });
        }
      });

      setSelected(new Set());
      setTitle('');
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to reserve');
    } finally {
      setBusy(false);
    }
  }

  // Unreserve: delete schedule slot doc
  async function unreserve(slot: string) {
    try {
      setBusy(true);
      await deleteDoc(doc(db, 'schedule', date, 'slots', slot));
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to unreserve');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss} style={s.dialog}>
        <Dialog.Title style={s.dlgTitle}>Reserve Time</Dialog.Title>
        <Dialog.ScrollArea style={s.scrollArea}>
          <Dialog.Content style={s.dlgContent}>
            <View style={s.dateNav}>
              <IconButton
                icon="chevron-left"
                onPress={() => setSelectedDay((d) => addDays(d, -1))}
                size={22}
                disabled={!canGoBack}
              />
              <Text style={s.dateLabel}>{dayLabel}</Text>
              <IconButton icon="chevron-right" onPress={() => setSelectedDay((d) => addDays(d, 1))} size={22} />
            </View>

            {!canGoBack ? null : (
              <Button mode="text" compact onPress={() => setSelectedDay(startOfDay(new Date()))} style={s.todayBtn}>
                Back to today
              </Button>
            )}

            {/* Current reservations for this date */}
            {reservations.length > 0 && (
              <>
                <Text style={s.sectionTitle}>Reservations</Text>
                {reservations.map((r) => (
                  <Card key={r.slot} style={s.resCard} mode="outlined">
                    <Card.Title
                      title={r.name}
                      subtitle={hourLabel(parseInt(r.slot.split(':')[0], 10))}
                    />
                    <Card.Actions>
                      <Button
                        mode="contained-tonal"
                        textColor="#D7263D"
                        disabled={busy}
                        onPress={() => unreserve(r.slot)}
                        contentStyle={s.actionContent}
                      >
                        Unreserve
                      </Button>
                    </Card.Actions>
                  </Card>
                ))}
              </>
            )}

            {/* New reservation */}
            <Text style={s.sectionTitle}>New Reservation</Text>

            <TextInput
              label="Title"
              mode="outlined"
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Maintenance, Event…"
              style={s.titleInput}
            />

            <Text style={s.hint}>Tap to select slots:</Text>

            <View style={s.grid}>
              {hours.map((h) => {
                const slot = hourSlot(h);
                const isBooked = slotData.has(slot) && bookingSlots.has(slot);
                const isReserved = slotData.has(slot) && !bookingSlots.has(slot);
                const taken = isBooked || isReserved;
                const sel = selected.has(slot);
                return (
                  <TouchableOpacity
                    key={slot}
                    style={[s.chip, isBooked && s.chipBooked, isReserved && s.chipReserved, sel && s.chipSelected]}
                    disabled={taken}
                    onPress={() => toggleSlot(slot)}
                  >
                    <Text
                      style={[
                        s.chipText,
                        isBooked && s.chipTextBooked,
                        isReserved && s.chipTextReserved,
                        sel && s.chipTextSelected,
                      ]}
                    >
                      {hourLabel(h)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {selected.size > 0 && (
              <Text style={s.summary}>
                {selected.size} slot{selected.size === 1 ? '' : 's'} selected
              </Text>
            )}
          </Dialog.Content>
        </Dialog.ScrollArea>
        <Dialog.Actions style={s.dlgActions}>
          <Button mode="text" onPress={onDismiss} contentStyle={s.actionContent}>
            Close
          </Button>
          <Button
            mode="contained"
            onPress={reserve}
            loading={busy}
            disabled={busy || selected.size === 0 || title.trim().length === 0}
            contentStyle={s.actionContent}
          >
            Reserve
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const s = StyleSheet.create({
  dialog: { alignSelf: 'center', width: '94%', maxWidth: 560 },
  dlgTitle: { width: '100%', textAlign: 'center', paddingHorizontal: 0 },
  dlgContent: { paddingBottom: 16 },
  dlgActions: { justifyContent: 'center', paddingHorizontal: 24, paddingBottom: 8, gap: 8 },
  scrollArea: { maxHeight: Dimensions.get('window').height * 0.65, borderTopWidth: 0, borderBottomWidth: 0 },
  actionContent: { paddingVertical: 6 },

  dateNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, marginBottom: 4 },
  dateLabel: { fontWeight: '700', fontSize: 16 },
  todayBtn: { alignSelf: 'center', marginBottom: 4 },

  sectionTitle: { fontWeight: '700', marginTop: 14, marginBottom: 8 },
  resCard: { marginBottom: 8, borderRadius: 12 },

  titleInput: { marginBottom: 14 },
  hint: { opacity: 0.6, marginBottom: 10, fontSize: 13 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: {
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#141414',
  },
  chipBooked: { opacity: 0.3, backgroundColor: '#0B0B0B' },
  chipReserved: { opacity: 0.5, backgroundColor: '#3A0B12', borderColor: '#D7263D' },
  chipSelected: { backgroundColor: '#D7263D', borderColor: '#D7263D' },
  chipText: { color: '#FFFFFF', fontSize: 15 },
  chipTextBooked: { textDecorationLine: 'line-through' },
  chipTextReserved: { color: '#D7263D' },
  chipTextSelected: { color: '#FFFFFF', fontWeight: '700' },

  summary: { marginTop: 14, fontWeight: '700' },
});
