# PowerSync + Supabase Integration Plan

## Purpose

Craft Agent is a desktop Electron app for AI-assisted development. Today every workspace is local-only — sessions, messages, and attachments live as JSON files on disk. This integration adds **optional real-time team sync** powered by PowerSync and Supabase, so teammates sharing a cloud-linked workspace see each other's chat sessions and messages appear automatically.

### What PowerSync + Supabase provides
- **PowerSync** — local-first SQLite sync engine running in the Electron main process. The app reads/writes a local SQLite database; PowerSync replicates changes bi-directionally with Supabase Postgres via sync rules scoped to workspace membership.
- **Supabase** — provides Auth (email/password), Postgres (source of truth for cloud data), Storage (attachment binaries), and Row-Level Security (workspace-scoped access control).
- **User experience** — cloud sync is entirely opt-in. Users who skip or never sign in get the same local-only experience. No existing data is migrated; only new data created after cloud linkage syncs.

### Architecture decisions (locked in)
- PowerSync runs in Electron **main process** (Node runtime); renderer talks through IPC only
- Auth lives in the **onboarding wizard** (optional final step), not workspace creation
- Workspace creation is **always local**; cloud linkage is a separate concern applied after auth
- PowerSync SQLite and attachment cache live under `{workspace}/.craft-agent/powersync/`
- Feature-gated behind `CLOUD_SYNC_EXPERIMENTAL=1` environment variable

---

## What's been completed

### Milestone 1: Dependencies
- `@powersync/node`, `better-sqlite3`, `@supabase/supabase-js` added to `apps/electron`

### Milestone 2: Main-Process Cloud Scaffolding + IPC Contract
- `apps/electron/src/main/cloud/supabase-auth.ts` — Full `SupabaseAuthService`: sign-in, sign-out, get-user, encrypted token persistence (`supabase_auth` credential type), auto-refresh, session recovery on restart
- `apps/electron/src/main/cloud/powersync-service.ts` — `PowerSyncService` class with stubbed lifecycle methods (`connect`, `disconnect`, `reconnect`, `getStatus`)
- `apps/electron/src/main/cloud/workspace-storage.ts` — `ensureCloudWorkspaceStoragePaths()` for creating `powersync/db/` and `powersync/attachments/` directories
- `apps/electron/src/main/cloud/types.ts` — Re-exports `SupabaseAuthState` and `SyncStatus`
- `apps/electron/src/main/ipc.ts` — IPC handlers for `SUPABASE_SIGN_IN`, `SUPABASE_SIGN_OUT`, `SUPABASE_GET_USER`, `CLOUD_WORKSPACE_LIST` (stub), `CLOUD_WORKSPACE_CREATE` (stub), `CLOUD_WORKSPACE_LINK_LOCAL` (stub), `SYNC_GET_STATUS`, `SYNC_RECONNECT`; all gated behind `CLOUD_SYNC_EXPERIMENTAL`
- `apps/electron/src/preload/index.ts` — Preload API surface for all cloud methods
- `apps/electron/src/shared/types.ts` — `SupabaseAuthState`, `SyncStatus`, `CloudWorkspace`, `CreateWorkspaceOptions`, `StorageMode`, `WorkspaceLinkState` types
- `packages/shared/src/credentials/manager.ts` — `getSupabaseAuth()`, `setSupabaseAuth()`, `deleteSupabaseAuth()` on `CredentialManager`
- `packages/core/src/types/workspace.ts` — `storageMode` and `cloudWorkspaceId` fields on `Workspace` type

### Milestone 3: Local-Only Workspace Creation
- Removed "Create cloud workspace" choice card from `AddWorkspaceStep_Choice.tsx`
- Removed `mode` prop and cloud-conditional UI from `AddWorkspaceStep_CreateNew.tsx`
- Removed `createMode` state, cloud auth checks, and `onCreateCloud` handler from `WorkspaceCreationScreen.tsx`
- Removed cloud auth guard from `CREATE_WORKSPACE` IPC handler — always creates `local_only`
- `storageMode` / `cloudWorkspaceId` fields retained in types for future cloud linking

### Milestone 4: Local Dev Backend
- `powersync/local/compose.supabase-mongo.yaml` — Docker Compose: PowerSync service + MongoDB (sync bucket storage)
- `powersync/local/supabase/config.toml` — Supabase local config (project ID: `syncagents`)
- `powersync/local/supabase/migrations/20260223152000_cloud_chat_schema.sql` — Full schema:
  - Tables: `cloud_workspaces`, `workspace_members`, `chat_sessions`, `chat_messages`, `chat_attachments`
  - RLS policies on all tables via `is_workspace_member()` helper
  - `chat-attachments` storage bucket with member-scoped policies
- `powersync/local/powersync.yaml` — Sync rules: `workspace_data` bucket parameterized by user's workspace memberships
- `powersync/local/README.md` — Setup instructions

### Milestone 5: Supabase Auth Core
- Sign-in, sign-out, get-user fully implemented with encrypted persistence
- Sign-up **not yet exposed** at the IPC surface (needed in Milestone 5b)

---

## What's next

### Milestone 5b: Move Auth into Onboarding Wizard

Supabase auth is currently wired to cloud IPC handlers but has no UI entry point (the workspace creation UI was stripped in Milestone 3). This milestone adds auth as an optional final step of the onboarding wizard, plus a post-onboarding path in workspace settings.

#### Current onboarding flow
`welcome → [git-bash (Windows)] → api-setup → credentials → complete → done`

#### Target onboarding flow
`welcome → [git-bash (Windows)] → api-setup → credentials → complete → team-sync → done`

#### Key files
- Hook: `apps/electron/src/renderer/hooks/useOnboarding.ts`
- Wizard: `apps/electron/src/renderer/components/onboarding/OnboardingWizard.tsx`
- Step components: `apps/electron/src/renderer/components/onboarding/{WelcomeStep,APISetupStep,CredentialsStep,CompletionStep,GitBashWarning}.tsx`
- Primitives: `apps/electron/src/renderer/components/onboarding/primitives.tsx` (reusable `StepFormLayout`, `StepIcon`, `StepHeader`, `StepActions`, `ContinueButton`, `BackButton`)
- Settings: `apps/electron/src/renderer/pages/settings/WorkspaceSettingsPage.tsx`
- IPC: `apps/electron/src/main/ipc.ts`
- Auth service: `apps/electron/src/main/cloud/supabase-auth.ts`
- Preload: `apps/electron/src/preload/index.ts`
- Shared types: `apps/electron/src/shared/types.ts`

#### A. Enable sign-up in IPC
- Add `signUp(email, password)` method to `SupabaseAuthService`
- Add `SUPABASE_SIGN_UP` IPC channel (or extend `SUPABASE_SIGN_IN` to accept a `mode` param)
- Expose `supabaseSignUp` in preload API and `ElectronAPI` type

#### B. Add `team-sync` step to onboarding state machine
- Add `'team-sync'` to the `OnboardingStep` union (currently defined inline in `OnboardingWizard.tsx`)
- Wire into `useOnboarding.ts`:
  - `complete` → `team-sync` (instead of calling `onComplete` immediately)
  - `team-sync` → calls `onComplete()` on both "Skip" and successful auth
  - Back from `team-sync` → `complete`
- Add state fields: `teamSyncStatus: 'idle' | 'signing-in' | 'signing-up' | 'success' | 'error'`, `teamSyncError?: string`, `teamSyncMode: 'sign-in' | 'sign-up'`

#### C. Create `TeamSyncStep.tsx`
- New file: `apps/electron/src/renderer/components/onboarding/TeamSyncStep.tsx`
- Reuse existing primitives (`StepFormLayout`, `StepIcon`, `StepHeader`, `StepActions`, `ContinueButton`)
- Heading: "Sync chats with your team" with "Skip for now" link
- Toggle between sign-in / sign-up form (email + password fields)
- On success: brief confirmation, then call `handleFinish`
- On skip: call `handleFinish` directly

#### D. Wire `TeamSyncStep` into `OnboardingWizard.tsx`
- Render `<TeamSyncStep />` when `state.step === 'team-sync'`
- Pass handlers: `handleTeamSyncSubmit(email, password, mode)`, `handleTeamSyncSkip`

#### E. Link first workspace on auth success during onboarding
- When auth succeeds during onboarding, call `CLOUD_WORKSPACE_CREATE` (implement the stub) to provision a cloud workspace record in Supabase
- Link it to the user's first local workspace: set `storageMode: 'cloud_canonical'` and `cloudWorkspaceId`
- Provision PowerSync paths via `ensureCloudWorkspaceStoragePaths`

#### F. Post-onboarding path in workspace settings
- Add "Team Sync" section to `WorkspaceSettingsPage.tsx`:
  - If linked: show sync status
  - If not linked: show "Enable cloud sync" button
- "Enable cloud sync" opens inline sign-in/sign-up (reuse `TeamSyncStep` UI or extract shared form component)
- On success: link current workspace and provision PowerSync paths

#### Acceptance criteria
1. New users see "Sync with your team?" step after completing LLM setup
2. Skipping completes onboarding normally — local-only experience unchanged
3. Signing in or creating an account during onboarding links the default workspace to cloud
4. Existing users who skipped can enable cloud sync via workspace settings
5. Auth session persists across app restart
6. Unverified email users see a clear message and cannot proceed with cloud features

---

### Milestone 6: PowerSync Wiring (SQLite Read/Write Path)

Triggered when a workspace has `storageMode === 'cloud_canonical'` and a valid Supabase session.

#### Key files
- `apps/electron/src/main/cloud/powersync-service.ts` — currently stubbed
- `apps/electron/src/main/cloud/supabase-auth.ts` — provides JWT for connector
- `apps/electron/src/main/ipc.ts` — `SYNC_GET_STATUS`, `SYNC_RECONNECT`
- Session manager (wherever sessions are currently read/written as JSON files)

#### Changes
1. **`powersync-service.ts`** — Initialize PowerSync DB at workspace's local SQLite path (`{workspace}/.craft-agent/powersync/db`)
2. Implement `PowerSyncConnector`:
   - `fetchCredentials()` — return Supabase JWT from credential store
   - `uploadData()` — write pending local mutations to Supabase source tables via `supabase-js`
3. **Session manager** — For cloud workspaces, route session list/read/create/append through PowerSync SQLite instead of flat JSON files
4. **IPC handlers** — `SYNC_GET_STATUS` and `SYNC_RECONNECT` return real PowerSync status

#### Acceptance criteria
1. Session list/read/create/append works against local PowerSync SQLite
2. Pending local writes upload and reach Supabase source tables
3. A second app instance (same Supabase account) receives synced updates

---

### Milestone 7: Attachments via PowerSync + Supabase Storage

1. Integrate PowerSync attachments API from latest SDK guidance
2. Upload binaries to Supabase Storage; sync metadata via DB tables
3. Keep local cache path for runtime compatibility

#### Acceptance criteria
1. Attachment send/read works across two clients
2. Attachment metadata syncs through PowerSync; binaries resolve from Storage

---

### Milestone 8: Workspace and RLS Hardening

1. Finalize schema for `cloud_workspaces`, `workspace_members`, `chat_sessions`, `chat_messages`, `chat_attachments`
2. Verify RLS for workspace membership on all tables
3. Verify Supabase Storage policies scoped by workspace membership

#### Acceptance criteria
1. Non-members cannot read or write workspace data
2. Storage object access is blocked for non-members

---

### Milestone 9: Cutover and Cleanup

1. Keep `CLOUD_SYNC_EXPERIMENTAL` flag for staged rollout
2. Remove obsolete plan docs and placeholder IPC stubs
3. Final onboarding copy and UX polish for team-sync step

#### Acceptance criteria
1. New chats in a cloud-linked workspace sync to teammates
2. Local-only mode works unchanged when flag is off or user skipped team sync

---

## Out of scope
- One-time import/migration of historical local sessions
- Automatic conversion of pre-cloud attachments