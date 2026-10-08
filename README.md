# AlbrightApp

Expo + TypeScript app with Firebase Auth + Firestore for:
- Email allowlist gated sign-up (request access if not allowed)
- Admin approvals
- Daily schedule booking (08:00–21:00) with exclusive slots

## Setup

1) Install deps
```bash
npm i
```

2) Create Firebase project
- Enable **Authentication → Email/Password**
- Create **Firestore** database

3) Configure env
- Copy `.env.example` → `.env.local`
- Fill in values from Firebase Console → **Project settings → Your apps → Web app**
- Set `EXPO_PUBLIC_ADMIN_EMAILS` to your admin email(s), comma-separated
- Set `EXPO_PUBLIC_OWNER_EMAILS` to your owner email(s), comma-separated (owners can edit permissions)

4) Run
```bash
npm start
```

This opens an Expo Go-compatible development server. Install **Expo Go** on your
iOS or Android device, ensure the device and computer are on the same network,
then scan the QR code. Use `npm start -- --tunnel` when local-network discovery
is unavailable.

For native simulator or development-build workflows, use:
```bash
npm run ios
npm run android
npm run start:dev-client
```

## Verification

```bash
npm run typecheck
npm run rules:smoke            # Requires Auth + Firestore emulators already running
npm run rules:smoke:emulators  # Starts the emulators for the smoke checks
npm run verify                 # Typecheck + emulator-backed smoke checks
```

## Firestore collections
- `allowedEmails/{emailLower}`
- `accessRequests/{emailLower}`
- `schedule/{YYYY-MM-DD}/slots/{HH:00}`
  - Normal booking payload: `date, slot, userId, name, email, createdAt`
  - Admin/owner reservation payload: adds `reservedByRole, reservedByUid, reason`
- `bookings/{YYYY-MM-DD}_{HH:00}_{uid}`
- `bookingGuards/{uid}` (internal active-booking guard state for cap enforcement)

## Firestore Security Rules (recommended)
This repo includes Firebase CLI config for `firestore.rules` and `firestore.indexes.json`, and the rules enforce:
- allowlist gating (`allowedEmails/{emailLower}`)
- role management (`owners/{emailLower}`, `admins/{emailLower}`)
- booking integrity (only allowed users can create bookings; slot exclusivity enforced by the app transaction)
- unbooking only by the owner of the slot (or admin)

### Important setup notes (to avoid lockout)
Before publishing the rules, seed at least this doc in Firestore (Firebase Console is fine):
- `owners/{yourEmailLower}` (so you have at least one owner)

Owners/admins are treated as allowed users automatically; you can still add `allowedEmails/{yourEmailLower}` for clarity/consistency.

### Privacy note
`allowedEmails` is readable by document ID to support pre-auth signup gating, which means someone could *guess* emails and probe existence (no list/query). If that’s a concern, move allowlist checks behind a Callable Cloud Function.

To use it, paste `firestore.rules` into Firebase Console → Firestore Database → Rules, and create the indexes from `firestore.indexes.json` in Firestore → Indexes (or deploy both together with Firebase CLI via `firebase deploy --only firestore`).

## Notes
MVP enforces slot exclusivity with a Firestore transaction; advanced constraints should be moved to Security Rules / Cloud Functions.

## Emulator smoke checks
Run with Firestore + Auth emulators already running:
```bash
npm run rules:smoke
```

Or let the Firebase CLI start the required emulators for you:
```bash
npm run rules:smoke:emulators
```

GitHub Actions uses `npm run verify` so local verification can match CI.

The emulator smoke checks now cover both Firestore rules expectations and the shared booking/reservation app flows used by the schedule screens.

Migration note:
- Existing deployments can leave `bookingGuards` empty; they are rebuilt as users book/unbook. Existing booking docs remain source-of-truth for legacy data checks.
