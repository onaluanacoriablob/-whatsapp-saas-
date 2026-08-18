/**
 * tool-config.ts — shared (UI + server) Zod schemas and helpers for the
 * configurable tools: schedule_link (a scheduling URL) and custom_webhook
 * (a webhook URL + a payload built from variables).
 *
 * Pure module: no "use server", no DB — safe to import from client components.
 */

import { z } from "zod";

// ── Webhook payload variables ──────────────────────────────────────────────────

export type WebhookVariableCategory = "Contacto" | "Conversación" | "Negocio";

export interface WebhookVariableDef {
  /** Token written as {{token}} in a field value. */
  token: string;
  label: string;
  example: string;
  category: WebhookVariableCategory;
}

/** Variables the admin can drop into webhook payload field values. */
export const WEBHOOK_VARIABLES: WebhookVariableDef[] = [
  {
    token: "contact.name",
    label: "Nombre del contacto",
    example: "Juan Pérez",
    category: "Contacto",
  },
  {
    token: "contact.phone",
    label: "Teléfono",
    example: "+5219981234567",
    category: "Contacto",
  },
  {
    token: "contact.email",
    label: "Email",
    example: "juan@correo.com",
    category: "Contacto",
  },
  {
    token: "last_user_message",
    label: "Último mensaje",
    example: "Hola, quiero info",
    category: "Conversación",
  },
  {
    token: "conversation.id",
    label: "ID de conversación",
    example: "a1b2c3…",
    category: "Conversación",
  },
  {
    token: "note",
    label: "Nota del agente",
    example: "Interesado en blanqueamiento",
    category: "Conversación",
  },
  {
    token: "business.name",
    label: "Negocio",
    example: "Clínica Sonrisa",
    category: "Negocio",
  },
];

/** Distinct categories in display order. */
export const WEBHOOK_VARIABLE_CATEGORIES: WebhookVariableCategory[] = [
  "Contacto",
  "Conversación",
  "Negocio",
];

export type WebhookVariableValues = Record<string, string>;

/** Replaces {{token}} occurrences with the resolved value (missing → ""). */
export function resolveTemplate(
  template: string,
  values: WebhookVariableValues,
): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, token: string) => {
    const v = values[token];
    return typeof v === "string" ? v : "";
  });
}

// ── Config schemas (validated at the save boundary) ────────────────────────────

const HTTPS_URL = z
  .string()
  .trim()
  .url("Debe ser una URL válida")
  .max(2000)
  .refine((u) => u.startsWith("https://"), "La URL debe ser HTTPS");

export const scheduleLinkConfigSchema = z.object({
  scheduling_link: HTTPS_URL,
});
export type ScheduleLinkConfig = z.infer<typeof scheduleLinkConfigSchema>;

export const webhookFieldSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-zA-Z0-9_]+$/, "Solo letras, números y guion bajo"),
  value: z.string().max(500),
});
export type WebhookField = z.infer<typeof webhookFieldSchema>;

// ── AI-completed webhook parameters ─────────────────────────────────────────────
// Unlike payload_fields (resolved server-side from fixed tokens), these become
// real function-calling parameters: the model fills them in from the
// conversation, the same way schedule-highlevel.ts's schema fields work.

export const aiParamSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .regex(/^[a-zA-Z0-9_]+$/, "Solo letras, números y guion bajo"),
  type: z.enum(["string", "number", "boolean"]),
  description: z
    .string()
    .trim()
    .min(1, "La descripción es obligatoria (es lo que lee el modelo)")
    .max(300),
  required: z.boolean(),
});
export type AiParam = z.infer<typeof aiParamSchema>;

/** Reserved key: the fixed `note` field always exists on custom_webhook's schema. */
const RESERVED_WEBHOOK_KEYS = new Set(["note"]);

/**
 * Shared payload_fields/ai_params key-collision checks — used by both the
 * legacy single-webhook schema and the per-instance webhookToolConfigSchema.
 */
function checkFieldKeyCollisions(
  val: { payload_fields: WebhookField[]; ai_params: AiParam[] },
  ctx: z.RefinementCtx,
): void {
  const payloadFieldKeys = new Map<string, number>();
  val.payload_fields.forEach((f, idx) => {
    if (!payloadFieldKeys.has(f.key)) payloadFieldKeys.set(f.key, idx);
  });

  const seenAiParamKeys = new Map<string, number>();
  val.ai_params.forEach((p, idx) => {
    if (RESERVED_WEBHOOK_KEYS.has(p.key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ai_params", idx, "key"],
        message: `"${p.key}" es un campo fijo reservado (nota del agente) — usa otro nombre`,
      });
      return;
    }
    if (payloadFieldKeys.has(p.key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ai_params", idx, "key"],
        message: `"${p.key}" ya existe como campo del payload — usa otro nombre o borra ese campo`,
      });
      return;
    }
    if (seenAiParamKeys.has(p.key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ai_params", idx, "key"],
        message: `"${p.key}" está repetido en otro parámetro IA`,
      });
      return;
    }
    seenAiParamKeys.set(p.key, idx);
  });
}

export const webhookConfigSchema = z
  .object({
    webhook_url: HTTPS_URL,
    payload_fields: z.array(webhookFieldSchema).max(20).default([]),
    ai_params: z.array(aiParamSchema).max(20).default([]),
  })
  .superRefine(checkFieldKeyCollisions);
export type WebhookConfig = z.infer<typeof webhookConfigSchema>;

// ── Multi-instance webhook tools (webhook_tools table) ──────────────────────────
// Each row is one independently-named tool the model sees (e.g. "calcular_envio"),
// vs. the single webhook_url above. See docs/custom-webhook-multi-instance.md.

/** Tool names already used by static, non-webhook tools — can't be reused as a
 * webhook instance name or the model would see two tools with the same name. */
export const RESERVED_TOOL_NAMES = new Set([
  "echo",
  "schedule_link",
  "schedule_highlevel",
  "check_availability",
]);

export const webhookToolNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9_]+$/, "Minúsculas, números y guion bajo, sin espacios")
  .refine((n) => !RESERVED_TOOL_NAMES.has(n), {
    message: "Ese nombre ya lo usa otra tool del sistema — elige otro",
  });

/**
 * Base shape (pre-refinement) — exported separately so API routes can derive
 * a `.partial()` for PATCH bodies. `webhookToolConfigSchema` below is what
 * should be used to validate a *complete* instance (e.g. after merging a
 * PATCH's partial fields onto the current row) since the key-collision
 * check needs the full payload_fields/ai_params to be meaningful.
 */
export const webhookToolConfigObjectSchema = z.object({
  name: webhookToolNameSchema,
  display_name: z.string().trim().min(1).max(80),
  description: z
    .string()
    .trim()
    .min(1, "La descripción es obligatoria (es lo que lee el modelo)")
    .max(500),
  webhook_url: HTTPS_URL,
  payload_fields: z.array(webhookFieldSchema).max(20).default([]),
  ai_params: z.array(aiParamSchema).max(20).default([]),
  enabled: z.boolean().default(true),
});

export const webhookToolConfigSchema = webhookToolConfigObjectSchema.superRefine(
  checkFieldKeyCollisions,
);
export type WebhookToolConfig = z.infer<typeof webhookToolConfigSchema>;

/** Maps an AI param definition to the Zod type the model fills in. */
function zodForAiParam(p: Pick<AiParam, "type" | "description" | "required">): z.ZodTypeAny {
  const base: z.ZodTypeAny =
    p.type === "number" ? z.number() : p.type === "boolean" ? z.boolean() : z.string();
  return p.required ? base.describe(p.description) : base.optional().describe(p.description);
}

/**
 * Builds the effective Zod schema for the custom_webhook tool: the fixed
 * `note` field plus one field per workspace-configured ai_param. This is the
 * schema that gets converted to JSON Schema for the model's tool-calling —
 * see zodSchema(tool.schema) in openrouter.ts.
 */
export function buildCustomWebhookSchema(aiParams: AiParam[] = []) {
  return z.object({
    note: z
      .string()
      .max(500)
      .optional()
      .describe("Nota corta opcional para incluir en el webhook ({{note}})"),
    ...Object.fromEntries(aiParams.map((p) => [p.key, zodForAiParam(p)])),
  });
}

/** Maps a tool key to its config schema (undefined = no configurable fields). */
export function configSchemaForTool(toolKey: string): z.ZodTypeAny | undefined {
  if (toolKey === "schedule_link") return scheduleLinkConfigSchema;
  if (toolKey === "custom_webhook") return webhookConfigSchema;
  return undefined;
}
