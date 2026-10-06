-- ============================================================
-- Migration: 20261006000000_product_images
-- Agente WhatsApp — catalog photos the agent can send over WhatsApp
--
-- Lets a workspace upload one or more photos per label (e.g. a color/variant
-- name) so the AI agent can send the real photo to a customer via the
-- send_photo tool, instead of only describing it in text.
--
-- New bucket is PUBLIC (unlike whatsapp-media, which is private): these are
-- catalog photos, not customer data, and need stable long-lived URLs (not
-- 1h signed URLs) since YCloud fetches the URL whenever a message is sent,
-- which can be weeks after upload. Filenames are opaque UUIDs so the color
-- catalog can't be enumerated from the storage path.
-- ============================================================

CREATE TABLE IF NOT EXISTS product_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  image_urls TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_images_workspace_label
  ON product_images (workspace_id, lower(label));
CREATE INDEX IF NOT EXISTS idx_product_images_workspace ON product_images(workspace_id);

DROP TRIGGER IF EXISTS trg_product_images_updated_at ON product_images;
CREATE TRIGGER trg_product_images_updated_at
  BEFORE UPDATE ON product_images FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE product_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "product_images_select"
  ON product_images FOR SELECT
  USING (workspace_id IN (SELECT auth_workspace_ids()));

CREATE POLICY "product_images_write"
  ON product_images FOR ALL
  USING (
    workspace_id IN (SELECT auth_workspace_ids())
    AND auth_has_role(workspace_id, ARRAY['admin','manager']::workspace_role[])
  )
  WITH CHECK (
    workspace_id IN (SELECT auth_workspace_ids())
    AND auth_has_role(workspace_id, ARRAY['admin','manager']::workspace_role[])
  );

-- Public bucket for outbound product/catalog photos.
-- NOTE: if the INSERT below fails because the service role lacks direct
-- storage schema write access, create the bucket via the Supabase dashboard
-- (Storage → New bucket) with name "product-photos", Public ON, file size
-- limit 10 MB, allowed MIME types image/jpeg, image/png, image/webp — then
-- re-run this migration so the RLS policies below are applied.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-photos',
  'product-photos',
  true,
  10485760, -- 10 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "service_role_upload_product_photos"
ON storage.objects
FOR INSERT
TO service_role
WITH CHECK (bucket_id = 'product-photos');

CREATE POLICY "service_role_delete_product_photos"
ON storage.objects
FOR DELETE
TO service_role
USING (bucket_id = 'product-photos');

-- ============================================================
-- End of migration: 20261006000000_product_images
-- ============================================================
