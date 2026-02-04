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

## Notes
MVP enforces slot exclusivity with a Firestore transaction; advanced constraints should be moved to Security Rules / Cloud Functions.
