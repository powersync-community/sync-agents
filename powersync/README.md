# Local PowerSync + Supabase backend

This folder configures the **local** stack used by Sync Agents for optional **cloud workspaces**:

- **Supabase** (CLI-managed) — Auth, Postgres, and Storage
- **PowerSync Service** (Docker) — replication and sync rules; sync bucket storage uses Postgres (see `powersync.yaml`)

Sync rules live in `sync-config.yaml`. Service config is in `powersync.yaml`.

## Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli) (`supabase`)
- Docker with Compose

## One-shot start (from repo root)

1. Copy env for the PowerSync container:

   ```bash
   cp powersync/.env.supabase.example powersync/.env.supabase
   ```

   Adjust values if needed (defaults match local Supabase project `syncagents`).

2. Copy app env at repo root:

   ```bash
   cp .env.example .env
   ```

   For cloud sync, set at least:

   - `CLOUD_SYNC_EXPERIMENTAL=1`
   - `SUPABASE_URL=http://127.0.0.1:54321`
   - `SUPABASE_PUBLISHABLE_KEY=<anon key from supabase status>`
   - `POWERSYNC_URL=http://127.0.0.1:8080`

3. Start Supabase and PowerSync:

   ```bash
   bun run start:local
   ```

   (`start:local` runs `supabase start` then `docker compose` with `compose.supabase.yaml`.)

4. Run the desktop app:

   ```bash
   bun run electron:start
   ```

## Stop / reset

```bash
bun run stop:local
```

## PowerSync URL (local)

Default HTTP endpoint: `http://127.0.0.1:8080` (port from `PS_PORT` in `powersync/.env.supabase`).

## Test user (seeded)

Defined in `supabase/seed.sql`:

- **Email:** `dev@syncagents.local`
- **Password:** `devpass123`

### Verify sign-in

```bash
# Anon key
supabase status

curl -s -X POST 'http://127.0.0.1:54321/auth/v1/token?grant_type=password' \
  -H "apikey: <anon-key>" \
  -H "Content-Type: application/json" \
  -d '{"email":"dev@syncagents.local","password":"devpass123"}'
```

## Notes

- Supabase project id is `syncagents` (see `supabase/config.toml`); Docker network `supabase_network_syncagents` is used by Compose.
- PowerSync Service validates JWTs via Supabase JWKS (`PS_BACKEND_JWKS_URI` in `powersync/.env.supabase`).
