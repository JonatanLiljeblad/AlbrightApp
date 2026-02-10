export function pad2(n: number) {
  return String(n).padStart(2, '0');
}

export function toYmd(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function hourLabel(h: number) {
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr}:00 ${ampm}`;
}

export function hourSlot(h: number) {
  return `${pad2(h)}:00`;
}

export function hoursRange(startHour: number, endHourExclusive: number) {
  return Array.from({ length: endHourExclusive - startHour }, (_, i) => startHour + i);
}

export function slotStartMs(ymd: string, slot: string) {
  const [y, m, d] = ymd.split('-').map(Number);
  const [hh] = slot.split(':').map(Number);
  return new Date(y, m - 1, d, hh, 0, 0, 0).getTime();
}

export function slotEndMs(ymd: string, slot: string, durationHours = 1) {
  const start = slotStartMs(ymd, slot);
  return start + durationHours * 60 * 60 * 1000;
}

export function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}
