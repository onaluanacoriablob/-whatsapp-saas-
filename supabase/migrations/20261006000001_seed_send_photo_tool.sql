-- ============================================================
-- Migration: 20261006000001_seed_send_photo_tool
-- Agente WhatsApp — seed the new send_photo tool
--
-- send_photo is implemented and registered in code
-- (src/features/tools/tools/send-photo.ts → registry), but the Settings
-- catalog reads from public.tools and getEnabledTools() only returns
-- registry tools that have an enabled tool_configs row (which FKs to
-- tools). Seed it so it shows in the catalog and can be toggled per
-- workspace, same pattern as 20260617000001_seed_check_availability_tool.
--
-- The schema column is for catalog/display only — the agent builds the LLM
-- tool schema from the code zod definition. Idempotent via ON CONFLICT.
-- ============================================================

INSERT INTO public.tools (key, name, description, schema, sensitivity) VALUES
  ('send_photo', 'Enviar foto de color',
   'Sends real product photos (by color/variant label) to the customer via WhatsApp',
   '{"type":"object","properties":{"label":{"type":"string"},"caption":{"type":"string"}},"required":["label"]}',
   'write')
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      schema = EXCLUDED.schema,
      sensitivity = EXCLUDED.sensitivity;

-- ============================================================
-- End of migration: 20261006000001_seed_send_photo_tool
-- ============================================================
