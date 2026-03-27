# ImgHoster API Documentation

Base URL: `http://localhost:3000`

All mutating requests (POST/PUT/PATCH/DELETE) require the `X-CSRF-Token` header (obtained from `GET /api/auth/me`) unless using API token authentication or accessing from localhost.

## Authentication

### POST /api/auth/login
Login with username and password. Returns 206 if TOTP 2FA is required.

**Body:**
```json
{ "username": "...", "password": "...", "rememberMe": true, "totpCode": "123456" }
```
- `totpCode` is only needed when the server responds with `206 { requiresTotp: true }`.

**Response:** `200` with `{ id, username, isAdmin, csrfToken }`

### POST /api/auth/register
Register a new user. Requires a valid captcha.

**Body:**
```json
{ "username": "...", "email": "...", "realName": "...", "password": "...", "captcha": "ABC123" }
```

### GET /api/auth/captcha
Get a CAPTCHA SVG for registration.

**Response:** `{ svg, expiresInSeconds }`

### POST /api/auth/logout
Log out the current session.

### GET /api/auth/me
Get current user info and CSRF token.

**Response:** `{ id, username, isAdmin, csrfToken }`

### GET /api/auth/tokens
List API tokens for the current user.

### POST /api/auth/tokens
Create a new API token.

**Body:**
```json
{ "label": "My Token", "durationMinutes": 60 }
```

### DELETE /api/auth/tokens/:id
Revoke an API token.

---

## Two-Factor Authentication (TOTP)

### GET /api/auth/totp/status
Check if 2FA is enabled for the current user.

**Response:** `{ enabled: true|false }`

### POST /api/auth/totp/setup
Generate a TOTP secret and QR code. Must be called before enabling.

**Response:** `{ secret, qrDataUrl, uri }`

### POST /api/auth/totp/enable
Verify a TOTP code and enable 2FA.

**Body:**
```json
{ "code": "123456" }
```

### POST /api/auth/totp/disable
Disable 2FA. Requires the user's password.

**Body:**
```json
{ "password": "..." }
```

---

## Images

### POST /api/images/upload
Upload one or more images (max 5 per request).

**Form data:**
- `image` (file, required, up to 5)
- `slug` (string, optional, single-file only)
- `compress` (boolean, optional)
- `comment` (string, optional, max 1000 chars)
- `tags` (string, optional, comma-separated)
- `visibility` (`public` | `unlisted` | `private`, default: `public`)
- `expiresAt` (ISO 8601 date string, optional)
- `fileHash` (SHA-256 hash for dedup, optional)

**Response:** `201` with `{ id, slug, url, comment, tags, visibility, expiresAt, compression }`

### POST /api/images/check-hash
Check for duplicate uploads by file hash.

**Body:**
```json
{ "fileHash": "sha256-hex-string" }
```

**Response:** `200 { isDuplicate: false }` or `409 { isDuplicate: true, existing: {...} }`

### GET /api/images
List images for the current user. Query params:
- `all=1` – show all users' images (admin only)
- `q=term` – search by slug, filename, or username

### GET /api/images/:id
Get single image metadata.

### PATCH /api/images/:id/visibility
Update image visibility.

**Body:**
```json
{ "visibility": "public" | "unlisted" | "private" }
```

### PATCH /api/images/:id/expiration
Update image expiration.

**Body:**
```json
{ "expiresAt": "2025-12-31T23:59:59Z" }
```
Pass `{ "expiresAt": null }` to remove expiration.

### DELETE /api/images/:id
Delete an image.

### POST /api/images/download
Download multiple images as a ZIP archive.

**Body:**
```json
{ "ids": [1, 2, 3] }
```

---

## Image Serving

### GET /i/:slug
Serve an image publicly. Respects visibility settings:
- **public**: accessible by anyone
- **unlisted**: accessible by direct link (not listed publicly)
- **private**: only accessible by the owner when logged in

Returns `410 Gone` for expired images.

### GET /i/:slug/thumb
Serve the thumbnail (300x300 JPEG) for an image. Same visibility rules apply.

---

## Albums

### POST /api/albums
Create an album.

**Body:**
```json
{ "name": "Vacation 2025", "description": "Beach photos" }
```

### GET /api/albums
List all albums for the current user.

### GET /api/albums/:id
Get album details including images.

### PATCH /api/albums/:id
Update album name or description.

**Body:**
```json
{ "name": "New name", "description": "Updated description" }
```

### DELETE /api/albums/:id
Delete an album (images are not deleted).

### POST /api/albums/:id/images
Add images to an album.

**Body:**
```json
{ "imageIds": [1, 2, 3] }
```

### DELETE /api/albums/:id/images/:imageId
Remove a single image from an album.

---

## Statistics

### GET /api/stats/timeline?imageId=:id
Get view timeline for an image.

---

## Admin

### GET /api/admin/users
List all users (admin only).

### DELETE /api/admin/users/:id
Delete a user (admin only).

### PATCH /api/admin/users/:id/quota
Set a user's storage quota.

**Body:**
```json
{ "quotaBytes": 104857600 }
```
Set to `0` for unlimited.

### GET /api/admin/users/:id/quota
Get a user's storage quota and usage.

**Response:** `{ userId, quotaBytes, usedBytes }`

### GET /api/admin/backups/status
Get the backup scheduler status and configuration.

**Response:**
```json
{
  "enabled": false,
  "intervalMs": 86400000,
  "intervalHuman": "24.0h",
  "backupDir": "./data/backups",
  "retainCount": 7,
  "running": false,
  "lastBackupAt": null,
  "lastBackupPath": null,
  "lastError": null
}
```

### POST /api/admin/backups/run
Trigger an immediate backup.

**Response:** `{ success: true, path: "...", sizeKB: "..." }`

### PATCH /api/admin/backups/config
Update backup scheduler configuration.

**Body:**
```json
{ "enabled": true, "intervalMs": 86400000, "retainCount": 7 }
```

**Response:** Updated scheduler status.

---

## Content Flags

### POST /api/flags
Report an image for content review.

**Body:**
```json
{ "imageId": 1, "reason": "inappropriate content" }
```

### GET /api/flags
List all content flags (admin only).

### PATCH /api/flags/:id
Update flag status (admin only).

**Body:**
```json
{ "status": "resolved" }
```
