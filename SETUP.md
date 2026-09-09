# Setup — running the Vantage dashboard locally

This covers cloning the repo and getting the **Vantage dashboard**
(`backend/` FastAPI + `vantage-frontend/` React app) running on your own
machine from scratch. If you're also setting up the git-hooks Kiro credit
tracking on a dev laptop (a separate, optional piece — see §2 of the main
README), that's covered by [README.md §5](README.md#5-setup-instructions)
instead; this file is just about the dashboard app itself.

## 0. Prerequisites

- **Python 3.10+** and `pip`
- **Node.js 20+** and `npm`
- **AWS credentials** for a base IAM user with `sts:AssumeRole` on two
  role ARNs (one for CodeCommit, one for the Kiro-usage S3 bucket — see
  step 2 below). Ask whoever manages this project's AWS account for
  these if you don't have them.
- A Jira Cloud site, and access to register/reuse an **Atlassian OAuth
  app** at <https://developer.atlassian.com/console/myapps/> (needed for
  the Jira tab's login — everything else works without it).
- SonarQube is optional — the app runs fine without it; only the
  SonarQube panel needs a real token, and shows an honest "not
  connected" state until one is provided.

## 1. Clone and install dependencies

```bash
git clone <this-repo-url>
cd v1

# Backend
cd backend
python3 -m venv .venv && source .venv/bin/activate   # optional but recommended
pip install -r requirements.txt
cd ..

# Frontend
cd vantage-frontend
npm install
cd ..
```

## 2. Fill in your own environment variables

Nothing here is committed to git — `backend/.env` and
`vantage-frontend/.env` are both gitignored (`**/.env` in `.gitignore`).
Copy the two example files and fill in real values:

```bash
cp backend/.env.example backend/.env
cp vantage-frontend/.env.example vantage-frontend/.env
```

- **`backend/.env`** — see the comments inside `backend/.env.example`
  for exactly where each value comes from (AWS keys, the two role ARNs,
  the CodeCommit repo/branch, the Jira OAuth app's client ID/secret, the
  Kiro-usage S3 bucket/prefix, and optionally SonarQube).
- **`vantage-frontend/.env`** — `VITE_JIRA_CLIENT_ID` (same value as
  `backend/.env`'s `JIRA_CLIENT_ID` — it's the public half of the OAuth
  app) and `VITE_JIRA_REDIRECT_URI`.

  **This redirect URI must be registered exactly as a callback URL on
  your Atlassian app, and must match the port the frontend dev server
  actually runs on.** `vantage-frontend/vite.config.ts` pins the dev
  server to port `5174` (`strictPort: true`) specifically so this can
  never silently drift to a different port and break Jira login — leave
  both the `.env` value and the `vite.config.ts` port in sync if you
  ever need to change either.

## 3. Populate real data (first run only)

`backend/data/*.parquet` (commits + pull requests) and
`backend/data/tracked_tickets.txt` are gitignored — a fresh clone starts
with **no local data cache at all**. The dashboard reads from this local
cache, not live AWS, on every request (see `backend/services/
duckdb_service.py`), so you need to populate it at least once before any
ticket will show data:

```bash
cd backend
python3 scripts/refresh_data.py --ticket ANG-123   # replace with a real ticket ID
```

This makes a real AWS CodeCommit call for that one ticket's commits/PRs
and writes them into the local Parquet cache — `--ticket` is repeatable
(`--ticket ANG-123 --ticket ANG-4571`), and once at least one ticket has
been refreshed this way, `python3 scripts/refresh_data.py --all`
re-refreshes every ticket already tracked. The same thing is available
at runtime via `POST /api/refresh/{ticket_id}` (or `POST /api/refresh`
for `--all`) once the backend is running — see step 4.

There's no automatic background refresh yet — a ticket's data is only as
fresh as the last time it (or `--all`) was refreshed, manually or via
that endpoint.

## 4. Run the backend

```bash
cd backend
uvicorn main:app --reload --port 8000
```

Confirm it's up: `curl http://localhost:8000/api/health` should return
`{"status":"ok"}`. Endpoints that need env vars you left as placeholders
(SonarQube, Jira) fail with a clear real error (e.g. a 503) rather than
crashing the whole server — everything else works independently.

## 5. Run the frontend

```bash
cd vantage-frontend
npm run dev
```

Because of the pinned port from step 2, this must land on
**`http://localhost:5174`** — if you see a "Port 5174 is already in use"
error instead, something else (maybe a previous instance of this same
dev server) is already holding that port; stop it first. Vite proxies
`/api/*` requests to the backend at `localhost:8000` (see
`vite.config.ts`), so both need to be running together.

Open **http://localhost:5174** — you should see the Overview page load
real ticket data for whichever ticket(s) you refreshed in step 3.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| A ticket page says "isn't tracked yet — run scripts/refresh_data.py" | You haven't run step 3 for that ticket yet. |
| `GET /api/commits/...` or `/api/tickets` 500s | Same as above, or `backend/data/` doesn't exist yet at all — step 3 creates it. |
| Users page fails to load | Check `AWS_KIRO_S3_ROLE_ARN` / `KIRO_USAGE_S3_BUCKET` / `KIRO_USAGE_S3_PREFIX` in `backend/.env` — this page always calls S3 live, no local cache to fall back on. |
| Jira tab: "Log in with Atlassian" seems to silently fail | `VITE_JIRA_REDIRECT_URI` doesn't match both the port the frontend is actually running on *and* what's registered on the Atlassian app — see step 2's note. |
| SonarQube panel shows "not connected" | Expected without a real `SONARQUBE_URL`/`SONARQUBE_TOKEN` — not a bug. |
