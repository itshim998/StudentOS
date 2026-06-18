# StudentOS Supabase Keepalive

StudentOS uses four Supabase projects:

- `auth`: StudentOS Auth project.
- `data-shard-1`: StudentOS Data Shard 1.
- `data-shard-2`: StudentOS Data Shard 2.
- `data-shard-3`: StudentOS Data Shard 3.

Supabase free-tier projects can be paused after inactivity. This keepalive exists to create low-cost, harmless activity against all four StudentOS projects so auth and shard access are less likely to pause unexpectedly.

## Schedule

The GitHub Actions workflow `Supabase Keepalive - StudentOS` runs once daily at `03:17 UTC` and can also be started manually with `workflow_dispatch`.

This is intentionally not a 5-minute or 13-minute uptime monitor. StudentOS should not keep Azure Container Apps permanently warm, and this heartbeat only talks directly to Supabase with a small REST read. Each run performs:

- `GET /rest/v1/studentos_keepalive?select=id,name&limit=1` for all four projects.
- `GET /auth/v1/health` for the Auth project.

## SQL To Apply

Apply this SQL file to every StudentOS Supabase project:

```text
supabase/migrations/pass32_4_studentos_keepalive.sql
```

Run it in:

1. StudentOS Auth project.
2. StudentOS Data Shard 1.
3. StudentOS Data Shard 2.
4. StudentOS Data Shard 3.

The migration creates `public.studentos_keepalive` with one fixed row only. It contains no private user data, enables RLS, grants anon read access only to `id` and `name`, and defines no anon insert, update, or delete policy.

## GitHub Secrets

Use project URLs plus anon or publishable keys only. Do not add service-role keys to this workflow.

Required repository secrets:

```text
STUDENTOS_SUPABASE_URL_1
STUDENTOS_SUPABASE_ANON_KEY_1
STUDENTOS_SUPABASE_URL_2
STUDENTOS_SUPABASE_ANON_KEY_2
STUDENTOS_SUPABASE_URL_3
STUDENTOS_SUPABASE_ANON_KEY_3
STUDENTOS_SUPABASE_URL_4
STUDENTOS_SUPABASE_ANON_KEY_4
```

Project mapping:

- `STUDENTOS_SUPABASE_URL_1` and `STUDENTOS_SUPABASE_ANON_KEY_1`: Auth project.
- `STUDENTOS_SUPABASE_URL_2` and `STUDENTOS_SUPABASE_ANON_KEY_2`: Data Shard 1.
- `STUDENTOS_SUPABASE_URL_3` and `STUDENTOS_SUPABASE_ANON_KEY_3`: Data Shard 2.
- `STUDENTOS_SUPABASE_URL_4` and `STUDENTOS_SUPABASE_ANON_KEY_4`: Data Shard 3.

The backend can continue to use service-role keys for backend-only operations. The keepalive workflow does not need them.

## Manual Workflow Run

In GitHub:

1. Open `Actions`.
2. Select `Supabase Keepalive - StudentOS`.
3. Choose `Run workflow`.
4. Confirm the run reports safe labels only: `auth`, `data-shard-1`, `data-shard-2`, and `data-shard-3`.

## Local Verification

After the SQL is applied and anon keys are available locally, run:

```powershell
node scripts/verifySupabaseKeepalive.js
```

The script reads `.env` locally unless `STUDENTOS_KEEPALIVE_SKIP_DOTENV=true` is set. It prints safe status only and never prints keys.

Successful output should show all four labels as `ok` and end with `"secretsPrinted": false`.
