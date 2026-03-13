export type AccessRequest = {
  email: string;
  name: string;
  status: 'pending' | 'approved' | 'denied';
  createdAt: number;
  decidedAt?: number;
  decidedBy?: string;
};

export type AllowedEmail = {
  email: string;
  createdAt: number;
  createdBy?: string;
};

export type Booking = {
  date: string; // YYYY-MM-DD
  slot: string; // HH:00
  userId: string;
  name: string;
  email: string;
  createdAt: number;
};

export type ReservedByRole = 'owner' | 'admin';

export type ScheduleSlot = Booking & {
  reservedByRole?: ReservedByRole;
  reservedByUid?: string;
  reason?: string;
};

export type ScheduleDay = {
  slots: Record<string, ScheduleSlot>;
};

export type ActiveBookingGuard = {
  id: string;
  date: string;
  slot: string;
  endMs: number;
};
