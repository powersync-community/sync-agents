# PowerSync + Supabase Integration Plan v2

> Supersedes `master-plan.md`. The original plan is preserved for reference.

## Vision

Craft Agent is a local-first desktop app. This integration adds **optional cloud workspaces** for team visibility — shared spaces where members can see each other's AI sessions as read-only snapshots. The goal is **collective memory and visibility**, not real-time co-editing.

### Key principles
- **Local workspaces are unchanged** — no sync, no cloud, works exactly as before
- **Cloud workspaces are a separate type** — created/joined after signing in, appear alongside local workspaces in the sidebar
- **Sessions in cloud workspaces work normally for the creator** — same UX as local (working dir, sources, permissions all configured per-user as they go)
- **Other members see sessions read-only** — messages, attachments, metadata visible but not editable
- **Dual storage** — creator's session lives on their local disk (as-is) AND syncs to cloud via PowerSync/Supabase

### Architecture decisions (locked in)
- PowerSync runs in Electron **main process** (Node runtime); renderer talks through IPC only
- Auth lives in the **onboarding wizard** (optional skippable step) and **workspace settings**
- Local workspace creation is unchanged; cloud workspaces are created/joined separately
- PowerSync SQLite and attachment cache live under `{workspace}/.craft-agent/powersync/`
- Feature-gated behind `CLOUD_SYNC_EXPERIMENTAL=1` environment variable

### Future (out of scope for now)
- **Fork/branch**: copy a cloud session into your own, reconfigure local env (working dir, sources)
- **True collaboration**: map working dir + sources to your local machine, continue from another member's session without forking

---

## What's been completed

### Milestone 1: Dependencies
- `@powersync/node`, `better-sqlite3`, `@supabase/supabase-js` added to `apps/electron`

### Milestone 2: Cloud Scaffolding
- `supabase-auth.ts` — Full auth service (sign-in, sign-up, sign-out, encrypted token persistence, auto-refresh)
- `powersync-service.ts` — PowerSync lifecycle (connect, disconnect, disconnectAndClear, reconnect, waitForFirstSync)
- `powersync-connector.ts` — Supabase-backed PowerSync connector (fetchCredentials, uploadData)
- `powersync-schema.ts` — Client schema (5 tables: cloud_workspaces, workspace_members, chat_sessions, chat_messages, chat_attachments)
- `workspace-storage.ts` — PowerSync storage path helpers
- `cloud-sync.ts` — RPC handlers (9 channels: auth, workspace CRUD, sync status)
- `channel-map.ts` — Renderer API mappings for all cloud methods
- `RPC_CHANNELS.cloudSync` — Protocol channel definitions
- Types: `SupabaseAuthState`, `SyncStatus`, `CloudWorkspace`, `WorkspaceLinkState`, `StorageMode`

### Milestone 3: Local Workspace Creation
- Workspace creation always local — cloud linking is separate
- `storageMode` / `cloudWorkspaceId` on Workspace type

### Milestone 4: Local Dev Backend
- Docker Compose for PowerSync + MongoDB
- Supabase local config + migrations
- Tables: `cloud_workspaces`, `workspace_members`, `chat_sessions`, `chat_messages`, `chat_attachments`
- RLS policies with SECURITY DEFINER helpers (fixed infinite recursion)
- Sync rules (powersync.yaml)
- Seed data for dev (`dev@syncagents.local` / `devpass123`)

### Milestone 5: Auth + Onboarding
- Sign-in / sign-up / sign-out fully working with Supabase
- TeamSyncStep in onboarding wizard (skippable, after credential setup)
- Cloud workspace provisioning on sign-up (workspace + membership created in Supabase)
- Auth session persists across restart (encrypted credential storage)
- Dev/prod config isolation (`CRAFT_CONFIG_DIR`)

### Milestone 6: PowerSync Engine Wiring
- PowerSync client-side schema with session metadata columns
- CloudSessionStorage adapter (listSessions, loadSession, createSession, saveSession, updateMetadata, deleteSession)
- Session sidecar for local-only state (working dir, SDK state, read position)
- SessionManager cloud integration (setCloudServices, initCloudStorage, isCloudWorkspace, routeUpdateMetadata, startCloudSessionWatcher)
- waitForFirstSync with timeout + background listener + Supabase fallback

---

## What's next

### Milestone 7: Cloud Workspace as Distinct Entity

**Goal**: Cloud workspaces are a separate workspace type. Users create or join them after signing in. They appear alongside local workspaces in the sidebar.

#### 7A. Refactor workspace model
- A workspace is either `local` or `cloud`, determined at creation time
- Cloud workspace: backed by Supabase, synced via PowerSync. Local session files are a cache for the creator.
- Local workspace: unchanged, zero cloud awareness
- Update `StorageMode` type: `'local' | 'cloud'` (remove `'local_only'` and `'cloud_canonical'`)
- Remove `cloudWorkspaceLinkLocal` handler — no more linking existing local workspaces to cloud

#### 7B. Cloud workspace creation/joining flow
- After sign-in (onboarding or settings), user can **create** a new cloud workspace or **join** an existing one
- **Create cloud workspace**:
  - Creates record in Supabase (`cloud_workspaces` + `workspace_members` with role=owner)
  - Creates local workspace folder under `~/.craft-agent[-dev]/workspaces/{slug}/`
  - Registers in global config with `storageMode: 'cloud'` and `cloudWorkspaceId`
  - Connects PowerSync for sync
- **Join cloud workspace** (invite flow):
  - User is added to `workspace_members`
  - Same local folder + config setup as create
  - Invite mechanism TBD (email invite, shareable link, or admin-add)

#### 7C. Update onboarding TeamSyncStep
- After sign-up/sign-in, offer to create a cloud workspace (current behavior provisions one automatically — keep this but frame it as "Create a team workspace")
- Skip = just authenticated, no cloud workspace created yet
- Can create/join cloud workspaces later from settings or sidebar

#### 7D. Sidebar workspace indicator
- Workspace dropdown shows icon/badge distinguishing local vs cloud workspaces
- Cloud workspaces show "Shared" or member count indicator

#### 7E. User profile in sidebar
- Show authenticated user email at bottom of sidebar (when signed in)
- Logout button
- When not signed in: show "Sign in" link

#### 7F. Settings: Team Sync section
- In workspace settings:
  - If not signed in: "Sign in to enable team features" button (opens sign-in form)
  - If signed in, viewing local workspace: "This is a local workspace" info
  - If signed in, viewing cloud workspace: sync status, member list, workspace name

#### Acceptance criteria
1. User can create a cloud workspace after signing in
2. Cloud and local workspaces are visually distinct in the sidebar
3. User profile and logout visible in sidebar when authenticated
4. Local workspaces completely unaffected by cloud features

---

### Milestone 8: Session Sync (Cloud Workspace → Supabase)

**Goal**: When a user works in a cloud workspace, their sessions sync to the cloud so other members can see them.

#### 8A. Dual-write session storage
- For cloud workspaces, session CRUD writes to **both**:
  - Local JSON files (existing behavior, unchanged)
  - Supabase via PowerSync upload queue
- Local files = source of truth for the active creator
- Cloud = source of truth for other members' read-only views
- Sync triggers: session create, message append, metadata update, session delete

#### 8B. Session metadata sync
- **Synced to cloud**: name, created_by, created_at, updated_at, archived, labels, preview, message_count, last_message_at, last_message_role
- **NOT synced** (local sidecar only): working directory, SDK state, permission mode, read position, plan execution state, token usage

#### 8C. Message sync
- All messages synced to `chat_messages` table
- Content stored as JSONB (full message payload including tool calls, code blocks)
- Order preserved via `created_at` timestamps
- Large messages may need chunking strategy (future optimization)

#### 8D. Real-time sync watcher
- PowerSync `watch()` on `chat_sessions` table for the current cloud workspace
- When remote changes arrive (other member created/updated a session), update the session list
- Emit `sessions_reordered` event to refresh the renderer sidebar

#### Acceptance criteria
1. Sessions created in a cloud workspace appear in Supabase within seconds
2. Messages appended to a session appear in Supabase
3. A second app instance (different user, same workspace) sees sessions appear in real-time

---

### Milestone 9: Read-Only Session Viewing

**Goal**: Members can view other members' sessions in a cloud workspace but cannot edit them.

#### 9A. Session ownership model
- `chat_sessions.created_by` determines the owner
- Owner: full read/write (current behavior — send messages, configure session, delete)
- Other members: read-only (view messages, attachments, metadata — no input, no configuration)

#### 9B. Read-only session UI
- When viewing a session you don't own:
  - Message input area is hidden or disabled with explanation
  - Session header shows "Created by {name/email}" attribution
  - Permission mode, working dir, sources, SDK state not shown (irrelevant to viewer)
  - Messages render normally (tool calls, code blocks, diffs, etc.)
  - Attachments viewable/downloadable
- Session list shows creator attribution for each session in cloud workspaces

#### 9C. RLS enforcement
- `chat_sessions` SELECT: any workspace member
- `chat_sessions` INSERT/UPDATE/DELETE: only `created_by = auth.uid()`
- `chat_messages` SELECT: any workspace member
- `chat_messages` INSERT: only if parent session's `created_by = auth.uid()`
- PowerSync sync rules: all workspace data syncs to all members (reads are local SQLite, writes go through upload queue with RLS enforcement)

#### Acceptance criteria
1. Member A creates a session with messages in a cloud workspace
2. Member B sees the session in their list with creator attribution
3. Member B can read all messages but cannot send new ones or modify the session
4. Member B does not see Member A's working directory, SDK state, or other local-only data

---

### Milestone 10: Attachment Sync

**Goal**: Attachments in cloud workspace sessions are synced so all members can view them.

#### 10A. Upload attachments to Supabase Storage
- When a session in a cloud workspace has attachments, upload binaries to `chat-attachments` bucket
- Storage path: `{cloudWorkspaceId}/{sessionId}/{attachmentId}`
- Metadata synced via `chat_attachments` table through PowerSync

#### 10B. Download/cache attachments
- When viewing another member's session, download attachments on-demand from Supabase Storage
- Cache locally in `{workspace}/.craft-agent/powersync/attachments/`
- Use PowerSync attachment queue for background download

#### Acceptance criteria
1. Attachments in cloud sessions are uploaded to Supabase Storage
2. Other members can view/download attachments from shared sessions
3. Attachments are cached locally after first download

---

### Milestone 11: Polish & Hardening

#### 11A. Workspace member management
- View members of a cloud workspace in settings
- Invite flow (TBD — email invite, shareable link, or admin-add)
- Remove member (owner only)

#### 11B. Sync status UI
- Show sync indicator in sidebar or header for cloud workspaces
- States: "Syncing...", "Up to date", "Offline"
- Manual reconnect button

#### 11C. Error handling & offline resilience
- Graceful handling of network errors, sync failures
- Offline mode: cloud workspaces show cached data, queue writes for later
- Session conflicts are rare (owner is the only writer)

#### 11D. Feature flag cleanup
- Keep `CLOUD_SYNC_EXPERIMENTAL` for staged rollout
- Clean up debug logging
- Remove obsolete code and plan docs

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Renderer (React)                                │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ Sidebar   │ │ Session  │ │ Settings         │ │
│  │ • Local   │ │ • Normal │ │ • Team Sync      │ │
│  │ • Cloud ☁ │ │ • R/O 👁 │ │ • Profile        │ │
│  │ • Profile │ │          │ │ • Members        │ │
│  └──────────┘ └──────────┘ └──────────────────┘ │
└───────────────────┬─────────────────────────────┘
                    │ WebSocket RPC
┌───────────────────┴─────────────────────────────┐
│  Main Process                                    │
│  ┌──────────────┐  ┌─────────────────────────┐  │
│  │ SessionManager│  │ Cloud Sync Handlers     │  │
│  │ • Local JSON  │  │ • Auth (Supabase)       │  │
│  │ • Cloud dual  │  │ • Workspace CRUD        │  │
│  │   write       │  │ • Sync status           │  │
│  └───────┬──────┘  └────────┬────────────────┘  │
│          │                   │                    │
│  ┌───────┴──────┐  ┌────────┴────────────────┐  │
│  │ Local FS     │  │ PowerSync SQLite        │  │
│  │ (JSON files) │  │ (sync engine)           │  │
│  └──────────────┘  └────────┬────────────────┘  │
└──────────────────────────────┬───────────────────┘
                               │ Sync
┌──────────────────────────────┴───────────────────┐
│  Supabase                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │ Auth     │ │ Postgres │ │ Storage          │  │
│  │ (users)  │ │ (data)   │ │ (attachments)    │  │
│  └──────────┘ └──────────┘ └──────────────────┘  │
└───────────────────────────────────────────────────┘
```

---

## Key files reference

| Area | File | Purpose |
|------|------|---------|
| Auth | `apps/electron/src/main/cloud/supabase-auth.ts` | Supabase auth service |
| Sync | `apps/electron/src/main/cloud/powersync-service.ts` | PowerSync lifecycle |
| Sync | `apps/electron/src/main/cloud/powersync-connector.ts` | Supabase ↔ PowerSync bridge |
| Schema | `apps/electron/src/main/cloud/powersync-schema.ts` | Client-side sync schema |
| Storage | `apps/electron/src/main/cloud/cloud-session-storage.ts` | Cloud session CRUD adapter |
| Storage | `apps/electron/src/main/cloud/session-sidecar.ts` | Local-only per-device state |
| Handlers | `apps/electron/src/main/handlers/cloud-sync.ts` | Cloud RPC handlers |
| Protocol | `packages/shared/src/protocol/channels.ts` | RPC channel definitions |
| Channel map | `apps/electron/src/transport/channel-map.ts` | Renderer API mappings |
| Sessions | `packages/server-core/src/sessions/SessionManager.ts` | Session orchestration |
| Types | `apps/electron/src/shared/types.ts` | Shared type definitions |
| Core types | `packages/core/src/types/workspace.ts` | Workspace + StorageMode types |
| UI | `apps/electron/src/renderer/components/onboarding/TeamSyncStep.tsx` | Onboarding auth step |
| Migration | `supabase/migrations/20260223152000_cloud_chat_schema.sql` | Base schema |
| Migration | `supabase/migrations/20260326_fix_workspace_members_rls.sql` | RLS recursion fix |
| Build | `scripts/electron-build-main.ts` | Build defines (env vars) |
| Config | `.env` | Dev environment config |

---

## Out of scope
- One-time import/migration of historical local sessions to cloud
- Automatic conversion of pre-cloud attachments
- Real-time co-editing of a session by multiple users
- Working directory or source auto-mapping across machines
