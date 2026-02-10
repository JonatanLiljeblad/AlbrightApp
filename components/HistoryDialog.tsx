import { useEffect, useMemo, useState } from 'react';
import { Dimensions, StyleSheet, TouchableOpacity, View } from 'react-native';
import { ActivityIndicator, Button, Card, Dialog, IconButton, Portal, Text } from 'react-native-paper';
import { db } from '@/src/firebase';
import { hourLabel, pad2 } from '@/src/time';
import type { Booking } from '@/src/types';
import { collection, getDocs } from 'firebase/firestore';

type Mode = 'menu' | 'by-user' | 'by-day';
type UserGroup = { name: string; email: string; userId: string; bookings: Booking[] };

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function firstDayOfWeek(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

function ymd(year: number, month: number, day: number) {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}

function fmtSlot(slot: string) {
  return hourLabel(parseInt(slot.split(':')[0], 10));
}

function fmtDate(d: string) {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function HistoryDialog({
  visible,
  onDismiss,
}: {
  visible: boolean;
  onDismiss: () => void;
}) {
  const [mode, setMode] = useState<Mode>('menu');
  const [allBookings, setAllBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(false);

  const [selectedUser, setSelectedUser] = useState<string | null>(null);

  const [calYear, setCalYear] = useState(() => new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Reset on open
  useEffect(() => {
    if (!visible) return;
    setMode('menu');
    setSelectedUser(null);
    setSelectedDate(null);
    const n = new Date();
    setCalYear(n.getFullYear());
    setCalMonth(n.getMonth());
    fetchAll();
  }, [visible]);

  async function fetchAll() {
    try {
      setLoading(true);
      const snap = await getDocs(collection(db, 'bookings'));
      const docs = snap.docs.map((d) => d.data() as Booking);
      docs.sort((a, b) => `${b.date}_${b.slot}`.localeCompare(`${a.date}_${a.slot}`));
      setAllBookings(docs);
    } catch {
      setAllBookings([]);
    } finally {
      setLoading(false);
    }
  }

  /* ---- derived data ---- */

  const userGroups = useMemo<UserGroup[]>(() => {
    const map = new Map<string, UserGroup>();
    for (const b of allBookings) {
      let g = map.get(b.userId);
      if (!g) {
        g = { name: b.name, email: b.email, userId: b.userId, bookings: [] };
        map.set(b.userId, g);
      }
      g.bookings.push(b);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [allBookings]);

  const bookedDates = useMemo(() => {
    const set = new Set<string>();
    for (const b of allBookings) set.add(b.date);
    return set;
  }, [allBookings]);

  const dayBookings = useMemo(
    () =>
      selectedDate
        ? allBookings.filter((b) => b.date === selectedDate).sort((a, b) => a.slot.localeCompare(b.slot))
        : [],
    [allBookings, selectedDate]
  );

  const userBookings = useMemo(
    () => userGroups.find((g) => g.userId === selectedUser)?.bookings ?? [],
    [userGroups, selectedUser]
  );

  const selectedUserName = useMemo(
    () => userGroups.find((g) => g.userId === selectedUser)?.name ?? '',
    [userGroups, selectedUser]
  );

  /* ---- navigation ---- */

  function goBack() {
    if (mode === 'by-user' && selectedUser) {
      setSelectedUser(null);
    } else if (mode === 'by-day' && selectedDate) {
      setSelectedDate(null);
    } else {
      setMode('menu');
    }
  }

  const nowYmd = useMemo(() => {
    const n = new Date();
    return ymd(n.getFullYear(), n.getMonth(), n.getDate());
  }, []);

  function canForward() {
    const n = new Date();
    return calYear < n.getFullYear() || (calYear === n.getFullYear() && calMonth < n.getMonth());
  }

  function prevMonth() {
    if (calMonth === 0) {
      setCalYear((y) => y - 1);
      setCalMonth(11);
    } else {
      setCalMonth((m) => m - 1);
    }
    setSelectedDate(null);
  }

  function nextMonth() {
    if (!canForward()) return;
    if (calMonth === 11) {
      setCalYear((y) => y + 1);
      setCalMonth(0);
    } else {
      setCalMonth((m) => m + 1);
    }
    setSelectedDate(null);
  }

  /* ---- calendar ---- */

  function renderCalendar() {
    const numDays = daysInMonth(calYear, calMonth);
    const offset = firstDayOfWeek(calYear, calMonth);
    const label = new Date(calYear, calMonth).toLocaleDateString([], {
      month: 'long',
      year: 'numeric',
    });

    const cells: (number | null)[] = Array(offset).fill(null);
    for (let d = 1; d <= numDays; d++) cells.push(d);
    while (cells.length % 7) cells.push(null);

    const weeks: (number | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

    return (
      <View>
        <View style={s.calNav}>
          <IconButton icon="chevron-left" onPress={prevMonth} size={20} />
          <Text style={s.calLabel}>{label}</Text>
          <IconButton icon="chevron-right" onPress={nextMonth} size={20} disabled={!canForward()} />
        </View>
        <View style={s.calRow}>
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
            <Text key={d} style={s.calHdr}>
              {d}
            </Text>
          ))}
        </View>
        {weeks.map((week, wi) => (
          <View key={wi} style={s.calRow}>
            {week.map((day, di) => {
              if (day == null) return <View key={di} style={s.calCell} />;
              const d = ymd(calYear, calMonth, day);
              const booked = bookedDates.has(d);
              const today = d === nowYmd;
              const future = d > nowYmd;
              const sel = selectedDate === d;

              return (
                <TouchableOpacity
                  key={di}
                  style={[s.calCell, booked && s.calBooked, today && s.calToday, sel && s.calSel]}
                  disabled={future}
                  onPress={() => setSelectedDate((prev) => (prev === d ? null : d))}
                >
                  <Text style={[s.calDay, future && s.calFuture, booked && !sel && s.calDayHL, sel && s.calDaySel]}>
                    {day}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>
    );
  }

  /* ---- title ---- */

  let title = 'Booking History';
  if (mode === 'by-user' && selectedUser) title = selectedUserName;
  else if (mode === 'by-user') title = 'History by User';
  else if (mode === 'by-day') title = 'History by Day';

  /* ---- render ---- */

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss} style={s.dialog}>
        <Dialog.Title style={s.dlgTitle}>{title}</Dialog.Title>
        <Dialog.ScrollArea style={s.scrollArea}>
          <Dialog.Content style={s.dlgContent}>
            {loading ? (
              <ActivityIndicator style={s.loader} />
            ) : mode === 'menu' ? (
              <View style={s.menu}>
                <Button
                  mode="contained"
                  icon="account-group"
                  onPress={() => setMode('by-user')}
                  style={s.menuBtn}
                  contentStyle={s.menuBtnIn}
                >
                  By User
                </Button>
                <Button
                  mode="contained"
                  icon="calendar-month"
                  onPress={() => setMode('by-day')}
                  style={s.menuBtn}
                  contentStyle={s.menuBtnIn}
                >
                  By Day
                </Button>
              </View>
            ) : mode === 'by-user' && !selectedUser ? (
              userGroups.length === 0 ? (
                <Text style={s.muted}>No booking history found.</Text>
              ) : (
                userGroups.map((g) => (
                  <TouchableOpacity key={g.userId} onPress={() => setSelectedUser(g.userId)}>
                    <Card style={s.item} mode="outlined">
                      <Card.Title
                        title={g.name}
                        subtitle={`${g.email} • ${g.bookings.length} booking${g.bookings.length === 1 ? '' : 's'}`}
                        right={() => <Text style={s.chevron}>›</Text>}
                      />
                    </Card>
                  </TouchableOpacity>
                ))
              )
            ) : mode === 'by-user' && selectedUser ? (
              userBookings.length === 0 ? (
                <Text style={s.muted}>No bookings found.</Text>
              ) : (
                userBookings.map((b, i) => (
                  <Card key={`${b.date}_${b.slot}_${i}`} style={s.item} mode="outlined">
                    <Card.Title title={fmtDate(b.date)} subtitle={fmtSlot(b.slot)} />
                  </Card>
                ))
              )
            ) : mode === 'by-day' ? (
              <>
                {renderCalendar()}
                {selectedDate && (
                  <>
                    <Text style={s.section}>
                      {dayBookings.length === 0
                        ? 'No bookings on this day.'
                        : `${dayBookings.length} booking${dayBookings.length === 1 ? '' : 's'}`}
                    </Text>
                    {dayBookings.map((b, i) => (
                      <Card key={`${b.slot}_${b.userId}_${i}`} style={s.item} mode="outlined">
                        <Card.Title title={fmtSlot(b.slot)} subtitle={`${b.name} (${b.email})`} />
                      </Card>
                    ))}
                  </>
                )}
              </>
            ) : null}
          </Dialog.Content>
        </Dialog.ScrollArea>
        <Dialog.Actions style={s.dlgActions}>
          {mode !== 'menu' && (
            <Button mode="text" onPress={goBack}>
              Back
            </Button>
          )}
          <Button mode="contained" onPress={onDismiss} style={s.closeBtn} contentStyle={s.closeBtnIn}>
            Close
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
  closeBtn: { minWidth: 120 },
  closeBtnIn: { paddingVertical: 6 },
  loader: { marginVertical: 24 },

  menu: { gap: 12, marginTop: 8 },
  menuBtn: {},
  menuBtnIn: { paddingVertical: 10 },

  item: { marginTop: 8, borderRadius: 12 },
  chevron: { fontSize: 24, opacity: 0.5, marginRight: 16 },
  muted: { opacity: 0.7 },
  section: { marginTop: 16, marginBottom: 4, fontWeight: '700' },

  calNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  calLabel: { fontWeight: '700', fontSize: 16 },
  calRow: { flexDirection: 'row' },
  calHdr: { flex: 1, textAlign: 'center', fontWeight: '700', opacity: 0.5, marginBottom: 4, fontSize: 12 },
  calCell: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8, margin: 1 },
  calBooked: { backgroundColor: 'rgba(215, 38, 61, 0.15)' },
  calToday: { borderWidth: 1.5, borderColor: '#D7263D' },
  calSel: { backgroundColor: '#D7263D' },
  calDay: { fontSize: 13, color: '#FFFFFF' },
  calFuture: { opacity: 0.25 },
  calDayHL: { color: '#D7263D' },
  calDaySel: { color: '#FFFFFF' },
});
