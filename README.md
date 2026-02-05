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
npm run ios
# or
npm run android
```

## Firestore collections
- `allowedEmails/{emailLower}`
- `accessRequests/{emailLower}`
- `schedule/{YYYY-MM-DD}/slots/{HH:00}`
- `bookings/{YYYY-MM-DD}_{HH:00}_{uid}`

## Firestore Security Rules (recommended)
This repo includes a starter `firestore.rules` that enforces:
- allowlist gating (`allowedEmails/{emailLower}`)
- role management (`owners/{emailLower}`, `admins/{emailLower}`)
- booking integrity (only allowed users can create bookings; schedule slot + booking must be created together)
- unbooking only by the owner of the slot (or admin)

### Important setup notes (to avoid lockout)
Before publishing the rules, seed these docs in Firestore (Firebase Console is fine):
- `owners/{yourEmailLower}` (so you have at least one owner)
- `allowedEmails/{yourEmailLower}` (so you can use the app)

### Privacy note
`allowedEmails` is readable by document ID to support pre-auth signup gating, which means someone could *guess* emails and probe existence (no list/query). If that’s a concern, move allowlist checks behind a Callable Cloud Function.

To use it, paste `firestore.rules` into Firebase Console → Firestore Database → Rules (or integrate via Firebase CLI).

## Notes
MVP enforces slot exclusivity with a Firestore transaction; advanced constraints should be moved to Security Rules / Cloud Functions.
