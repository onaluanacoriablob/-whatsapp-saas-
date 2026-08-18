import { NextRequest, NextResponse } from "next/server";
import { createClient as createSbClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  requireWorkspaceMember,
  readJsonBody,
} from "@/lib/auth/workspace-access";
import {
  webhookToolConfigSchema,
  webhookToolConfigObjectSchema,
  type WebhookField,
  type AiParam,
} from "@/features/tools/lib/tool-config";

// ──────────────────────────────────────────────────────────────────────────────
// CRUD for webhook_tools — the multi-instance replacement for the old single
// custom_webhook config. Each row is one tool the model sees under its own
// name (e.g. "calcular_envio"). See docs/custom-webhook-multi-instance.md.
// ──────────────────────────────────────────────────────────────────────────────

function svc() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

const SELECT_COLUMNS =
  "id, name, display_name, description, webhook_url, payload_fields, ai_params, enabled, created_at, updated_at";

const POSTGRES_UNIQUE_VIOLATION = "23505";

function nameClashError(name: string) {
  return NextResponse.json(
    {
      error: `Ya existe una tool llamada "${name}" en este workspace — elegí otro nombre`,
    },
    { status: 409 },
  );
}

interface WebhookToolDbRow {
  id: string;
  name: string;
  display_name: string;
  description: string;
  webhook_url: string;
  payload_fields: WebhookField[];
  ai_params: AiParam[];
  enabled: boolean;
}

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/tools/[workspaceId]/webhooks
// Lists every webhook instance for the workspace (enabled or not).
// ──────────────────────────────────────────────────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params;

  const auth = await requireWorkspaceMember(workspaceId);
  if (!auth.ok) return auth.response;

  const supabase = svc();
  const { data, error } = await supabase
    .from("webhook_tools")
    .select(SELECT_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[GET /api/tools/:workspaceId/webhooks]", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 },
    );
  }

  return NextResponse.json({ data: data ?? [] });
}

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/tools/[workspaceId]/webhooks
// Creates a new webhook instance. `name` must be unique within the workspace
// and not collide with a static tool's name (webhookToolNameSchema +
// RESERVED_TOOL_NAMES, enforced by webhookToolConfigSchema).
// ──────────────────────────────────────────────────────────────────────────────
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params;

  const auth = await requireWorkspaceMember(workspaceId, {
    minRole: "manager",
  });
  if (!auth.ok) return auth.response;

  const parsedBody = await readJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;

  const parsed = webhookToolConfigSchema.safeParse(parsedBody.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const supabase = svc();

  // Pre-check for a clear 409 at save time (the ask: "no en runtime" — the
  // admin finds out immediately, not only once the model tries to call two
  // same-named tools). The DB's UNIQUE(workspace_id, name) is still the real
  // guarantee under a race — caught via the 23505 mapping below.
  const { data: existing } = await supabase
    .from("webhook_tools")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("name", parsed.data.name)
    .maybeSingle();

  if (existing) return nameClashError(parsed.data.name);

  const { data, error } = await supabase
    .from("webhook_tools")
    .insert({ workspace_id: workspaceId, ...parsed.data })
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    if (error.code === POSTGRES_UNIQUE_VIOLATION) {
      return nameClashError(parsed.data.name);
    }
    console.error("[POST /api/tools/:workspaceId/webhooks]", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 },
    );
  }

  return NextResponse.json({ data }, { status: 201 });
}

// ──────────────────────────────────────────────────────────────────────────────
// PATCH /api/tools/[workspaceId]/webhooks
// Edits an existing instance. Body: { id, ...partial fields }.
//
// Partial fields are merged onto the current row and the FULL result is
// re-validated against webhookToolConfigSchema — a partial update can't be
// allowed to leave the row violating the whole-object invariants (payload
// field / ai_param key collisions, reserved names) just because the fields
// that would trip them weren't the ones being edited this time.
// ──────────────────────────────────────────────────────────────────────────────

const PatchBodySchema = z
  .object({ id: z.string().uuid() })
  .merge(webhookToolConfigObjectSchema.partial());

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params;

  const auth = await requireWorkspaceMember(workspaceId, {
    minRole: "manager",
  });
  if (!auth.ok) return auth.response;

  const parsedBody = await readJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;

  const parsedShape = PatchBodySchema.safeParse(parsedBody.body);
  if (!parsedShape.success) {
    return NextResponse.json(
      { error: parsedShape.error.flatten() },
      { status: 400 },
    );
  }

  // Zod fills in defaults (enabled=true, payload_fields=[], ai_params=[])
  // for fields the schema declares but the request omitted — that's correct
  // for POST (a brand-new row), but here it would silently reset any field
  // the caller didn't intend to touch (e.g. a PATCH that only sends
  // {description} would otherwise re-enable a disabled instance and wipe
  // its params). Only fields the client actually sent get applied.
  const rawBody = parsedBody.body as Record<string, unknown>;
  const { id, ...parsedPatch } = parsedShape.data;
  const patch: Partial<typeof parsedPatch> = {};
  for (const key of Object.keys(parsedPatch) as (keyof typeof parsedPatch)[]) {
    if (key in rawBody) {
      (patch as Record<string, unknown>)[key] = parsedPatch[key];
    }
  }

  const supabase = svc();

  const { data: currentRow, error: fetchError } = await supabase
    .from("webhook_tools")
    .select(
      "id, name, display_name, description, webhook_url, payload_fields, ai_params, enabled",
    )
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (fetchError) {
    console.error("[PATCH /api/tools/:workspaceId/webhooks]", fetchError);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 },
    );
  }
  const current = currentRow as WebhookToolDbRow | null;
  if (!current) {
    return NextResponse.json(
      { error: "Webhook tool no encontrada" },
      { status: 404 },
    );
  }

  const merged = {
    name: current.name,
    display_name: current.display_name,
    description: current.description,
    webhook_url: current.webhook_url,
    payload_fields: current.payload_fields,
    ai_params: current.ai_params,
    enabled: current.enabled,
    ...patch,
  };

  const parsed = webhookToolConfigSchema.safeParse(merged);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  if (parsed.data.name !== current.name) {
    const { data: clash } = await supabase
      .from("webhook_tools")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("name", parsed.data.name)
      .neq("id", id)
      .maybeSingle();

    if (clash) return nameClashError(parsed.data.name);
  }

  const { data, error } = await supabase
    .from("webhook_tools")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    if (error.code === POSTGRES_UNIQUE_VIOLATION) {
      return nameClashError(parsed.data.name);
    }
    console.error("[PATCH /api/tools/:workspaceId/webhooks]", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 },
    );
  }

  return NextResponse.json({ data });
}

// ──────────────────────────────────────────────────────────────────────────────
// DELETE /api/tools/[workspaceId]/webhooks
// Removes one instance. Body: { id }.
//
// Scoped by id AND workspace_id, so it can only ever remove exactly the one
// row it targets — it can't reach another instance (even in the same
// workspace) or another workspace's row (IDOR). webhook_tools has no child
// tables (nothing references a row's id), so there's nothing to orphan.
// Confirms a row actually matched (via .select() on the delete) instead of
// silently no-op'ing 200 on a bad id.
// ──────────────────────────────────────────────────────────────────────────────

const DeleteBodySchema = z.object({ id: z.string().uuid() });

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params;

  const auth = await requireWorkspaceMember(workspaceId, {
    minRole: "manager",
  });
  if (!auth.ok) return auth.response;

  const parsedBody = await readJsonBody(req);
  if (!parsedBody.ok) return parsedBody.response;

  const parsed = DeleteBodySchema.safeParse(parsedBody.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const supabase = svc();

  const { data, error } = await supabase
    .from("webhook_tools")
    .delete()
    .eq("id", parsed.data.id)
    .eq("workspace_id", workspaceId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[DELETE /api/tools/:workspaceId/webhooks]", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json(
      { error: "Webhook tool no encontrada" },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true });
}
