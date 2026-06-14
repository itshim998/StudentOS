# StudentOS Pass 5 Private Source Uploads

Pass 5 keeps all file work backend-controlled.

## Required Supabase Setup

1. On each DATA SHARD project, run:

   `supabase/migrations/202605250005_studentos_pass5_source_upload_columns.sql`

2. Create a private Storage bucket on each DATA SHARD project.

   Use the name from `STUDENTOS_STORAGE_BUCKET`, default:

   `studentos-source-materials`

3. Keep the bucket private. Do not enable public URLs.

4. Storage object paths are backend-generated:

   ```text
   {user_id}/{course_id}/{source_id}/{original_filename}
   ```

5. The backend uploads and deletes objects with the routed shard service role. The browser never receives shard service keys or direct shard clients.

## Optional Storage RLS Notes

Service role bypasses RLS for backend workflows. If authenticated direct access is enabled in a later pass, start from strict owner policies like:

```sql
create policy "studentos_owner_read_objects"
on storage.objects for select
to authenticated
using (
  bucket_id = 'studentos-source-materials'
  and split_part(name, '/', 1) = auth.uid()::text
);

create policy "studentos_owner_insert_objects"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'studentos-source-materials'
  and split_part(name, '/', 1) = auth.uid()::text
);

create policy "studentos_owner_delete_objects"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'studentos-source-materials'
  and split_part(name, '/', 1) = auth.uid()::text
);
```

Pass 5 does not use these browser-direct policies. It keeps uploads, downloads, and deletes behind StudentOS backend routes.

## Extraction

Text and Markdown are extracted synchronously into source metadata and a linked `memory_items` row.

PDF, DOC, DOCX, PPT, and PPTX are registered with an extraction-pending stub. Full parsing and embeddings are deferred to a later pass.
