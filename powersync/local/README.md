# Local PowerSync + Supabase Backend

This folder provides a local backend for:
- Supabase (local)
- PowerSync service
- MongoDB sync bucket storage

## Prerequisites
- Supabase CLI installed (`supabase`)
- Docker with Compose

## Start local backend
1. `cd /Users/michael/dev/repos/powersync-community/sync-agents/powersync/local`
2. `cp .env.supabase-mongo.example .env.supabase-mongo`
3. Start Supabase:
   - `supabase start`
4. Start PowerSync + Mongo:
   - `docker compose -f compose.supabase-mongo.yaml --env-file .env.supabase-mongo up -d`

## Stop local backend
1. `docker compose -f compose.supabase-mongo.yaml --env-file .env.supabase-mongo down`
2. `supabase stop`

## App env values
Set these in `/Users/michael/dev/repos/powersync-community/sync-agents/.env`:
- `CLOUD_SYNC_EXPERIMENTAL=1`
- `SUPABASE_URL=http://127.0.0.1:54321`
- `SUPABASE_ANON_KEY=<anon key from supabase status>`

PowerSync local URL:
- `http://127.0.0.1:8080`

## Notes
- Supabase project id is `syncagents`, so container DNS names follow that suffix.
- SQL migration avoids `create policy if not exists` and uses guarded `DO $$` blocks.
- Storage policies are created only after workspace tables exist.
