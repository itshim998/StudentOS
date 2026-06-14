# StudentOS Pass 3 Supabase Shards

StudentOS uses four Supabase projects:

- Project 1: Auth only, using `STUDENTOS_SUPABASE_URL_1` and `STUDENTOS_SUPABASE_ANON_KEY_1`.
- Project 2: Data shard 1, backend-only service role.
- Project 3: Data shard 2, backend-only service role.
- Project 4: Data shard 3, backend-only service role.

The browser may receive the Project 1 URL and anon key for login. It must never receive service-role keys, shard URLs, shard service-role keys, or `STUDENTOS_SUPABASE_JWT_SECRET`.

## Runtime Modes

Set `STUDENTOS_MODE=mock` for local demos.

Set `STUDENTOS_MODE=supabase` after all Project 1 auth values and Project 2-4 shard values are configured.

Set `STUDENTOS_MODE=auto` to use Supabase only when all required variables are present.

## Migration Steps

Do not run these migrations automatically from the app. Apply them intentionally from the Supabase SQL editor or your controlled migration runner.

1. Project 1, Auth:

   Run `supabase/migrations/202605250003_studentos_pass3_auth_metadata.sql`.

2. Project 2, Data Shard 1:

   Run `supabase/migrations/202605250004_studentos_pass3_data_shard_schema.sql`.

3. Project 3, Data Shard 2:

   Run `supabase/migrations/202605250004_studentos_pass3_data_shard_schema.sql`.

4. Project 4, Data Shard 3:

   Run `supabase/migrations/202605250004_studentos_pass3_data_shard_schema.sql`.

## Storage Plan

Pass 3 stores source-material metadata only. File bytes stay disabled.

Use a private bucket named by `STUDENTOS_STORAGE_BUCKET`, defaulting to `studentos-source-materials`.

Future object paths should be user-scoped:

```text
{user_id}/{course_id}/{source_material_id}/{filename}
```

Deletion should first soft-delete `source_materials.deleted_at`, then delete the object from the private bucket in a controlled backend workflow.

## Shard Routing

The backend maps the Project 1 auth user id to a data shard with stable `sha256(user_id) % shard_count`.

API responses return only the selected shard label and project number. They never include shard URLs or secrets.
