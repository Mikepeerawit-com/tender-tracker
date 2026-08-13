// Mints the upload URL server-side with the real SDK call, because which of the two
// things Supabase calls a "signed upload URL" you use decides whether the browser can
// reach it at all (docs/research/17-wecom-webview.md §5.2):
//
//   createSignedUploadUrl()  → /storage/v1/object/upload/sign/… , permissive CORS  ← this
//   S3-protocol presign      → /storage/v1/s3 , CORS not configurable              ← not this
//
// The browser PUTs to whatever absolute URL this returns. It never assembles one.

import { createClient } from '@supabase/supabase-js';

const BUCKET = 'wecom-probe';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    res.status(500).json({ error: 'SUPABASE_URL / SUPABASE_SERVICE_KEY not set on this deployment' });
    return;
  }

  const supabase = createClient(url, key);
  const path = `probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(200).json({ url: data.signedUrl, path: data.path });
}
