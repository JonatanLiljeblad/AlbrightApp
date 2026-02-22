import { auth, db } from "@/src/firebase";
import {
  addDays,
  hourLabel,
  hourSlot,
  hoursRange,
  slotEndMs,
  startOfDay,
  toYmd,
} from "@/src/time";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  runTransaction,
  where,
} from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Dimensions,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import {
  Button,
  Card,
  Dialog,
  IconButton,
  Portal,
  Text,
  TextInput,
} from "react-native-paper";

type SlotInfo = { slot: string; name: string; userId: string };
type Mode = "menu" | "reserve" | "manage";

export default function ReserveDialog({
  visible,
  onDismiss,
  reservedByRole,
}: {
  visible: boolean;
  onDismiss: () => void;
  reservedByRole: "owner" | "admin";
}) {
  const [mode, setMode] = useState<Mode>("menu");
  const [title, setTitle] = useState("");
  const [selectedDay, setSelectedDay] = useState(() => startOfDay(new Date()));
  const [slotData, setSlotData] = useState<Map<string, SlotInfo>>(new Map());
  const [bookingSlots, setBookingSlots] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const date = useMemo(() => toYmd(selectedDay), [selectedDay]);
  const todayYmd = useMemo(() => toYmd(new Date(nowMs)), [nowMs]);
  const canGoBack = date > todayYmd;
  const hours = useMemo(() => hoursRange(8, 21), []);

  const dayLabel = useMemo(
    () =>
      selectedDay.toLocaleDateString([], {
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
    [selectedDay],
  );

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
    setMode("menu");
    setTitle("");
    setSelected(new Set());
    setLoadError(null);
    setSelectedDay(startOfDay(new Date()));
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [visible]);

  // Live data for selected date
  useEffect(() => {
    if (!visible) return;
    setSelected(new Set());

    const slotsRef = collection(db, "schedule", date, "slots");
    const unsubSlots = onSnapshot(
      slotsRef,
      (snap) => {
        setLoadError(null);
        const map = new Map<string, SlotInfo>();
        snap.docs.forEach((d) => map.set(d.id, d.data() as SlotInfo));
        setSlotData(map);
      },
      (e) => {
        console.warn("[ReserveDialog] Failed loading schedule slots", e);
        setLoadError("Could not load schedule data.");
      },
    );

    const bookingsQ = query(
      collection(db, "bookings"),
      where("date", "==", date),
    );
    const unsubBookings = onSnapshot(
      bookingsQ,
      (snap) => {
        setLoadError(null);
        setBookingSlots(
          new Set(snap.docs.map((d) => (d.data() as SlotInfo).slot)),
        );
      },
      (e) => {
        console.warn("[ReserveDialog] Failed loading booking slots", e);
        setLoadError("Could not load booking data.");
      },
    );

    return () => {
      unsubSlots();
      unsubBookings();
    };
  }, [visible, date]);

  function toggleSlot(slot: string) {
    if (isPastSlot(slot)) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slot)) next.delete(slot);
      else next.add(slot);
      return next;
    });
  }

  function isPastSlot(slot: string, atMs = nowMs) {
    const currentYmd = toYmd(new Date(atMs));
    if (date < currentYmd) return true;
    if (date > currentYmd) return false;
    return atMs >= slotEndMs(date, slot);
  }

  async function reserve() {
    const u = auth.currentUser;
    if (!u || selected.size === 0 || title.trim().length === 0) return;

    try {
      setBusy(true);
      const slots = Array.from(selected).sort();
      const passed = slots.filter((slot) => isPastSlot(slot, Date.now()));
      if (passed.length > 0) {
        throw new Error(`Slot(s) ${passed.join(", ")} have already passed.`);
      }

      await runTransaction(db, async (tx) => {
        const reads = await Promise.all(
          slots.map(async (slot) => {
            const slotRef = doc(db, "schedule", date, "slots", slot);
            const snap = await tx.get(slotRef);
            return { slot, exists: snap.exists(), slotRef };
          }),
        );

        const taken = reads.filter((r) => r.exists);
        if (taken.length > 0) {
          throw new Error(
            `Slot(s) ${taken.map((t) => t.slot).join(", ")} already taken.`,
          );
        }

        for (const { slot, slotRef } of reads) {
          const reason = title.trim();
          tx.set(slotRef, {
            date,
            slot,
            userId: u.uid,
            name: reason,
            email: u.email || "",
            createdAt: Date.now(),
            reservedByRole,
            reservedByUid: u.uid,
            reason,
          });
        }
      });

      setSelected(new Set());
      setTitle("");
    } catch (e: any) {
      console.warn("[ReserveDialog] Reserve failed", e);
      Alert.alert("Error", e?.message ?? "Failed to reserve");
    } finally {
      setBusy(false);
    }
  }

  async function unreserve(slot: string) {
    try {
      setBusy(true);
      await deleteDoc(doc(db, "schedule", date, "slots", slot));
    } catch (e: any) {
      console.warn("[ReserveDialog] Unreserve failed", e);
      Alert.alert("Error", e?.message ?? "Failed to unreserve");
    } finally {
      setBusy(false);
    }
  }

  /* ---- shared date nav ---- */
  function renderDateNav() {
    return (
      <>
        <View style={s.dateNav}>
          <IconButton
            icon="chevron-left"
            onPress={() => setSelectedDay((d) => addDays(d, -1))}
            size={22}
            disabled={!canGoBack}
          />
          <Text style={s.dateLabel}>{dayLabel}</Text>
          <IconButton
            icon="chevron-right"
            onPress={() => setSelectedDay((d) => addDays(d, 1))}
            size={22}
          />
        </View>
        {canGoBack && (
          <Button
            mode="text"
            compact
            onPress={() => setSelectedDay(startOfDay(new Date()))}
            style={s.todayBtn}
          >
            Back to today
          </Button>
        )}
      </>
    );
  }

  /* ---- title ---- */
  let dlgTitle = "Reserve Time";
  if (mode === "reserve") dlgTitle = "New Reservation";
  if (mode === "manage") dlgTitle = "Current Reservations";

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss} style={s.dialog}>
        <Dialog.Title style={s.dlgTitle}>{dlgTitle}</Dialog.Title>
        <Dialog.ScrollArea style={s.scrollArea}>
          <ScrollView contentContainerStyle={s.scrollContent}>
            {!!loadError && <Text style={s.errorText}>{loadError}</Text>}
            {mode === "menu" ? (
              <View style={s.menu}>
                <Button
                  mode="contained"
                  icon="clock-plus-outline"
                  onPress={() => setMode("reserve")}
                  contentStyle={s.menuBtnContent}
                >
                  Reserve Time
                </Button>
                <Button
                  mode="contained"
                  icon="clipboard-list-outline"
                  disabled={reservations.length === 0}
                  onPress={() => setMode("manage")}
                  contentStyle={s.menuBtnContent}
                >
                  Current Reservations
                  {reservations.length > 0 ? ` (${reservations.length})` : ""}
                </Button>
              </View>
            ) : mode === "reserve" ? (
              <>
                {renderDateNav()}

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
                    const isPast = isPastSlot(slot);
                    const isBooked =
                      slotData.has(slot) && bookingSlots.has(slot);
                    const isReserved =
                      slotData.has(slot) && !bookingSlots.has(slot);
                    const taken = isBooked || isReserved || isPast;
                    const sel = selected.has(slot);
                    return (
                      <TouchableOpacity
                        key={slot}
                        style={[
                          s.chip,
                          isPast && s.chipPast,
                          isBooked && s.chipBooked,
                          isReserved && s.chipReserved,
                          sel && s.chipSelected,
                        ]}
                        disabled={taken}
                        onPress={() => toggleSlot(slot)}
                      >
                        <Text
                          style={[
                            s.chipText,
                            isPast && s.chipTextPast,
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
                  {/* spacer chips to fill last row */}
                  {hours.length % 3 !== 0 &&
                    Array.from({ length: 3 - (hours.length % 3) }).map(
                      (_, i) => (
                        <View key={`spacer-${i}`} style={s.chipSpacer} />
                      ),
                    )}
                </View>

                {selected.size > 0 && (
                  <Text style={s.summary}>
                    {selected.size} slot{selected.size === 1 ? "" : "s"}{" "}
                    selected
                  </Text>
                )}
              </>
            ) : (
              /* manage mode */
              <>
                {renderDateNav()}

                {reservations.length === 0 ? (
                  <Text style={s.emptyText}>No reservations on this day.</Text>
                ) : (
                  reservations.map((r) => (
                    <Card key={r.slot} style={s.resCard} mode="outlined">
                      <Card.Title
                        title={r.name}
                        subtitle={hourLabel(parseInt(r.slot.split(":")[0], 10))}
                      />
                      <Card.Actions>
                        <Button
                          mode="contained-tonal"
                          textColor="#D7263D"
                          disabled={busy}
                          onPress={() => unreserve(r.slot)}
                        >
                          Unreserve
                        </Button>
                      </Card.Actions>
                    </Card>
                  ))
                )}
              </>
            )}
          </ScrollView>
        </Dialog.ScrollArea>
        <Dialog.Actions style={s.dlgActions}>
          {mode !== "menu" && (
            <Button mode="text" onPress={() => setMode("menu")}>
              Back
            </Button>
          )}
          {mode === "reserve" && (
            <Button
              mode="contained"
              onPress={reserve}
              loading={busy}
              disabled={
                busy || selected.size === 0 || title.trim().length === 0
              }
            >
              Reserve
            </Button>
          )}
          <Button
            mode="contained"
            onPress={onDismiss}
            style={s.closeBtn}
            contentStyle={s.closeBtnIn}
          >
            Close
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const s = StyleSheet.create({
  dialog: { alignSelf: "center", width: "94%", maxWidth: 560 },
  dlgTitle: { width: "100%", textAlign: "center", paddingHorizontal: 0 },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 16 },
  dlgActions: {
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingBottom: 8,
    gap: 8,
  },
  scrollArea: {
    maxHeight: Dimensions.get("window").height * 0.6,
    borderTopWidth: 0,
    borderBottomWidth: 0,
  },

  menu: { gap: 12, marginTop: 8 },
  menuBtnContent: { paddingVertical: 10 },

  closeBtn: { minWidth: 120 },
  closeBtnIn: { paddingVertical: 6 },

  dateNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    marginBottom: 4,
  },
  dateLabel: { fontWeight: "700", fontSize: 16 },
  todayBtn: { alignSelf: "center", marginBottom: 4 },

  titleInput: { marginBottom: 14 },
  hint: { opacity: 0.6, marginBottom: 10, fontSize: 13 },
  emptyText: { opacity: 0.6, textAlign: "center", marginTop: 16 },
  errorText: { color: "#D7263D", marginBottom: 10 },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    flexBasis: "31%",
    flexGrow: 1,
    alignItems: "center" as const,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2A2A2A",
    backgroundColor: "#141414",
  },
  chipPast: { opacity: 0.3, backgroundColor: "#0B0B0B" },
  chipSpacer: { flexBasis: "31%", flexGrow: 1 },
  chipBooked: { opacity: 0.3, backgroundColor: "#0B0B0B" },
  chipReserved: {
    opacity: 0.5,
    backgroundColor: "#3A0B12",
    borderColor: "#D7263D",
  },
  chipSelected: { backgroundColor: "#D7263D", borderColor: "#D7263D" },
  chipText: { color: "#FFFFFF", fontSize: 13 },
  chipTextPast: { textDecorationLine: "line-through" },
  chipTextBooked: { textDecorationLine: "line-through" },
  chipTextReserved: { color: "#D7263D" },
  chipTextSelected: { color: "#FFFFFF", fontWeight: "700" },

  summary: { marginTop: 14, fontWeight: "700" },
  resCard: { marginTop: 8, borderRadius: 12 },
});
