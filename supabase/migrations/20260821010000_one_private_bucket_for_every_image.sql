-- One private bucket for every image the app stores, with the path carrying the org
-- boundary. Settles buildspec_2.md assumption A13, which decided that signed URLs are
-- used for both read and write and left the bucket layout open.
--
-- Reference Images land here now and Quote Photos land here next, because to Storage
-- they are the same object: a photograph off a phone, read back through a signed URL,
-- never transformed. What makes one a client's picture and the other a supplier's is
-- the row that points at it, not anything about the file. Two buckets would be two sets
-- of policies to keep in step for no difference either of them can see.
--
-- Paths are `{org_id}/{entity}/{entity_id}/{uuid}.{ext}`. The org id comes *first*
-- because it is the only segment a policy can match cheaply: `storage.foldername(name)`
-- splits the path into an array, and `[1]` is a leading segment or nothing at all.
-- Leading with the entity id instead would make every policy join back to the table
-- that owns it, on every object, on every read.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'images',
  'images',
  -- Never public. A public bucket serves every object to anyone who can guess a uuid,
  -- and these are a client's Reference Images and a supplier's Quote Photos.
  false,
  -- 10 MB per image: buildspec_2.md assumption A10 settled that there is a hard cap and
  -- left the number open. Images are compressed client-side before the upload, so this
  -- should rarely bind; it is here because a signed upload URL is a capability held by
  -- the browser for two hours, and the storage API is the only party in a position to
  -- refuse a body it is already reading.
  10485760,
  -- HEIC and HEIF are on the list for the fallback path, not the happy one: an iPhone
  -- hands over HEIC, and the compressor re-encodes to JPEG *unless* it cannot — in
  -- which case it uploads the original rather than dropping the picture. A list that
  -- refused HEIC would turn that fallback into a failure. Kept in step by hand with
  -- `imageContentTypes` in src/lib/images/images.ts, which is what refuses a content type
  -- before a URL is ever signed.
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do nothing;

-- The same single policy the schema's `public` tables get, in the one shape it can take
-- here: `org_id = public.current_org_id()` with the leading path segment standing in for
-- the column. The null behaviour it relies on is the same too — `current_org_id()` is
-- null for a caller who is signed out, has no profile row, or is disabled, and a
-- comparison against null is null rather than true, so all three match no object.
--
-- `for all` covers the write, the read and the delete, and each of the three is load
-- bearing. `insert` is what `createSignedUploadUrl()` checks before it mints a token,
-- `select` is what `createSignedUrl()` checks before it signs a read, and `delete` is
-- what removing a Reference Image needs.
create policy images_org_members_full_access on storage.objects
  for all to authenticated
  using (
    bucket_id = 'images'
    and (storage.foldername(name))[1] = public.current_org_id()::text
  )
  with check (
    bucket_id = 'images'
    and (storage.foldername(name))[1] = public.current_org_id()::text
  );

-- Nothing cascades from a Tender into Storage. Deleting a Tender takes its
-- `reference_images` rows with it and leaves the objects, which is a leak of bytes and
-- not of anything else — the objects are unreachable the moment the rows naming them are
-- gone, and there is deliberately no retention rule in v1 to hang a sweeper off.
