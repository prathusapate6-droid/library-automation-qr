# Library Automation System (QR based)

This project now includes:
- Stitch-style Web App (English UI)
- React Native Expo Android App (English UI)
- Real-time request processing with Socket.IO
- QR-based book request and approval workflow

## 1) Backend + Web (localhost)

### Run
```bash
npm install
npm rebuild better-sqlite3
npm start
```

Open:
- [http://localhost:3000](http://localhost:3000)

### Default Admin
- Email: `admin@library.local`
- Password: `admin123`

### Web Features
- Student register/login
- Student QR scan or manual code request
- Admin add books
- Auto unique book code (`LIB_BOOK_0001`, ...)
- QR generation and PDF download for print labels
- Admin approve/reject requests
- Issued books tracking

## 2) Android App (React Native Expo)

Expo app path:
- [`app`](/Users/prathmeshsapate/Library%20Automation%20System%20%20QR/app)

### Install and run
```bash
cd app
npm install
npx expo start
```

Then press:
- `a` for Android Emulator
- or scan QR in Expo Go

### API URL setup (important)
Expo app uses:
- `EXPO_PUBLIC_API_BASE`
- default fallback: `http://10.0.2.2:3000` (Android emulator)

If using a physical phone, run:
```bash
EXPO_PUBLIC_API_BASE=http://<YOUR_LAPTOP_LOCAL_IP>:3000 npx expo start
```

### Expo App Features
- Login/Register
- Student dashboard
- QR scan via camera
- My requests + issued history
- Admin dashboard
- Add books + QR preview
- Approve/Reject requests
- Real-time updates

## API Endpoints
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/books`
- `POST /api/requests`
- `GET /api/requests/my`
- `GET /api/issued/my`
- `POST /api/admin/books`
- `GET /api/admin/requests`
- `PATCH /api/admin/requests/:id`
- `GET /api/admin/issued`

## Notes
- QR stores only book code (not full book data).
- Supports multiple users and multiple books.
- UI text is English.
- Web pages are aligned to the stitch design direction.
