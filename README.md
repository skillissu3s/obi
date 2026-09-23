# Obi

A calm, fast, self-hosted note app for the web — built for people who keep their notes in **markdown** and their vault in **GitHub**, and who want the same notes (plus real-time collaboration) from any browser.

Obi gives you two kinds of workspace:

| | **GitHub workspace** | **Online workspace** |
|---|---|---|
| Storage | your own git repository | this server (`/data` volume) |
| Works with Obsidian | ✅ two-way sync | — |
| Real-time co-editing | ✅ (your own devices) | ✅ with other people |
| Share a single page | publish link | ✅ per-person, editor/viewer |
| Share the whole workspace | — (private to you) | ✅ members with roles |
| History | full git history | automatic snapshots + trash |

Both kinds are plain markdown, folders and attachments — never a proprietary format. Both get exactly the same editor, whiteboards and note canvas.

---

## Features

**Writing**
- Obsidian-style **live preview**: headings, bold, links, callouts, tables, images and checkboxes render as you type; the raw markdown appears on the line you're editing
- Source view and reading view (`Ctrl/⌘ E`)
- `[[wiki links]]` with autocomplete, aliases (`[[Note|label]]`), heading links (`[[Note#Section]]`) and auto-created notes
- `![[embeds]]` for notes, images, audio, video and PDFs
- `#tags` (nested `#area/sub`), front-matter properties, footnote-free clean markdown
- `/` slash menu for blocks, templates, dates
- Callouts (`> [!tip]`), task lists, tables, **KaTeX math**, **Mermaid diagrams**, syntax-highlighted code
- Paste or drag images straight into a note — uploaded to your attachments folder
- Automatic link rewriting when you rename or move notes
- Kanban **board view** for notes with `kanban-plugin: basic` front matter (compatible with the Obsidian Kanban plugin)
- Daily notes with templates, template insertion, inline title editing

**Whiteboards & the note canvas** (every workspace, GitHub or online)
- **Whiteboards** (`.board` files): rectangles, ellipses, diamonds, arrows that stay attached to shapes, lines with bends and curves, freehand pen, highlighter, text, sticky notes, images, frames, links to notes or web pages, eraser and a laser pointer. Hand-drawn or clean style, fills and hatching, dashes, arrowheads, grouping, locking, alignment, snapping and a grid, copy/paste, undo, zoom and pan, export to PNG/SVG
- **Embed a whiteboard in a note** with `![[Sketch.board]]` (or `/whiteboard` in the slash menu) — it shows as a live drawing and you can edit it right there
- **Every note has a canvas around it.** Open *Canvas* at the bottom of a note to draw over or beside the text, drop sticky notes, images and page links into the margins. Drawings are pinned to the paragraph they sit next to, so they move with the text as you write
- **Select text** for a small toolbar: highlight it, attach a sticky note (joined by a dashed arrow), link a page beside it, or start an arrow from it and drop the end on anything — shapes or other text
- Pan with the scroll wheel (sideways on notes), **Space + drag**, the **middle mouse button** or the hand tool; `Ctrl/⌘` + wheel zooms whiteboards
- Live cursors and selections when several people are on the same whiteboard or note canvas
- The markdown never changes: a note's canvas is saved beside it in `.obi/layers/<note path>.json` and follows the note when it's renamed, moved, deleted or restored. Whiteboards and layers are plain JSON with one element per line, and simultaneous edits from different machines are merged element by element during git sync

**Finding things**
- Command palette (`Ctrl/⌘ K`), quick switcher (`Ctrl/⌘ O`)
- Full-text search with `tag:`, `path:`, `file:`, `"phrases"` and `-exclusions`
- Backlinks **and** unlinked mentions, outline, local graph, note info
- Global **graph view** — force-directed, folder-coloured, filterable
- Tasks view across the whole workspace (grouped by due date or note)
- Calendar with daily-note dots, bookmarks, recent notes

**Working together** (online workspaces)
- Real-time collaborative editing with live cursors and presence avatars
- Share a single note with specific people (can edit / can view), or add members to the whole workspace
- Publish any note to a public read-only link that updates live
- Version history with diffs and one-click restore; trash with restore

**GitHub sync**
- Server keeps a working copy, commits your edits and pushes them; pulls remote changes on an interval
- Real 3-way merges; conflicting notes are saved as `Note (conflict 2026-09-16 1230).md` instead of being lost
- Per-file git history, restore any old version
- Tokens encrypted at rest (AES-256-GCM)

**Admin**
- `/admin` console: create users, reset passwords, promote admins, disable/delete accounts, one-time invite links, see every workspace and its sync state

**Everything else**
- **13 colour themes**, each with a light and a dark version. Light-first: Paper (crisp white & ink blue), Sand, Sakura, Mint, Sky. Dark-first: Sumi (warm ink & paper), Graphite, Midnight, Nordic, Forest, Ember, Mocha, Nebula. Switch from *Settings → Appearance* or the command palette (“Colour theme: …”). Themes restyle the whole app, including drawings: surfaces, text, borders, syntax highlighting and accent.
- Optional accent override on top of any theme, three editor fonts, adjustable size/line-height, readable line width, focus mode
- Minimal chrome by design: no panel borders, flat tabs, a header that fades until you reach for it. The left side shows either the full sidebar or a slim icon ribbon, and hidden toggles appear when the pointer nears a panel edge
- Split panes, tabs, per-workspace layout persistence
- Mobile layout with a formatting toolbar, installable as a PWA
- Import/export a workspace as `.zip` (drop in an Obsidian vault)
- Offline-tolerant: edits are kept locally and merged when the connection comes back

---

## Deploying on Dokploy

### Option A — Compose (recommended)

1. **Create the app**: Dokploy → *Create Service* → **Compose**, point it at this repository (or paste `docker-compose.yml`).
2. **Environment variables** (Dokploy → *Environment*):

   ```env
   APP_SECRET=<openssl rand -base64 48>
   ADMIN_USERNAME=you
   ADMIN_PASSWORD=<a strong password>
   ```

3. **Volume**: the compose file already declares the named volume `obi-data` mounted at `/data`. Everything (SQLite database, workspace files, git clones) lives there — back up that one volume.
4. **Domain**: add your domain in Dokploy and point it at port **3000**. Enable HTTPS (Let's Encrypt). Traefik's WebSocket support is on by default, which Obi needs for live editing.
5. **Deploy**, then open `https://your-domain/` and sign in with the admin account, or open `https://your-domain/admin` to create users.

### Option B — Dockerfile app

Dokploy → *Create Service* → **Application** → Build type **Dockerfile**:

- Port: `3000`
- Same environment variables as above
- **Required:** *Advanced → Mounts → Add Mount* → **Volume Mount**, volume name `obi-data`, mount path `/data`

> ⚠️ **Without that mount every redeploy starts from an empty database.** An Application service gets a brand-new
> container on each deploy, and the image's `/data` falls back to an unnamed volume that the new container never
> sees again — users, workspaces and online notes appear to vanish (the admin comes back because it is re-created
> from `ADMIN_USERNAME`/`ADMIN_PASSWORD`). Obi detects this: the startup log prints a warning and admins see a red
> banner in the app and in `/admin`. The Compose option above doesn't have this problem — it declares the volume.

### Option C — plain Docker

```bash
cp .env.example .env && nano .env
docker compose up -d --build
```

### Recovering data after a redeploy wiped it

The old data is usually still on the server — each deploy without a mount left its database behind in an unnamed
volume, and Docker doesn't delete those on its own. On the Dokploy host (SSH in as root):

```bash
# 1. list every volume that holds an Obi database, newest first
#    (copy the script over first: scp scripts/find-obi-data.sh root@your-server:~ )
sh ~/find-obi-data.sh

LAST WRITE                VOLUME                                   USERS  WORKSPACES  USERNAMES
2026-09-16T09:58:22.412Z  f546842d…                                users=1  workspaces=1  admin
2026-09-16T09:58:15.163Z  814109e2…                                users=2  workspaces=2  admin,carol   ← the one you want

# 2. copy that volume into the named volume the app will use from now on
OLD=<volume id from the list>
docker volume create obi-data
docker run --rm -v "$OLD":/from:ro -v obi-data:/to alpine sh -c 'cp -a /from/. /to/'
```

Then add the `obi-data` → `/data` Volume Mount in Dokploy (Option B above) and redeploy. Anything created since the
wipe lives in the newest volume and is replaced by this copy, so pick the volume you want to keep.

If the old deploy ran without `APP_SECRET` and the new one sets it (or the other way round), passwords still work
but saved GitHub tokens can't be decrypted — re-enter them in *Settings → GitHub sync*.

The script is read-only: it mounts each volume `:ro` and inspects a copy of the database.

### Updating

Redeploy (or `docker compose up -d --build`). The server saves open documents and pushes pending GitHub changes on shutdown; connected browsers reconnect and re-sync automatically.

---

## Environment variables

| Variable | Default | What it does |
|---|---|---|
| `APP_SECRET` | random, stored in `/data/secret.key` | Encrypts GitHub tokens. **Set this in production** — if it changes, stored tokens must be re-entered. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | — | Creates (or promotes) this admin on start. If unset, the first visit to `/admin` offers a setup screen. |
| `ADMIN_RESET_PASSWORD` | `0` | Set to `1` for one boot to reset the admin password. |
| `PORT` | `3000` | HTTP port. |
| `DATA_DIR` | `/data` | Database + workspace files. |
| `SESSION_DAYS` | `30` | Session lifetime. |
| `MAX_UPLOAD_MB` | `50` | Per-file upload limit. |
| `APP_NAME` | `Obi` | Shown on public pages. |
| `ALLOW_FILE_REMOTES` | `0` | Allows `file://`/local-path git remotes (testing only). |
| `PUBLIC_URL` | — | This server's public address, e.g. `https://notes.example.com`. Used in emails. |
| `REGISTRATION` | `open` | `open`: anyone can create an account (confirmed by an emailed code). `invite`: only through admin invite links. `closed`: admins create accounts. `open` needs email to be configured; without it the server behaves as `invite`. |
| `LOGIN_CODE` | `either` | `either`: sign in with a password **or** an emailed code. `always`: password, then an emailed code (two-step). `off`: password only. Codes need email to be configured. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | — / `587` / auto | Mail server for sign-up and sign-in codes. `SMTP_SECURE=1` for implicit TLS (port 465, chosen automatically on 465). |
| `SMTP_USER` / `SMTP_PASS` | — | Mail server login. |
| `SMTP_URL` | — | Alternative to the above in one line, e.g. `smtps://user:pass@smtp.example.com`. |
| `MAIL_FROM` | `SMTP_USER` | Sender, e.g. `Obi <no-reply@example.com>`. |
| `MAIL_LOG_CODES` | `0` | Development only: with no SMTP configured, print emails (and their codes) to the server log instead of sending them. |

---

## Email — sign-up and sign-in codes

Obi sends one kind of email: a 6-digit code, for confirming a new account,
signing in without a password, changing your email address, or resetting a
forgotten password. Without email configured the server quietly falls back to
invite-only sign-up and password-only sign-in, and says so on the sign-in page.

Use a sending service rather than your own SMTP server: a fresh IP has no
reputation, most hosts block outbound port 25, and a sign-in code in someone's
spam folder means they cannot get in. Any provider with an SMTP relay works —
Brevo, Resend, Amazon SES, Postmark.

**1. Authenticate your domain** with the provider (they give you DKIM records
and usually a verification record). Send from a subdomain, e.g.
`obi.example.com`, so the app's mail keeps its own reputation:

| Record | Where | What it does |
|---|---|---|
| DKIM (from the provider) | `obi.example.com` | signs the mail as yours |
| SPF `TXT` (from the provider) | `obi.example.com` | says the provider may send for you |
| DMARC `TXT` `v=DMARC1; p=none; rua=mailto:you@example.com` | `_dmarc.example.com` | asks for reports; tighten to `p=quarantine` once reports look clean |

No `MX` record is needed to *send*. Add one only if you want to receive mail at
that address (Cloudflare Email Routing forwards it for free).

**2. Point Obi at the relay** (Brevo's values shown; the user is the login the
provider gives you, not your own address):

```bash
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587                      # 587 is STARTTLS; for 465 also set SMTP_SECURE=1
SMTP_USER=9xxxxx001@smtp-brevo.com
SMTP_PASS=<the SMTP key>
MAIL_FROM="Obi <no-reply@obi.example.com>"
PUBLIC_URL=https://obi.example.com
```

`MAIL_FROM` must be on the domain you authenticated. If you leave it out, mail
goes out as the SMTP login, which looks broken and some relays refuse.

**3. Check it before anyone else does.** From the app directory (on Docker:
`docker exec -it obi node scripts/send-test-mail.mjs you@example.com`):

```bash
npm run mail:test you@example.com
```

It prints the settings in use, asks the relay whether it accepts the
credentials, then sends one message. In Gmail, open it and use *Show original*:
SPF, DKIM and DMARC should all say PASS. Send to an Outlook address too — it is
the fussier of the two. The startup log also prints one `[mail]` line saying
where mail goes.

Free plans have a daily cap (Brevo's is 300/day). Every registration and every
"send a new code" spends one; Obi's rate limits (10 registrations an hour and 6
resends per 15 minutes, per IP) keep that in check, and `REGISTRATION=invite`
removes the exposure altogether if the server is only for you.

---

## Connecting a GitHub repository

1. In Obi: workspace switcher → **New workspace** → **GitHub repository**.
2. Repository URL: `https://github.com/you/notes` (the `git@github.com:you/notes.git` form is accepted too). An empty repo is fine.
3. Token: GitHub → *Settings* → *Developer settings* → **Fine-grained tokens** → *Generate new token* → select your notes repository → **Repository permissions → Contents: Read and write** → generate, then paste it into Obi. (Classic tokens with the `repo` scope also work.)
4. **Test connection**, pick the branch, create.

Obi clones the repo into its data volume, commits your edits (default: 30 s after you stop typing) and pulls remote changes every 2 minutes — so notes you write in Obsidian on your desktop show up here, and the other way round. Both intervals, the commit author and auto-sync itself are configurable in *Settings → GitHub sync*.

If the same note is edited in both places at once, git merges it line by line; only genuinely conflicting notes produce a `… (conflict <date>).md` copy, and the remote version stays in the original file.

> Your `.obsidian/` folder, `.git` and other dot-files are hidden in Obi but left untouched in the repository.

---

## Desktop app

Obi also runs as a desktop app (Electron) that works fully offline. It is the
same app: the server runs inside it on `127.0.0.1`, for you alone.

- **Every workspace is a vault** — a folder you choose, new or existing (an
  Obsidian vault works as is). Notes stay plain markdown files in it; edits
  made by other apps are picked up.
- **First run** asks where notes should live: sign in to (or create) an Obi
  account on your server and pick which cloud workspaces to bring down — each
  gets a folder — or keep everything on this computer.
- **Cloud sync** is file by file against the last version both sides agreed
  on: one-sided changes are copied, edits to different parts of a note are
  merged, and colliding edits keep both (a “conflict” copy). Offline, the
  status bar says so and everything is kept; it syncs when the connection is
  back. The cloud keeps version history and a trash, so nothing is lost. A
  local vault can go up to the cloud later (Settings → Sync), as a new cloud
  workspace or into an existing one.
- **GitHub sync** (Settings → Sync): the vault folder becomes the git working
  copy. Commit and push on save, on a timer, or only when you press
  *Commit & push*; set a commit-message template or type one; *Pull* fetches
  without pushing. Needs git installed.

```bash
npm run desktop          # build the client and open the app
npm run desktop:build    # installer for this OS in release/ (Windows .exe, macOS .dmg, Linux AppImage/.deb)
```

The app keeps its database (vault list, cloud sign-ins, sync state) in the
per-user app data folder; `OBI_DATA_DIR` overrides it. `OBI_CLOUD_URL` pre-fills
the server address on the sign-in screen. For development,
`OBI_DESKTOP=1 OBI_DESKTOP_WEB=1 npm run start` serves the desktop UI to a
browser at `/desktop-web`, with folders created under `OBI_DESKTOP_WEB_DIR`.

The installers are not code-signed, so Windows SmartScreen and macOS
Gatekeeper warn on first launch until signing is set up in `package.json → build`.

---

## Local development

```bash
npm install
npm run dev        # API on :3000, web on :5173
```

Open http://localhost:5173. Data goes to `./data`. Create the first admin at `/admin`.

```bash
npm run build      # build the client into dist/
npm start          # serve API + built client on :3000
```

Requires Node 22.13+ (uses the built-in `node:sqlite`) and `git` on the PATH for GitHub workspaces.

---

## How it works

```
client/   React + CodeMirror 6 (live preview, autocomplete, widgets), Yjs client, graph canvas
server/   Express API, WebSocket hub, Yjs documents, workspace runtime, git sync, SQLite metadata
shared/   markdown parser/renderer, link resolution, path helpers, diff/merge — used by both
```

- Every open note is a **Yjs document** on the server; browsers sync over one multiplexed WebSocket, so several devices/people can edit the same note without conflicts. The server debounces writes to disk (~1 s) and, for GitHub workspaces, commits and pushes on a timer.
- Notes are files. The server keeps an in-memory index (links, tags, headings, tasks, front matter) for instant search, backlinks and the graph, and updates it incrementally on every save.
- Whiteboards and note canvases are Yjs maps of elements (last write wins per element), saved as JSON. Canvas elements on a note carry a text anchor (a quote of the line plus some context) instead of a fixed position, so they follow edits made anywhere — other devices, git pulls, other apps.
- Metadata that isn't part of your markdown — users, sessions, members, shares, publish links, version snapshots, trash — lives in SQLite at `/data/obi.db`.
- Sessions are httpOnly cookies; passwords are scrypt-hashed; mutating API calls require a custom header (CSRF protection); uploaded files are served with a sandboxing CSP.
