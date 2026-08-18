import { createClient as createSbClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "../core/tool";
import { validateWebhookUrl } from "../services/ssrf-guard";
import {
  resolveTemplate,
  buildCustomWebhookSchema,
  type AiParam,
  type WebhookField,
  type WebhookVariableValues,
} from "../lib/tool-config";

// Each webhook_tools instance gets its own schema built from this helper +
// that row's ai_params — see buildWebhookInstanceTool(). Args is just the
// fixed `note` field shared by every instance; the dynamic ai_param keys
// aren't statically typed (see runWebhookPayload's `rawArgs` cast below).
type Args = z.infer<ReturnType<typeof buildCustomWebhookSchema>>;

function db() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/** Loads the variable values available to webhook payload fields. */
async function loadVariableValues(
  supabase: ReturnType<typeof db>,
  ctx: ToolContext,
  note: string,
): Promise<WebhookVariableValues> {
  const [contactRes, lastMsgRes, bizRes] = await Promise.all([
    ctx.contactId
      ? supabase
          .from("contacts")
          .select("name, phone, email")
          .eq("id", ctx.contactId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("messages")
      .select("body")
      .eq("conversation_id", ctx.conversationId)
      .eq("direction", "in")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("business_info")
      .select("structured")
      .eq("workspace_id", ctx.workspaceId)
      .maybeSingle(),
  ]);

  const contact = contactRes.data as {
    name?: string | null;
    phone?: string | null;
    email?: string | null;
  } | null;
  const lastMsg = lastMsgRes.data as { body?: string | null } | null;
  const structured = (bizRes.data as { structured?: { name?: string } } | null)
    ?.structured;

  return {
    "contact.name": contact?.name ?? "",
    "contact.phone": contact?.phone ?? "",
    "contact.email": contact?.email ?? "",
    last_user_message: lastMsg?.body ?? "",
    "business.name": structured?.name ?? "",
    "conversation.id": ctx.conversationId,
    note,
  };
}

interface WebhookInstanceConfig {
  webhook_url: string;
  payload_fields?: WebhookField[];
  ai_params?: AiParam[];
}

/**
 * Does the actual work for a webhook tool call: resolves payload variables,
 * merges in AI-completed params, and POSTs to the instance's own URL. Used
 * by buildWebhookInstanceTool() below — config is always already in hand
 * from the instance's webhook_tools row (see tool-configs.ts), never looked
 * up here, so a call can't cross over to another instance's URL.
 */
async function runWebhookPayload(
  config: WebhookInstanceConfig,
  args: Args,
  ctx: ToolContext,
): Promise<ToolResult> {
  const supabase = db();
  const webhookUrl = config.webhook_url.trim();
  if (!webhookUrl) {
    return { ok: false, output: null, error: "No webhook URL configured" };
  }

  // SEC-08: validate URL before fetching.
  const urlError = await validateWebhookUrl(webhookUrl);
  if (urlError) {
    return { ok: false, output: null, error: urlError };
  }

  // Resolve variables and build the payload from the configured fields.
  const values = await loadVariableValues(supabase, ctx, args.note ?? "");
  const fields = Array.isArray(config.payload_fields)
    ? config.payload_fields
    : [];

  const payload: Record<string, string> =
    fields.length > 0
      ? Object.fromEntries(
          fields.map((f) => [f.key, resolveTemplate(f.value, values)]),
        )
      : {
          // Sensible default when no fields are configured.
          contact_name: values["contact.name"],
          contact_phone: values["contact.phone"],
          last_user_message: values["last_user_message"],
          note: values.note,
        };

  // Merge in the AI-completed dynamic parameters. Keys can't collide with
  // payload_fields or `note` — that's enforced at save time (webhookConfigSchema
  // / webhookToolConfigSchema), so both kinds of field can safely live flat in
  // the same payload object.
  const aiParams = Array.isArray(config.ai_params) ? config.ai_params : [];
  const rawArgs = args as Record<string, unknown>;
  for (const p of aiParams) {
    const value = rawArgs[p.key];
    if (value !== undefined) payload[p.key] = String(value);
  }

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workspace_id: ctx.workspaceId, payload }),
    signal: AbortSignal.timeout(8_000),
  });

  return {
    ok: res.ok,
    output: { status: res.status },
    error: res.ok ? undefined : `HTTP ${res.status}`,
  };
}

/** A single row from webhook_tools — the shape getEnabledTools() reads. */
export interface WebhookToolRow {
  name: string;
  description: string;
  webhook_url: string;
  payload_fields: WebhookField[];
  ai_params: AiParam[];
}

/**
 * Builds one Tool per webhook_tools row, with the workspace-configured
 * name/description the model sees and a schema built from that row's own
 * ai_params. The returned tool's run closes over the row's own config
 * directly — no DB lookup at execution time, so it can never execute
 * against the wrong instance's URL.
 */
export function buildWebhookInstanceTool(row: WebhookToolRow): Tool<Args> {
  return {
    name: row.name,
    description: row.description,
    sensitivity: "sensitive",
    schema: buildCustomWebhookSchema(row.ai_params),
    enabledFor: () => true,
    run: (args, ctx) =>
      runWebhookPayload(
        {
          webhook_url: row.webhook_url,
          payload_fields: row.payload_fields,
          ai_params: row.ai_params,
        },
        args,
        ctx,
      ),
  };
}
