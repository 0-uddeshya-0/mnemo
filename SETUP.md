# MNEMO — device setup

MNEMO runs entirely on your Mac (private, free, offline-capable) and is reachable from
your iPhone/iPad. Everything below is already installed and running unless noted.

## What's running on the Mac (auto-starts at login)

| Piece | What | How it starts |
|---|---|---|
| **Postgres 16 + pgvector** | your brain's database, on `127.0.0.1:55432` | Homebrew service (`postgresql@16`) |
| **Ollama + qwen2.5:7b** | the local LLM (no cloud, no quota) | Homebrew service (`ollama`) |
| **Web app** | the MNEMO UI + API, on `http://localhost:3000` | launchd `com.mnemo.web` |
| **Worker** | ingest + nightly synthesis + **daily digest (8am)** | launchd `com.mnemo.worker` |
| **MNEMO.app** | the desktop icon (in /Applications) | you click it |

> Postgres was moved off Docker to a native install for reliability — Docker Desktop was
> wedging under memory pressure on 16GB. A SQL backup of the original is in `backups/`.

## Desktop app

Open **MNEMO** from Launchpad / Applications (or Spotlight: "MNEMO"). It makes sure the
stack is up and opens MNEMO in its own app window. To pin it: right-click its Dock icon →
Options → Keep in Dock.

## Control commands (run in `apps/web`)

```bash
pnpm mnemo status     # is everything up?
pnpm mnemo restart    # restart web + worker
pnpm mnemo logs       # live logs
pnpm digest           # run the daily digest right now
```

## iPhone / iPad (one-time, ~5 min)

A permanent home-screen app needs a stable HTTPS URL. We use **Tailscale** (free, private —
only your own devices, works anywhere).

1. **On the Mac:** install + sign in to Tailscale
   ```bash
   brew install --cask tailscale     # enter your Mac password when asked
   open -a Tailscale                 # sign in (Google/email)
   ```
   then expose MNEMO:
   ```bash
   pnpm mnemo:expose                 # prints https://<your-mac>.<tailnet>.ts.net
   ```
2. **On the iPhone:** install **Tailscale** from the App Store, sign in with the **same**
   account.
3. In **Safari** on the iPhone, open the `https://…ts.net` URL from step 1, log in to MNEMO.
4. Tap **Share → Add to Home Screen**. You now have the MNEMO app icon. It opens full-screen,
   works on cellular, and caches your brain for offline use.

## Connectors — give MNEMO senses + hands (optional)

In MNEMO → **Settings → Agents & API → Senses & Hands**. Reading is automatic; any *action*
(create event, draft email, add Notion page) is always **proposed for your approval** first.

- **Notion:** create an internal integration at <https://www.notion.so/my-integrations>, share
  your pages with it, then set `NOTION_TOKEN` in `.env` → `pnpm mnemo restart`.
- **Google (Calendar + Gmail):** in Google Cloud Console create a **Desktop app** OAuth client
  (enable the Calendar API + Gmail API), put its id/secret in `.env` as
  `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`, then run **`pnpm connect:google`**
  (one-time consent). It prints a `GOOGLE_OAUTH_REFRESH_TOKEN` for `.env` → `pnpm mnemo restart`.

Once connected, the agent gains tools automatically (e.g. *"what's on my calendar and how does
it relate to my goals?"*, *"draft a reply to the email from X"* → draft queued for your review).

### Siri (optional, voice)
With the Tailscale URL working, build a Shortcut named "Ask MNEMO":
Dictate Text → Get Contents of URL (`POST <ts-url>/api/agent`, header `Authorization: Bearer <API key>`,
JSON body `task` = Dictated Text) → Get Dictionary Value `spoken` → Speak Text.
Create the API key in MNEMO → Settings → Agents & API.
