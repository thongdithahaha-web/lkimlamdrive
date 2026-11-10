# LKimLamDrive Firestore Security Specification

## 1. Data Invariants
1. **Default Deny**: All paths not explicitly matched (`/{document=**}`) deny all reads and writes.
2. **Identity & PII Isolation**: `users/{userId}` contains user email and balance data. Only the document owner (`request.auth.uid == userId`) or a verified administrator (`isAdmin()`) may read a user document.
3. **Anti-Privilege Escalation**: Non-admin users creating their own profile (`users/{userId}`) must set `role == 'user'`, `status == 'active'`, `credits <= 10`, `balanceVnd == 0`, `totalDepositedVnd == 0`, and `uid == request.auth.uid`. Non-admin users can only update their `username` and `updatedAt` fields—never `role`, `credits`, `balanceVnd`, or `status`.
4. **Relational Consistency & Query Enforcement**: `downloads/{downloadId}` requires `userId == request.auth.uid` on creation and enforces `resource.data.userId == request.auth.uid || isAdmin()` on `get` and `list`.
5. **Temporal Integrity**: `createdAt` and `updatedAt` are validated against `request.time`, and `createdAt` / `uid` / `userId` are immutable on updates.

## 2. The "Dirty Dozen" Payloads
1. **Self-Assigned Admin Role on Signup**: `role: "admin"` by non-admin user -> Rejected (`data.role == 'user'`).
2. **Credit Inflation on Profile Update**: User updates `credits: 999999` -> Rejected (`affectedKeys().hasOnly(['username', 'updatedAt'])`).
3. **Balance VND Inflation on Profile Update**: User updates `balanceVnd: 50000000` -> Rejected (`affectedKeys().hasOnly(['username', 'updatedAt'])`).
4. **Shadow Field Injection**: User includes `isSuperAdmin: true` -> Rejected (`data.keys().hasOnly(...)`).
5. **ID Poisoning Attack**: Document ID > 128 chars or with special chars -> Rejected (`isValidId(id)`).
6. **Unverified Email Spoofing**: Admin email with `email_verified: false` -> Rejected (`request.auth.token.email_verified == true`).
7. **Cross-User PII Read**: User A reads `/users/userB` -> Rejected (`isOwner(userId) || isAdmin()`).
8. **Blanket User List Scraping**: Non-admin executes `list` on `/users` -> Rejected (`allow list: if isAdmin()`).
9. **Orphaned Download Record Creation**: User creates download record for another `userId` or without existing user profile -> Rejected (`incoming().userId == request.auth.uid && exists(/databases/$(database)/documents/users/$(request.auth.uid))`).
10. **Download History Tampering**: User attempts to modify completed download record -> Rejected (terminal state lock on `status == 'completed'`).
11. **Timestamp Forgery**: Client sends forged `createdAt` timestamp not equal to `request.time` -> Rejected (`incoming().createdAt == request.time`).
12. **Oversized String DoS**: Client sends 100KB `fileName` -> Rejected (`data.fileName.size() <= 256`).
