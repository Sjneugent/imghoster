# ImgHoster

Minimal personal image hosting with a Node.js/Express backend, SQLite database and an NGINX reverse proxy.

---

## Table of Contents

- [Features](#features)
- [Stack](#stack)
- [Quick Start](#quick-start)
- [HTTP-Only NGINX (No SSL)](#http-only-nginx-no-ssl)
- [SSL Certificate Setup for NGINX](#ssl-certificate-setup-for-nginx)
  - [Option A – Let's Encrypt with Certbot (Recommended for Production)](#option-a--lets-encrypt-with-certbot-recommended-for-production)
  - [Option B – Self-Signed Certificate (Local Development / Testing)](#option-b--self-signed-certificate-local-development--testing)
  - [Option C – Commercial CA (Manual CSR)](#option-c--commercial-ca-manual-csr)
  - [Installing the Certificate in NGINX](#installing-the-certificate-in-nginx)
  - [Certificate Renewal](#certificate-renewal)
  - [Verifying Your SSL Setup](#verifying-your-ssl-setup)
  - [Troubleshooting SSL Issues](#troubleshooting-ssl-issues)
- [NGINX Configuration Walkthrough](#nginx-configuration-walkthrough)
- [Localhost Auth Bypass](#localhost-auth-bypass)
- [Logging](#logging)
- [Directory Layout](#directory-layout)
- [REST API Reference](#rest-api-reference)
- [Running as a systemd Service](#running-as-a-systemd-service)

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
- **Reverse proxy**: NGINX

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
npm start              # production (localhost bypass ON)
npm run start:secure   # production (localhost bypass OFF – requires login)
npm run dev            # development with auto-restart
npm run dev:secure     # development with auto-restart, bypass OFF
```

The server listens on `http://127.0.0.1:3000` by default.

### 5. Configure NGINX with SSL

Follow the [SSL Certificate Setup](#ssl-certificate-setup-for-nginx) section below, then:

```bash
sudo cp nginx/imghoster.conf /etc/nginx/sites-available/imghoster
# Edit server_name and SSL certificate paths (see walkthrough below)
sudo ln -s /etc/nginx/sites-available/imghoster /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 6. Optional: HTTP-only NGINX profile (no SSL)

If you need to run without TLS (for local/LAN/testing), use the included
`nginx/imghoster-insecure.conf` profile instead of the SSL profile.

```bash
sudo cp nginx/imghoster-insecure.conf /etc/nginx/sites-available/imghoster-insecure

# Disable SSL profile, enable HTTP-only profile
sudo rm -f /etc/nginx/sites-enabled/imghoster
sudo ln -sf /etc/nginx/sites-available/imghoster-insecure /etc/nginx/sites-enabled/imghoster-insecure

sudo nginx -t && sudo systemctl reload nginx
```

To switch back to HTTPS later:

```bash
sudo rm -f /etc/nginx/sites-enabled/imghoster-insecure
sudo ln -sf /etc/nginx/sites-available/imghoster /etc/nginx/sites-enabled/imghoster

sudo nginx -t && sudo systemctl reload nginx
```

---

## HTTP-Only NGINX (No SSL)

ImgHoster now includes two NGINX profiles in `nginx/`:

- `imghoster.conf` - HTTPS + HTTP->HTTPS redirect
- `imghoster-insecure.conf` - HTTP-only reverse proxy (no TLS)

Use the HTTP-only profile only when TLS is terminated somewhere else or for
non-production environments.

---

## SSL Certificate Setup for NGINX

ImgHoster ships with an NGINX config (`nginx/imghoster.conf`) that expects SSL
certificates. This section walks you through creating or obtaining them.

### Prerequisites

Before you begin, ensure:

- **NGINX is installed** — `sudo apt update && sudo apt install nginx` (Debian/Ubuntu)
  or `sudo dnf install nginx` (Fedora/RHEL)
- **OpenSSL is installed** — usually pre-installed; verify with `openssl version`
- **Your domain's DNS A/AAAA records** point to your server's IP address
  (required for Let's Encrypt; not needed for self-signed)
- **Ports 80 and 443 are open** in your firewall:
  ```bash
  sudo ufw allow 'Nginx Full'   # Ubuntu/Debian with ufw
  ```

---

### Option A – Let's Encrypt with Certbot (Recommended for Production)

[Let's Encrypt](https://letsencrypt.org/) issues **free, trusted** SSL
certificates that are valid for 90 days and can be auto-renewed.

#### Step 1 — Install Certbot

```bash
# Debian / Ubuntu
sudo apt update
sudo apt install certbot python3-certbot-nginx

# Fedora / RHEL
sudo dnf install certbot python3-certbot-nginx

# macOS (Homebrew)
brew install certbot
```

#### Step 2 — Copy and edit the NGINX config

Place the ImgHoster NGINX config so Certbot can find it:

```bash
sudo cp nginx/imghoster.conf /etc/nginx/sites-available/imghoster
```

Open the file and replace **every** occurrence of `example.com` with your
actual domain:

```bash
sudo nano /etc/nginx/sites-available/imghoster
```

For now **comment out** the entire `listen 443` server block and the SSL lines
(Certbot will add them for you), and keep only the port-80 block:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name yourdomain.com www.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable the site and reload:

```bash
sudo ln -sf /etc/nginx/sites-available/imghoster /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

#### Step 3 — Run Certbot

```bash
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

Certbot will:

1. Verify domain ownership via an HTTP-01 challenge on port 80
2. Download and install the certificate
3. **Automatically modify** your NGINX config to add the `listen 443 ssl` block,
   SSL certificate paths, and an HTTP → HTTPS redirect
4. Set up a systemd timer for automatic renewal

When prompted:

- Enter your **email address** (used for renewal reminders)
- **Agree** to the Terms of Service
- Choose whether to **redirect** HTTP → HTTPS (recommended: yes)

#### Step 4 — Verify

```bash
sudo nginx -t && sudo systemctl reload nginx
curl -I https://yourdomain.com
```

You should see `HTTP/2 200` (or `301`/`302` depending on the path).

Your certificates will be stored at:

```
/etc/letsencrypt/live/yourdomain.com/fullchain.pem   # certificate + chain
/etc/letsencrypt/live/yourdomain.com/privkey.pem     # private key
```

---

### Option B – Self-Signed Certificate (Local Development / Testing)

> ⚠️ **Warning:** Browsers will show a security warning for self-signed
> certificates. **Do not use in production.** This is useful for local
> development and testing only.

#### Step 1 — Create a directory for certificates

```bash
sudo mkdir -p /etc/nginx/ssl
```

#### Step 2 — Generate a private key and certificate

**Single command** (generates a 2048-bit RSA key and a certificate valid for
365 days):

```bash
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/nginx/ssl/imghoster.key \
  -out /etc/nginx/ssl/imghoster.crt \
  -subj "/C=US/ST=State/L=City/O=ImgHoster Dev/CN=localhost"
```

**Explanation of flags:**

| Flag | Purpose |
|---|---|
| `-x509` | Output a self-signed certificate instead of a CSR |
| `-nodes` | Do not encrypt the private key (no passphrase prompt) |
| `-days 365` | Certificate validity period |
| `-newkey rsa:2048` | Generate a new 2048-bit RSA key |
| `-keyout` | Where to write the private key |
| `-out` | Where to write the certificate |
| `-subj "..."` | Certificate subject fields (avoids interactive prompts) |

If you want to be prompted interactively instead, omit `-subj`:

```bash
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/nginx/ssl/imghoster.key \
  -out /etc/nginx/ssl/imghoster.crt
```

You will be asked for:

```
Country Name (2 letter code) [AU]: US
State or Province Name []: YourState
Locality Name []: YourCity
Organization Name []: ImgHoster Dev
Organizational Unit Name []:
Common Name []: localhost
Email Address []:
```

> **Tip:** For local development, set `Common Name` to `localhost` or
> `127.0.0.1`.

#### Step 3 — (Optional) Generate a certificate with Subject Alternative Names

Modern browsers require SAN (Subject Alternative Names). To cover both
`localhost` and `127.0.0.1`:

```bash
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/nginx/ssl/imghoster.key \
  -out /etc/nginx/ssl/imghoster.crt \
  -subj "/C=US/ST=State/L=City/O=ImgHoster Dev/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
```

#### Step 4 — Set permissions

```bash
sudo chmod 600 /etc/nginx/ssl/imghoster.key
sudo chmod 644 /etc/nginx/ssl/imghoster.crt
```

#### Step 5 — Update the NGINX config

Edit `nginx/imghoster.conf` (or your copy in `/etc/nginx/sites-available/`)
and point the `ssl_certificate` directives to your self-signed files:

```nginx
ssl_certificate     /etc/nginx/ssl/imghoster.crt;
ssl_certificate_key /etc/nginx/ssl/imghoster.key;
```

Then test and reload:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

#### Step 6 — Trust the certificate locally (optional)

To suppress browser warnings during development:

**Linux (Debian/Ubuntu):**

```bash
sudo cp /etc/nginx/ssl/imghoster.crt /usr/local/share/ca-certificates/imghoster.crt
sudo update-ca-certificates
```

**macOS:**

```bash
sudo security add-trusted-cert -d -r trustRoot \
  -k /Library/Keychains/System.keychain /etc/nginx/ssl/imghoster.crt
```

**Windows (PowerShell as Admin):**

```powershell
Import-Certificate -FilePath "C:\path\to\imghoster.crt" -CertStoreLocation Cert:\LocalMachine\Root
```

---

### Option C – Commercial CA (Manual CSR)

If you have a domain and want to use a commercial Certificate Authority
(DigiCert, Sectigo, GoDaddy, etc.):

#### Step 1 — Generate a private key

```bash
sudo openssl genrsa -out /etc/nginx/ssl/imghoster.key 2048
```

#### Step 2 — Create a Certificate Signing Request (CSR)

```bash
sudo openssl req -new \
  -key /etc/nginx/ssl/imghoster.key \
  -out /etc/nginx/ssl/imghoster.csr \
  -subj "/C=US/ST=State/L=City/O=YourOrg/CN=yourdomain.com"
```

#### Step 3 — Submit the CSR to your CA

- Open the CSR file:
  ```bash
  cat /etc/nginx/ssl/imghoster.csr
  ```
- Copy the entire contents (including the `-----BEGIN CERTIFICATE REQUEST-----`
  and `-----END CERTIFICATE REQUEST-----` lines)
- Paste it into your CA's certificate order form
- Complete domain validation as instructed by the CA

#### Step 4 — Install the signed certificate

Your CA will provide:

- **Your certificate** (e.g. `yourdomain.crt`)
- **Intermediate/chain certificate** (e.g. `ca-bundle.crt`)

Combine them into a single file in the correct order:

```bash
cat yourdomain.crt ca-bundle.crt | sudo tee /etc/nginx/ssl/imghoster-fullchain.crt
```

Update NGINX:

```nginx
ssl_certificate     /etc/nginx/ssl/imghoster-fullchain.crt;
ssl_certificate_key /etc/nginx/ssl/imghoster.key;
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

### Installing the Certificate in NGINX

Whichever method you used above, your NGINX config (`nginx/imghoster.conf`)
needs two lines inside the `server { listen 443 ... }` block:

```nginx
ssl_certificate     /path/to/fullchain.pem;   # or .crt
ssl_certificate_key /path/to/privkey.pem;     # or .key
```

The included `nginx/imghoster.conf` already has these configured for
Let's Encrypt paths. Update them to match your certificate locations:

| Method | Certificate path | Key path |
|---|---|---|
| Let's Encrypt | `/etc/letsencrypt/live/yourdomain.com/fullchain.pem` | `/etc/letsencrypt/live/yourdomain.com/privkey.pem` |
| Self-signed | `/etc/nginx/ssl/imghoster.crt` | `/etc/nginx/ssl/imghoster.key` |
| Commercial CA | `/etc/nginx/ssl/imghoster-fullchain.crt` | `/etc/nginx/ssl/imghoster.key` |

After editing, always test and reload:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

### Certificate Renewal

#### Let's Encrypt (automatic)

Certbot installs a systemd timer (or cron job) that automatically renews
certificates before they expire. Verify it is active:

```bash
sudo systemctl status certbot.timer
```

Test renewal without actually renewing:

```bash
sudo certbot renew --dry-run
```

#### Self-signed

Self-signed certificates must be regenerated manually before they expire.
Re-run the `openssl req` command from [Option B](#option-b--self-signed-certificate-local-development--testing)
and reload NGINX.

#### Commercial CA

Follow your CA's renewal process, generate a new CSR if required, and replace
the certificate files.

---

### Verifying Your SSL Setup

After installing your certificate:

```bash
# Check that NGINX config is valid
sudo nginx -t

# Reload NGINX
sudo systemctl reload nginx

# Test the HTTPS connection
curl -vI https://yourdomain.com 2>&1 | grep -E 'SSL|subject|expire|HTTP'

# Check certificate expiry date
echo | openssl s_client -connect yourdomain.com:443 -servername yourdomain.com 2>/dev/null \
  | openssl x509 -noout -dates
```

For local self-signed certificates:

```bash
curl -kvI https://localhost 2>&1 | grep -E 'SSL|subject|expire|HTTP'
```

You can also use online tools like [SSL Labs](https://www.ssllabs.com/ssltest/)
to audit your production configuration.

---

### Troubleshooting SSL Issues

| Problem | Possible cause | Fix |
|---|---|---|
| `nginx: [emerg] cannot load certificate` | Wrong file path or permissions | Check paths in config; run `sudo chmod 600 *.key` |
| `ERR_CERT_AUTHORITY_INVALID` in browser | Self-signed or missing chain cert | For self-signed: trust the cert locally. For CA certs: include intermediate bundle |
| `NET::ERR_CERT_COMMON_NAME_INVALID` | CN / SAN mismatch with domain | Regenerate the cert with the correct `CN` and `subjectAltName` |
| Certbot fails HTTP-01 challenge | Port 80 blocked, or DNS not pointing to server | Open port 80 (`sudo ufw allow 80`); verify DNS with `dig yourdomain.com` |
| Mixed content warnings | Page loads over HTTPS but assets over HTTP | Ensure all links use relative URLs or `https://` |
| `ERR_SSL_PROTOCOL_ERROR` | TLS version mismatch | Verify `ssl_protocols TLSv1.2 TLSv1.3;` in NGINX config |
| Certificate expired | Certbot timer not running | Run `sudo certbot renew` and check timer with `systemctl status certbot.timer` |

---

## NGINX Configuration Walkthrough

The included `nginx/imghoster.conf` sets up a production-ready reverse proxy.
Here is what each section does:

```nginx
# Redirect all HTTP traffic to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name example.com www.example.com;   # ← Replace with your domain
    return 301 https://$host$request_uri;
}
```

The main HTTPS server block:

```nginx
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name example.com www.example.com;   # ← Replace with your domain

    # ── SSL ──────────────────────────────────────────────────────────────
    ssl_certificate     /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:...;  # Strong cipher suite
    ssl_prefer_server_ciphers off;
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
```

| Directive | Purpose |
|---|---|
| `ssl_certificate` / `ssl_certificate_key` | Your SSL cert and private key |
| `ssl_session_cache` | Cache TLS sessions to speed up repeat connections |
| `ssl_protocols` | Allow only TLS 1.2 and 1.3 (disable older insecure versions) |
| `ssl_ciphers` | Restrict to strong cipher suites only |
| `Strict-Transport-Security` | Tell browsers to always use HTTPS (HSTS) |

```nginx
    # Proxy image requests to Node.js (for view tracking)
    location /i/ {
        proxy_pass http://127.0.0.1:3000;
        ...
    }

    # Proxy everything else to Node.js (API + frontend)
    location / {
        proxy_pass http://127.0.0.1:3000;
        ...
    }

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
}
```

---

## Localhost Auth Bypass

For convenience during local development, requests from `127.0.0.1` / `::1`
bypass authentication by default. This is controlled by the `LOCALHOST_BYPASS`
environment variable:

| Value | Behaviour |
|---|---|
| `true` (default) | Localhost requests skip auth — no login required |
| `false` | All requests require a valid session |

Toggle via npm scripts:

```bash
npm start              # bypass ON
npm run start:secure   # bypass OFF (LOCALHOST_BYPASS=false)
npm run dev            # bypass ON, auto-restart
npm run dev:secure     # bypass OFF, auto-restart
```

Or set it in `backend/.env`:

```env
LOCALHOST_BYPASS=false
```

---

## Logging

ImgHoster uses a built-in logger (`backend/logger.js`) with four levels:
`debug`, `info`, `warn`, `error`.

Set the minimum log level via the `LOG_LEVEL` environment variable:

```env
LOG_LEVEL=debug   # show everything
LOG_LEVEL=info    # default – info and above
LOG_LEVEL=warn    # warnings and errors only
LOG_LEVEL=error   # errors only
```

Logs are written to stdout/stderr and can be piped to any log aggregator in
production.

---

## Directory Layout

```
imghoster/
├── backend/
│   ├── server.js           # Express entry point
│   ├── db.js               # SQLite schema & helpers
│   ├── logger.js           # Lightweight levelled logger
│   ├── seed.js             # Create initial admin user
│   ├── .env.example        # Environment variable template
│   ├── routes/
│   │   ├── auth.js         # POST /api/auth/login|logout, GET /api/auth/me
│   │   ├── images.js       # POST /api/images/upload, GET/DELETE /api/images/:id
│   │   ├── admin.js        # GET/POST/DELETE /api/admin/users
│   │   ├── stats.js        # GET /api/stats, GET /api/stats/timeline
│   │   └── serve.js        # GET /i/:slug  (public, view-tracked)
│   ├── middleware/
│   │   └── requireAuth.js  # Session auth + admin guard + localhost bypass
│   └── tests/
│       └── api.test.js     # Node.js built-in test runner tests
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
    └── imghoster.conf      # NGINX site config template
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `SESSION_SECRET` | *(must be set)* | Secret for signing session cookies |
| `PORT` | `3000` | Port the Node.js server listens on |
| `HOST` | `127.0.0.1` | Host/IP to bind to |
| `NODE_ENV` | — | Set to `production` for secure cookies |
| `DB_PATH` | `./data/imghoster.db` | Path to the SQLite database file |
| `UPLOADS_DIR` | `../uploads` | Directory for uploaded image files |
| `LOCALHOST_BYPASS` | `true` | Enable (`true`) or disable (`false`) localhost auth bypass |
| `LOG_LEVEL` | `info` | Minimum log level: `debug`, `info`, `warn`, `error` |

---

## REST API Reference

All endpoints below (except login and `/i/:slug`) require a valid session cookie.

### Auth

| Method | Path | Body | Description |
|---|---|---|---|
| POST | `/api/auth/login` | `{username, password, rememberMe}` | Login |
| POST | `/api/auth/logout` | — | Logout |
| GET | `/api/auth/me` | — | Current user info + CSRF token |

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

## Running Tests

```bash
# From the project root
npm test

# Or from the backend directory
cd backend && npm test
```

Tests use the Node.js built-in test runner (`node --test`).

---

## Running as a systemd Service

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

---

## License

This project is provided as-is for personal use. See the repository for details.
