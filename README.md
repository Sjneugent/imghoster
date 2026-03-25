# ImgHoster

Minimal personal image hosting with a Node.js/Express backend, SQLite database and an nginx reverse proxy.

---

## Features

| Feature | Description |
|---|---|
| **Login** | Secure login with bcrypt-salted passwords, optional 30-day "Remember me" |
| **Upload** | Drag-and-drop or file-picker upload; choose a custom URL slug |
| **List / Manage** | View, copy URL, and delete your images |
| **Statistics** | Per-image view counts with a timeline chart |
| **Dashboard** | Admin-only user management (create / delete users, reset passwords) |
| **Public image URLs** | `/i/<slug>` – publicly accessible for embedding in GitHub READMEs etc. |
| **REST API** | All management actions exposed as authenticated JSON endpoints |
| **Anti-abuse** | Every management route requires an active session; rate-limiting on login |

---

## Stack

- **Runtime**: Node.js (v22+)
- **Framework**: Express 4
- **Database**: SQLite via `better-sqlite3`
- **Auth**: `express-session` + `bcrypt`
- **File uploads**: `multer`
- **Frontend**: Vanilla HTML / CSS / JS (no build step required)
- **Reverse proxy**: nginx

---

## Quick Start

> **Tip:** A root-level `package.json` lets you run the main npm scripts
> (`seed`, `start`, `dev`, `test`) from the project root. You can also
> `cd backend` and run them there.

### 1. Install dependencies

```bash
# From the project root:
npm run install:backend

# Or from the backend directory:
cd backend
npm install
```

### 2. Configure environment

```bash
cp backend/.env.example backend/.env
# Edit backend/.env and set a strong SESSION_SECRET
```

### 3. Create the first admin user

```bash
npm run seed
# Or with explicit credentials:
cd backend && node seed.js myusername mypassword
```

### 4. Start the server

```bash
npm start          # production
npm run dev        # development (auto-restart)
```

The server listens on `http://127.0.0.1:3000` by default.

### 5. Configure nginx

```bash
sudo cp nginx/imghoster.conf /etc/nginx/sites-available/imghoster
# Edit server_name and SSL certificate paths
sudo ln -s /etc/nginx/sites-available/imghoster /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

> **SSL**: Use [Certbot](https://certbot.eff.org/) with Let's Encrypt:
> ```bash
> sudo certbot --nginx -d example.com
> ```

---

## Directory Layout

```
imghoster/
├── backend/
│   ├── server.js           # Express entry point
│   ├── db.js               # SQLite schema & helpers
│   ├── seed.js             # Create initial admin user
│   ├── .env.example        # Environment variable template
│   ├── routes/
│   │   ├── auth.js         # POST /api/auth/login|logout, GET /api/auth/me
│   │   ├── images.js       # POST /api/images/upload, GET/DELETE /api/images/:id
│   │   ├── admin.js        # GET/POST/DELETE /api/admin/users
│   │   ├── stats.js        # GET /api/stats, GET /api/stats/timeline
│   │   └── serve.js        # GET /i/:slug  (public, view-tracked)
│   └── middleware/
│       └── requireAuth.js  # Session auth + admin guard
├── public/
│   ├── login.html
│   ├── upload.html
│   ├── list.html
│   ├── stats.html
│   ├── dashboard.html
│   ├── css/style.css
│   └── js/app.js
├── uploads/                # Uploaded images (gitignored)
└── nginx/
    └── imghoster.conf      # nginx site config template
```

---

## REST API Reference

All endpoints below (except login and `/i/:slug`) require a valid session cookie.

### Auth

| Method | Path | Body | Description |
|---|---|---|---|
| POST | `/api/auth/login` | `{username, password, rememberMe}` | Login |
| POST | `/api/auth/logout` | — | Logout |
| GET | `/api/auth/me` | — | Current user info |

### Images

| Method | Path | Description |
|---|---|---|
| POST | `/api/images/upload` | Upload an image (`multipart/form-data`: `image`, optional `slug`) |
| GET | `/api/images` | List your images (`?all=1` for all users, admin only) |
| GET | `/api/images/:id` | Get image metadata |
| DELETE | `/api/images/:id` | Delete an image |
| GET | `/i/:slug` | **Public** – serve the image and record a view |

### Stats

| Method | Path | Description |
|---|---|---|
| GET | `/api/stats` | View counts per image (`?all=1` for admin) |
| GET | `/api/stats/timeline` | Views over time (`?days=30&imageId=5`) |

### Admin (admin only)

| Method | Path | Body | Description |
|---|---|---|---|
| GET | `/api/admin/users` | — | List all users |
| POST | `/api/admin/users` | `{username, password, isAdmin}` | Create user |
| PATCH | `/api/admin/users/:id/password` | `{password}` | Reset password |
| DELETE | `/api/admin/users/:id` | — | Delete user and all their images |

---

## Running as a systemd service

```ini
# /etc/systemd/system/imghoster.service
[Unit]
Description=ImgHoster
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/imghoster/backend
EnvironmentFile=/opt/imghoster/backend/.env
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now imghoster
```
