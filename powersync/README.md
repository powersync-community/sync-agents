# Local PowerSync + Supabase Backend

This folder provides a local backend for:
- Supabase (local)
- PowerSync service
- MongoDB sync bucket storage

## Prerequisites
- Supabase CLI installed (`supabase`)
- Docker with Compose

## Start local backend
1. `cd powersync/local` (from the repo root)
2. `cp .env.supabase-mongo.example .env.supabase-mongo`
3. Start Supabase:
   - `supabase start`
4. Start PowerSync + Mongo:
   - `docker compose -f compose.supabase-mongo.yaml --env-file .env.supabase-mongo up -d`

## Stop local backend
1. `docker compose -f compose.supabase-mongo.yaml --env-file .env.supabase-mongo down`
2. `supabase stop`

## App env values
Set these in the repo root `.env` file:
- `CLOUD_SYNC_EXPERIMENTAL=1`
- `SUPABASE_URL=http://127.0.0.1:54321`
- `SUPABASE_PUBLISHABLE_KEY=<anon key from supabase status>`

PowerSync local URL:
- `http://127.0.0.1:8080`

## Test user (seeded automatically)
- **Email:** `dev@syncagents.local`
- **Password:** `devpass123`
- **Workspace:** "Dev Workspace" (owner)

### Verify sign-in
```bash
# Get the anon key
supabase status

# Test sign-in
curl -s -X POST 'http://127.0.0.1:54321/auth/v1/token?grant_type=password' \
  -H "apikey: <anon-key>" \
  -H "Content-Type: application/json" \
  -d '{"email":"dev@syncagents.local","password":"devpass123"}'

# Test sign-up (no email confirmation required)
curl -s -X POST 'http://127.0.0.1:54321/auth/v1/signup' \
  -H "apikey: <anon-key>" \
  -H "Content-Type: application/json" \
  -d '{"email":"newuser@test.com","password":"testpass123"}'
```

## Notes
- Supabase project id is `syncagents`, so container DNS names follow that suffix.
- SQL migration avoids `create policy if not exists` and uses guarded `DO $$` blocks.
- Storage policies are created only after workspace tables exist.
- JWT algorithm is ES256 (Supabase CLI default). PowerSync Service v1.19.0+ validates via JWKS.
