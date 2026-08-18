-- ============================================================
-- Migration: 20260817000000_webhook_tools
-- Multi-instance custom webhooks — module "custom_webhook" support N
--
-- Today a workspace can configure exactly one custom_webhook (tool_configs
-- has UNIQUE(workspace_id, tool_id)). This migration adds `webhook_tools`,
-- where each row is one independently-named webhook instance (its own
-- name/description/url/params), so a workspace can expose several distinct
-- tools to the model (e.g. calcular_envio, registrar_lead, notificar_humano).
--
-- `tools.key = 'custom_webhook'` keeps existing as the catalog entry for
-- the *type* — it is no longer where per-instance config lives.
--
-- This migration is purely additive: it does not touch tool_configs or any
-- code path yet, so the existing single-webhook flow keeps working
-- unchanged until the app code is migrated over in a follow-up change.
-- ============================================================

CREATE TABLE IF NOT EXISTS webhook_tools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- Slug the model sees as the tool name (e.g. "calcular_envio"). Same
  -- charset as ai_params/payload_fields keys (see tool-config.ts).
  name TEXT NOT NULL CHECK (name ~ '^[a-z0-9_]+$' AND length(name) BETWEEN 1 AND 64),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  -- What the model reads to decide when to call this tool.
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 500),
  webhook_url TEXT NOT NULL,
  payload_fields JSONB DEFAULT '[]'::jsonb NOT NULL,
  ai_params JSONB DEFAULT '[]'::jsonb NOT NULL,
  enabled BOOLEAN DEFAULT TRUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (workspace_id, name)
);

CREATE INDEX IF NOT EXISTS idx_webhook_tools_workspace
  ON webhook_tools(workspace_id, enabled);

DROP TRIGGER IF EXISTS trg_webhook_tools_updated_at ON webhook_tools;
CREATE TRIGGER trg_webhook_tools_updated_at
  BEFORE UPDATE ON webhook_tools FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---- RLS — same admin/manager pattern as tool_configs ----
ALTER TABLE webhook_tools ENABLE ROW LEVEL SECURITY;

CREATE POLICY "webhook_tools_select_admins"
  ON webhook_tools FOR SELECT
  USING (
    workspace_id IN (SELECT auth_workspace_ids())
    AND auth_has_role(workspace_id, ARRAY['admin','manager']::workspace_role[])
  );

CREATE POLICY "webhook_tools_write_admins"
  ON webhook_tools FOR ALL
  USING (
    workspace_id IN (SELECT auth_workspace_ids())
    AND auth_has_role(workspace_id, ARRAY['admin']::workspace_role[])
  )
  WITH CHECK (
    workspace_id IN (SELECT auth_workspace_ids())
    AND auth_has_role(workspace_id, ARRAY['admin']::workspace_role[])
  );

-- ============================================================
-- Data migration: carry over any existing single custom_webhook config.
--
-- The pre-existing config becomes one row named "custom_webhook" (a valid
-- slug, so it keeps functioning as a tool the model can call). Workspaces
-- that want a more specific name (e.g. Margani's "calcular_envio") rename
-- this row from the new UI once it ships — no data is lost either way.
-- Skips workspaces with no webhook_url set (nothing meaningful to carry).
-- ============================================================
INSERT INTO webhook_tools (
  workspace_id, name, display_name, description, webhook_url,
  payload_fields, ai_params, enabled
)
SELECT
  tc.workspace_id,
  'custom_webhook',
  'Webhook personalizado',
  'Envía los datos del contacto a un webhook externo configurado por el negocio. Úsalo cuando debas notificar o registrar al contacto en un sistema externo.',
  tc.config->>'webhook_url',
  COALESCE(tc.config->'payload_fields', '[]'::jsonb),
  COALESCE(tc.config->'ai_params', '[]'::jsonb),
  tc.enabled
FROM tool_configs tc
JOIN tools t ON t.id = tc.tool_id
WHERE t.key = 'custom_webhook'
  AND COALESCE(tc.config->>'webhook_url', '') <> ''
ON CONFLICT (workspace_id, name) DO NOTHING;

-- ============================================================
-- End of migration: 20260817000000_webhook_tools
-- ============================================================
