import { useEffect, useMemo, useState } from 'react';
import { Alert, Dimensions, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Button, Dialog, IconButton, Portal, Text, TextInput } from 'react-native-paper';
import { auth, db } from '@/src/firebase';
import { addDays, hourLabel, hourSlot, hoursRange, startOfDay, toYmd } from '@/src/time';
import { collection, doc, onSnapshot, runTransaction } from 'firebase/firestore';

export default function ReserveDialog({
  visible,
  onDismiss,
}: {
  visible: boolean;
  onDismiss: () => void;
}) {
  const [title, setTitle] = useState('');
  const [selectedDay, setSelectedDay] = useState(() => startOfDay(new Date()));
  const [bookedSlots, setBookedSlots] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const date = useMemo(() => toYmd(selectedDay), [selectedDay]);
  const hours = useMemo(() => hoursRange(8, 21), []);

  const dayLabel = useMemo(
    () => selectedDay.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }),
    [selectedDay]
  );

  // Reset on open
  useEffect(() => {
    if (!visible) return;
    setTitle('');
    setSelected(new Set());
    setSelectedDay(startOfDay(new Date()));
  }, [visible]);

  // Live slot status for selected date
  useEffect(() => {
    if (!visible) return;
    setSelected(new Set());
    const ref = collection(db, 'schedule', date, 'slots');
    const unsub = onSnapshot(ref, (snap) => setBookedSlots(new Set(snap.docs.map((d) => d.id))), () => {});
    return unsub;
  }, [visible, date]);

  function toggleSlot(slot: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slot)) next.delete(slot);
      else next.add(slot);
      return next;
    });
  }

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
          throw new Error(`Slot(s) ${taken.map((t) => t.slot).join(', ')} already booked.`);
        }

        for (const { slot, slotRef } of reads) {
          const payload = {
            date,
            slot,
            userId: u.uid,
            name: title.trim(),
            email: u.email || '',
            createdAt: Date.now(),
          };
          tx.set(slotRef, payload);
          tx.set(doc(db, 'bookings', `${date}_${slot}_${u.uid}`), payload);
        }
      });

      onDismiss();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to reserve');
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
            <TextInput
              label="Title"
              mode="outlined"
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Maintenance, Event…"
              style={s.titleInput}
            />

            <View style={s.dateNav}>
              <IconButton icon="chevron-left" onPress={() => setSelectedDay((d) => addDays(d, -1))} size={20} />
              <Text style={s.dateLabel}>{dayLabel}</Text>
              <IconButton icon="chevron-right" onPress={() => setSelectedDay((d) => addDays(d, 1))} size={20} />
            </View>

            <Button
              mode="text"
              compact
              onPress={() => setSelectedDay(startOfDay(new Date()))}
              style={s.todayBtn}
            >
              Today
            </Button>

            <Text style={s.hint}>Tap to select slots:</Text>

            <View style={s.grid}>
              {hours.map((h) => {
                const slot = hourSlot(h);
                const booked = bookedSlots.has(slot);
                const sel = selected.has(slot);
                return (
                  <TouchableOpacity
                    key={slot}
                    style={[s.chip, booked && s.chipBooked, sel && s.chipSelected]}
                    disabled={booked}
                    onPress={() => toggleSlot(slot)}
                  >
                    <Text style={[s.chipText, booked && s.chipTextBooked, sel && s.chipTextSelected]}>
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
          <Button mode="text" onPress={onDismiss}>
            Cancel
          </Button>
          <Button
            mode="contained"
            onPress={reserve}
            loading={busy}
            disabled={busy || selected.size === 0 || title.trim().length === 0}
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

  titleInput: { marginBottom: 16 },
  dateNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  dateLabel: { fontWeight: '700', fontSize: 15 },
  todayBtn: { alignSelf: 'center', marginBottom: 8 },
  hint: { opacity: 0.6, marginBottom: 8, fontSize: 13 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#141414',
  },
  chipBooked: { opacity: 0.35, backgroundColor: '#0B0B0B' },
  chipSelected: { backgroundColor: '#D7263D', borderColor: '#D7263D' },
  chipText: { color: '#FFFFFF', fontSize: 13 },
  chipTextBooked: { textDecorationLine: 'line-through' },
  chipTextSelected: { color: '#FFFFFF', fontWeight: '700' },

  summary: { marginTop: 12, fontWeight: '700' },
});
