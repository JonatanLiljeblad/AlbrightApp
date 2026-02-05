import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { slotEndMs } from './time';

export async function canBook(userId: string, date: string) {
  const now = Date.now();

  // 1 booking per day (active only)
  const dailyQ = query(
    collection(db, 'bookings'),
    where('userId', '==', userId),
    where('date', '==', date)
  );
  const daily = await getDocs(dailyQ);
  for (const b of daily.docs) {
    const { date: d, slot } = b.data() as { date: string; slot: string };
    const endMs = slotEndMs(d, slot);
    if (Number.isFinite(endMs) && endMs > now) {
      return { ok: false as const, reason: 'You already have an active booking for this day.' };
    }
  }

  // max 2 active bookings total
  const allQ = query(collection(db, 'bookings'), where('userId', '==', userId));
  const all = await getDocs(allQ);

  let active = 0;
  for (const b of all.docs) {
    const { date: d, slot } = b.data() as { date: string; slot: string };
    const endMs = slotEndMs(d, slot);
    if (Number.isFinite(endMs) && endMs > now) active += 1;
  }
  if (active >= 2) return { ok: false as const, reason: 'You already have 2 active bookings.' };

  return { ok: true as const };
}
