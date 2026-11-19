# LOCAL HUB — Private LAN Communication & Collaboration Platform

**LOCAL HUB** is a self-hosted, zero-cloud communication and collaboration platform built for a private team of five (1 Owner + 4 Partners) working on the same local Wi-Fi or Ethernet LAN.

One Windows computer acts as the **Host Server**. The other four computers connect through any modern browser (Chrome, Edge, Firefox) using the host's local IP address — with **zero internet connection required** after initial installation.

---

## Features

- **Private Invitation-Only Auth**: Owner setup code on first run, single-use invitation codes for partners, bcrypt password hashing, HTTP-only SameSite=Strict session cookies, device session management, logout from all devices, account deactivation.
- **Real-Time Messaging**: 1-to-1 DMs, group conversations, dedicated Team channel, replies, forwarding, editing, deleting, emoji reactions, typing indicators, delivery & read receipts, pinning, message search (`Ctrl+K`), unread counters, paginated history.
- **File & Media Sharing**: Drag-and-drop & multi-file uploads, resumable chunked uploads for large videos, real-time upload & download progress, content-sniffed file verification (never trusts browser MIME types), automatic thumbnails, image lightbox, inline video player, PDF/text preview, shared media gallery.
- **Voice Messages & LAN WebRTC Calls**: Browser voice recorder with live waveform & preview before sending, interactive waveform player with `1x`/`1.5x`/`2x` playback speeds, direct LAN WebRTC 1-to-1 and up to 5-member group audio & video calls (zero cloud servers).
- **Shared Team Workspace**: Shared file repository with pinned documents, team announcements, collaborative shared notes, Kanban task board with assignees & priorities, shared/personal to-do lists, important links, live activity feed.
- **Admin Dashboard**: Live server/storage metrics, user & invitation management, password resets, active session kick, group permissions, storage consistency checker, trash purge, 1-click database + file backup & restore, server config & logs, administrative audit trail.
- **PWA & Auto-Reconnect**: Installable as a desktop app with offline shell caching and automatic client reconnection if the host restarts.

---

## Project & Storage Structure

```text
LocalConnect/
├── server/                 # Node.js + Express 5 + Socket.IO + Prisma ORM
├── client/                 # React + TypeScript + Vite + Tailwind CSS + Framer Motion
├── database/
│   └── localhub.db         # Persistent SQLite database
├── storage/                # Organized uploaded files (never lost on restart)
│   ├── images/YYYY/MM/
│   ├── videos/YYYY/MM/
│   ├── audio/YYYY/MM/
│   ├── documents/YYYY/MM/
│   ├── archives/YYYY/MM/
│   ├── other/YYYY/MM/
│   ├── users/              # Profile pictures
│   ├── thumbnails/         # Generated image & video thumbnails
│   ├── tmp/                # In-progress chunked uploads
│   └── trash/              # Soft-deleted files
├── backups/                # Timestamped DB + file snapshots with SHA-256 manifests
├── logs/                   # Daily rotating server logs
├── config/
│   ├── localhub.config.json
│   └── certs/              # Auto-generated private LAN CA & HTTPS server cert
├── scripts/                # Stop, backup, restore, firewall helpers
├── install.bat
├── start-server.bat
├── stop-server.bat
├── backup.bat
└── restore.bat
```

---

## 1. Installation (Host Computer Only)

**Requirement:** Install [Node.js 20 LTS or newer](https://nodejs.org) on the **Host Windows PC** (partners do **not** need Node.js — only a web browser).

1. Open the `LocalConnect` folder on the Host computer.
2. Double-click **`install.bat`**.
   - Installs all dependencies once (this is the only step that needs internet access).
   - Creates and migrates the local SQLite database (`database/localhub.db`).
   - Builds the production server and React frontend.

---

## 2. Starting & Stopping the Server

- **Start:** Double-click **`start-server.bat`**.
  The console automatically detects and prints your host LAN addresses, for example:
  ```text
  Local access:     http://localhost:3000
  Local HTTPS:      https://localhost:3443
  LAN access:       http://192.168.1.10:3000
  LAN HTTPS (Voice/Video/PWA): https://192.168.1.10:3443
  ```
- **Stop:** Press `Ctrl+C` in the server window, or double-click **`stop-server.bat`**.

---

## 3. First-Time Setup & Creating the Owner Account

On the very first start (when zero users exist), the server terminal prints a one-time **Setup Code**:
```text
FIRST-TIME SETUP REQUIRED
Open http://localhost:3000 and enter Setup Code:
>>>  482910-A1B2  <<<
```
1. On the Host PC, open `http://localhost:3000` in your browser.
2. Enter the **Setup Code**, choose a Workspace Name, Display Name, Username, and Password (8+ characters with letters & numbers).
3. Click **Initialize Workspace**. You are now logged in as the **Owner** and the setup code is permanently cleared.

---

## 4. Inviting Your Four Partners

Unauthorized people on the Wi-Fi cannot self-register.

1. In LOCAL HUB, open **Admin Dashboard → Users & Invites**.
2. Click **Create Invitation** (you can add a note like *"For Maya"* and set an expiry).
3. Copy the **Invitation Code** (e.g. `LH-7K4P-9M2X`) or the **Invite Link** (`http://192.168.1.10:3000/invite/LH-7K4P-9M2X`).
4. Share the host IP address and invitation code with your partner.
5. On their computer, they open the address in their browser, click **Join with Invite**, enter the code, and create their own username & password.

---

## 5. Connecting Over Wi-Fi / LAN & Windows Firewall

### Windows Firewall (Required once on Host PC)
Windows blocks incoming LAN connections by default.
1. Make sure the Host PC's Wi-Fi/Ethernet network profile is set to **Private** (`Windows Settings → Network & internet → Wi-Fi → Network profile type → Private`).
2. Right-click **`scripts\configure-firewall.bat`** and select **Run as administrator**.
   - Or run manually in an Administrator PowerShell:
     ```powershell
     netsh advfirewall firewall add rule name="LOCAL HUB HTTP" dir=in action=allow protocol=TCP localport=3000 profile=private
     netsh advfirewall firewall add rule name="LOCAL HUB HTTPS" dir=in action=allow protocol=TCP localport=3443 profile=private
     ```

### Voice Messages, Audio/Video Calls & PWA over LAN (Important Browser Requirement!)
Modern browsers (Chrome, Edge, Firefox) **only allow microphone/camera capture and PWA installation on a Secure Context (`https://` or `localhost`)**. Plain `http://192.168.x.x:3000` works for chat, file sharing, tasks, and workspace — **to use Voice Messages and WebRTC Audio/Video Calls from partner PCs**, open the built-in LAN HTTPS URL instead:

- Example: `https://192.168.1.10:3443`
- On first visit, your browser will show a self-signed certificate warning (because the certificate was generated privately on your host PC, not by a cloud CA).
  - **Quick option:** Click **Advanced → Proceed to 192.168.1.10**.
  - **Best option (green padlock, zero warnings, enables PWA Install):** Download the private LAN CA certificate from the Login screen or `Settings → Download LAN CA Certificate` (`LOCAL-HUB-CA.crt`), double-click it on Windows → **Install Certificate → Local Machine → Place in Trusted Root Certification Authorities**, and restart the browser.

> **LAN WebRTC Note:** WebRTC uses direct LAN host candidates (`iceServers: []`) with zero external servers. If your Wi-Fi router has **AP Isolation / Client Isolation** enabled (common on public/guest Wi-Fi), disable Client Isolation or use a normal private Wi-Fi/router so computers can exchange direct LAN media packets.

---

## 6. Changing Ports or Storage Location

- **In the UI:** Open **Admin Dashboard → Server Config**, update the HTTP Port, HTTPS Port, or Storage Directory, save, and restart the server.
- **Manually:** Edit `config/localhub.config.json` (or pass `LOCALHUB_PORT=4000` environment variable) and re-run `scripts\configure-firewall.bat` if you changed ports.

---

## 7. Backup & Restore

### From the Admin Dashboard (Recommended)
1. Go to **Admin Dashboard → Backups**.
2. Click **Create Full Backup (DB + Files)** (or **Database Only**).
3. To restore, click **Restore** next to any backup (a pre-restore safety snapshot of the current database is automatically created first).

### Using Windows Scripts
- **Backup:** Double-click **`backup.bat`** (creates a consistent SQLite `VACUUM INTO` snapshot + storage copy + SHA-256 manifest inside `backups/`). Pass `--db-only` for a database-only snapshot.
- **Restore:** Stop the server (`stop-server.bat`), then double-click **`restore.bat`** and select the backup number to restore.

---

## 8. Troubleshooting

| Problem | Solution |
| --- | --- |
| Partners cannot open `http://<HOST_IP>:3000` | Ensure all computers are on the same Wi-Fi/subnet, the Host PC Wi-Fi profile is set to **Private**, and `scripts\configure-firewall.bat` was run as Administrator. |
| "Microphone blocked" / Voice recorder disabled on partner PC | Open the **HTTPS** URL (`https://<HOST_IP>:3443`) instead of `http://`. Browsers forbid `getUserMedia` on non-HTTPS LAN IPs. |
| Host IP changed after router restart | Check the new LAN IP printed by `start-server.bat`. LOCAL HUB automatically re-issues its local HTTPS certificate to include any new LAN IP! For a permanent address, set a DHCP reservation for the Host PC in your router. |
| Port 3000 is already in use | Change `"port"` in `config/localhub.config.json` (or via Admin → Server Config) and restart. |
| Forgot a partner's password | Owner/Admin can reset any partner's password in **Admin Dashboard → Users & Invites → Reset Password**. |
| Works without internet? | Yes! After running `install.bat` once, LOCAL HUB uses zero CDNs, zero external fonts, zero cloud STUN/TURN, and runs 100% offline on your LAN. |

