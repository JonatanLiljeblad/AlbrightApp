# Copilot Instructions — AlbrightApp

## Project overview

Expo (SDK 54) + TypeScript + Firebase scheduling app. Users book exclusive 1-hour time slots (08:00–21:00). Access is gated by an email allowlist; admins approve requests and can reserve slots. Three-tier role hierarchy: **owner > admin > allowed user**.

## Commands

```bash
npm start              # Expo dev server
npm run ios            # Run on iOS simulator
npm run android        # Run on Android emulator
npm run typecheck      # TypeScript strict check (tsc --noEmit)
npm run rules:smoke    # Emulator-backed Firestore smoke checks (requires Firebase emulators running)
```

There is no unit test framework. The only automated tests are the emulator-backed smoke checks in `scripts/firestore-emulator-smoke.ts`, which run against the Firebase Auth + Firestore emulators and cover rules plus shared booking/reservation flows.

## Architecture

**Routing** — expo-router file-based routing with two route groups:
- `app/(auth)/` — sign-in / sign-up (unauthenticated)
- `app/(tabs)/` — main app tabs: Schedule, My Bookings, Coming Soon, Admin, Settings

The root layout (`app/_layout.tsx`) watches Firebase auth state and redirects between `(auth)` and `(tabs)`.

**Shared logic** lives in `src/`:
- `firebase.ts` — singleton Firebase app/auth/db, plus `ADMIN_EMAILS` and `OWNER_EMAILS` parsed from env vars
- `auth.ts` — sign-in, sign-up, allowlist check, role helpers
- `bookingRules.ts` — booking cap enforcement (max 2 active bookings, max 1 per day) using `bookingGuards/{uid}` docs and Firestore transactions
- `types.ts` — shared TypeScript types (`Booking`, `AccessRequest`, `AllowedEmail`)
- `time.ts` — date/slot helpers (all slots are `HH:00` strings, dates are `YYYY-MM-DD`)
- `adminAccessContext.tsx` — React context providing role state (`owner`, `canAdmin`) to tab screens

**Reusable components** live in `components/` (e.g., `HistoryDialog`, `ReserveDialog`).

## Key conventions

### Roles & access control
Roles are determined by **both** env vars (`EXPO_PUBLIC_OWNER_EMAILS`, `EXPO_PUBLIC_ADMIN_EMAILS`) and Firestore docs (`owners/{emailLower}`, `admins/{emailLower}`). A user is admin/owner if *either* source says so. The tabs layout subscribes to both with real-time listeners.

### Firestore document ID convention
All email-keyed collections (`allowedEmails`, `accessRequests`, `owners`, `admins`) use the **lowercased email** as the document ID. Booking guard docs use the Firebase Auth `uid`.

### Booking atomicity
Creating a booking requires a Firestore **transaction** that writes both `schedule/{date}/slots/{slot}` and `bookings/{date}_{slot}_{uid}` atomically. The security rules enforce that both docs exist together via `existsAfter()`/`getAfter()` cross-checks. Never write one without the other.

### Booking guard pattern
`bookingGuards/{uid}` stores an `active` array (max 2 entries) tracking the user's current bookings. This is updated inside the same transaction as book/unbook and is hydrated on first use if missing. The Firestore rules also enforce the array size cap.

### Admin reservations vs. regular bookings
Admin/owner reservations add `reservedByRole`, `reservedByUid`, and `reason` fields to the slot doc. Regular bookings only have the base fields. The security rules validate each payload shape separately.

### UI framework
All UI uses **react-native-paper** (Material Design 3) with a dark theme. Brand color is `#D7263D`. Styles are co-located with components using `StyleSheet.create()`.

### Path alias
`@/*` maps to the project root (configured in `tsconfig.json`).

### Environment variables
Firebase config and role emails are set via `EXPO_PUBLIC_*` env vars in `.env.local` (see `.env.example`).

### Firestore security rules
`firestore.rules` is the source of truth for access control. Changes to data schemas or access patterns must be reflected there. The rules use helper functions (`isOwner()`, `isAdmin()`, `isAllowed()`, `isBookingPayload()`, etc.) to stay DRY.
