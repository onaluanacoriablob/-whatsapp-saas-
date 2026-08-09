"use client";

import { useState } from "react";
import { Plus, Trash2, Save, Link as LinkIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  WEBHOOK_VARIABLES,
  WEBHOOK_VARIABLE_CATEGORIES,
  scheduleLinkConfigSchema,
  webhookConfigSchema,
  type WebhookField,
  type AiParam,
} from "@/features/tools/lib/tool-config";

const AI_PARAM_TYPE_LABELS: Record<AiParam["type"], string> = {
  string: "Texto",
  number: "Número",
  boolean: "Sí/No",
};

// ── Shared save helper ──────────────────────────────────────────────────────────

async function saveToolConfig(
  workspaceId: string,
  toolKey: string,
  config: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`/api/tools/${workspaceId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ toolKey, config }),
  });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: unknown };
    throw new Error(
      typeof json.error === "string" ? json.error : "Error al guardar",
    );
  }
}

/** Small "unsaved changes" hint shown next to a save button. */
function DirtyHint({ dirty }: { dirty: boolean }) {
  if (!dirty) return null;
  return <span className="text-xs text-amber-400">• cambios sin guardar</span>;
}

// ── schedule_link ───────────────────────────────────────────────────────────────

function ScheduleLinkForm({
  workspaceId,
  initialConfig,
}: {
  workspaceId: string;
  initialConfig: Record<string, unknown> | null;
}) {
  const initialLink = (initialConfig?.scheduling_link as string) ?? "";
  const [link, setLink] = useState(initialLink);
  const [baseline, setBaseline] = useState(initialLink);
  const [saving, setSaving] = useState(false);

  const dirty = link.trim() !== baseline.trim();

  async function save() {
    const parsed = scheduleLinkConfigSchema.safeParse({
      scheduling_link: link,
    });
    if (!parsed.success) {
      toast.error("Pon una URL válida que empiece con https://");
      return;
    }
    setSaving(true);
    try {
      await saveToolConfig(workspaceId, "schedule_link", parsed.data);
      setBaseline(parsed.data.scheduling_link);
      toast.success("Link de agendamiento guardado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5 rounded-lg border border-border bg-muted/20 p-3">
        <Label
          htmlFor="sched-link"
          className="text-sm font-medium text-foreground"
        >
          Link de agendamiento
        </Label>
        <div className="relative">
          <LinkIcon
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="sched-link"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://calendly.com/tu-negocio/cita"
            type="url"
            className="pl-9"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          El agente enviará este enlace cuando alguien quiera agendar (Calendly,
          el booking de HighLevel, etc.).
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          onClick={save}
          disabled={saving || !dirty}
          aria-busy={saving}
        >
          <Save className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {saving ? "Guardando…" : "Guardar link"}
        </Button>
        <DirtyHint dirty={dirty} />
      </div>
    </div>
  );
}

// ── custom_webhook ──────────────────────────────────────────────────────────────

function WebhookForm({
  workspaceId,
  initialConfig,
}: {
  workspaceId: string;
  initialConfig: Record<string, unknown> | null;
}) {
  const initialUrl = (initialConfig?.webhook_url as string) ?? "";
  const initialFields = Array.isArray(initialConfig?.payload_fields)
    ? (initialConfig.payload_fields as WebhookField[])
    : [];
  const initialAiParams = Array.isArray(initialConfig?.ai_params)
    ? (initialConfig.ai_params as AiParam[])
    : [];

  const [url, setUrl] = useState(initialUrl);
  const [fields, setFields] = useState<WebhookField[]>(initialFields);
  const [aiParams, setAiParams] = useState<AiParam[]>(initialAiParams);
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify({
      webhook_url: initialUrl,
      payload_fields: initialFields,
      ai_params: initialAiParams,
    }),
  );
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);
  const [flashed, setFlashed] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const dirty =
    JSON.stringify({ webhook_url: url, payload_fields: fields, ai_params: aiParams }) !==
    baseline;

  function updateField(idx: number, patch: Partial<WebhookField>) {
    setFields((prev) =>
      prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)),
    );
  }
  function addField() {
    setFields((prev) => [...prev, { key: "", value: "" }]);
  }
  function removeField(idx: number) {
    setFields((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateAiParam(idx: number, patch: Partial<AiParam>) {
    setAiParams((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)),
    );
  }
  function addAiParam() {
    setAiParams((prev) => [
      ...prev,
      { key: "", type: "string", description: "", required: false },
    ]);
  }
  function removeAiParam(idx: number) {
    setAiParams((prev) => prev.filter((_, i) => i !== idx));
  }
  function insertVariable(token: string) {
    const idx = focusedIdx ?? fields.length - 1;
    if (idx < 0) {
      toast.message("Agrega un campo primero para insertar la variable");
      return;
    }
    setFields((prev) =>
      prev.map((f, i) =>
        i === idx ? { ...f, value: `${f.value}{{${token}}}` } : f,
      ),
    );
    // Micro-feedback: briefly flash the inserted chip.
    setFlashed(token);
    window.setTimeout(
      () => setFlashed((cur) => (cur === token ? null : cur)),
      180,
    );
  }

  async function save() {
    const parsed = webhookConfigSchema.safeParse({
      webhook_url: url,
      payload_fields: fields,
      ai_params: aiParams,
    });
    if (!parsed.success) {
      const flat = parsed.error.flatten();
      const message =
        flat.fieldErrors.ai_params?.[0] ??
        flat.fieldErrors.payload_fields?.[0] ??
        flat.fieldErrors.webhook_url?.[0] ??
        "Revisa la URL (HTTPS) y que cada campo tenga nombre válido";
      toast.error(message);
      return;
    }
    setSaving(true);
    try {
      await saveToolConfig(workspaceId, "custom_webhook", parsed.data);
      setBaseline(JSON.stringify(parsed.data));
      toast.success("Webhook guardado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* URL — grouped in a card with the request contract as a code block */}
      <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3">
        <Label htmlFor="wh-url" className="text-sm font-medium text-foreground">
          URL del webhook
        </Label>
        <div className="relative">
          <LinkIcon
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="wh-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://n8n.tu-dominio.com/webhook/abc123"
            type="url"
            className="pl-9"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          El agente hará POST a esta URL (solo HTTPS público) con:
        </p>
        <pre className="overflow-x-auto rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-muted-foreground">
          {`{ "workspace_id": "…", "payload": { … } }`}
        </pre>
      </div>

      {/* Payload fields */}
      <div className="space-y-2">
        <Label className="text-sm font-medium text-foreground">
          Payload{" "}
          <span className="font-normal text-xs text-muted-foreground">
            (campos con variables)
          </span>
        </Label>

        {fields.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Sin campos: se enviará un payload por defecto (nombre, teléfono,
            último mensaje y nota).
          </p>
        )}

        {fields.map((f, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <Input
              value={f.key}
              onChange={(e) => updateField(idx, { key: e.target.value })}
              placeholder="nombre_campo"
              className="h-8 w-1/3 font-mono text-sm"
              aria-label={`Nombre del campo ${idx + 1}`}
            />
            <span className="text-muted-foreground">:</span>
            <Input
              value={f.value}
              onChange={(e) => updateField(idx, { value: e.target.value })}
              onFocus={() => setFocusedIdx(idx)}
              placeholder="Hola {{contact.name}}"
              className="h-8 flex-1 text-sm"
              aria-label={`Valor del campo ${idx + 1}`}
            />
            <button
              type="button"
              onClick={() => removeField(idx)}
              className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-destructive"
              aria-label={`Eliminar campo ${idx + 1}`}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        ))}

        <Button type="button" variant="outline" size="sm" onClick={addField}>
          <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Agregar campo
        </Button>

        {/* Variable chips — grouped by category, styled as tokens */}
        <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Variables — clic para insertar en el campo enfocado
          </p>
          {WEBHOOK_VARIABLE_CATEGORIES.map((category) => (
            <div key={category} className="space-y-1.5">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                {category}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {WEBHOOK_VARIABLES.filter((v) => v.category === category).map(
                  (v) => (
                    <button
                      key={v.token}
                      type="button"
                      onClick={() => insertVariable(v.token)}
                      title={`${v.label} (ej. ${v.example})`}
                      className={cn(
                        "rounded border border-dashed border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-xs text-primary transition-all hover:border-primary hover:bg-primary/20",
                        flashed === v.token && "scale-105 ring-2 ring-primary",
                      )}
                    >
                      {`{{${v.token}}}`}
                    </button>
                  ),
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* AI-completed parameters */}
      <div className="space-y-2">
        <Label className="text-sm font-medium text-foreground">
          Parámetros IA{" "}
          <span className="font-normal text-xs text-muted-foreground">
            (la IA los completa)
          </span>
        </Label>
        <p className="text-xs text-muted-foreground">
          A diferencia de los campos de arriba, estos no se resuelven con un
          valor fijo de la conversación — el modelo decide qué poner acá según
          lo que dijo el cliente.
        </p>

        {aiParams.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Sin parámetros IA: el agente solo puede adjuntar una nota corta.
          </p>
        )}

        {aiParams.map((p, idx) => (
          <div
            key={idx}
            className="space-y-2 rounded-md border border-border p-3"
          >
            <div className="flex items-center gap-2">
              <Input
                value={p.key}
                onChange={(e) => updateAiParam(idx, { key: e.target.value })}
                placeholder="localidad"
                className="h-8 w-1/3 font-mono text-sm"
                aria-label={`Nombre del parámetro IA ${idx + 1}`}
              />
              <Select
                value={p.type}
                onValueChange={(v) =>
                  updateAiParam(idx, { type: v as AiParam["type"] })
                }
              >
                <SelectTrigger
                  className="h-8 w-28 text-sm"
                  aria-label={`Tipo del parámetro IA ${idx + 1}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(AI_PARAM_TYPE_LABELS) as AiParam["type"][]).map(
                    (t) => (
                      <SelectItem key={t} value={t}>
                        {AI_PARAM_TYPE_LABELS[t]}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Checkbox
                  checked={p.required}
                  onCheckedChange={(v) =>
                    updateAiParam(idx, { required: v === true })
                  }
                  aria-label={`Requerido: parámetro IA ${idx + 1}`}
                />
                Requerido
              </label>
              <button
                type="button"
                onClick={() => removeAiParam(idx)}
                className="ml-auto shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-destructive"
                aria-label={`Eliminar parámetro IA ${idx + 1}`}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
            <Textarea
              value={p.description}
              onChange={(e) =>
                updateAiParam(idx, { description: e.target.value })
              }
              placeholder="Qué debe completar el modelo acá, ej: la localidad o barrio donde vive el cliente"
              className="min-h-[52px] text-sm"
              aria-label={`Descripción del parámetro IA ${idx + 1}`}
            />
          </div>
        ))}

        <Button type="button" variant="outline" size="sm" onClick={addAiParam}>
          <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Agregar parámetro
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <Button
          size="sm"
          onClick={save}
          disabled={saving || !dirty}
          aria-busy={saving}
        >
          <Save className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {saving ? "Guardando…" : "Guardar webhook"}
        </Button>
        <DirtyHint dirty={dirty} />
      </div>
    </div>
  );
}

// ── Dispatcher ──────────────────────────────────────────────────────────────────

export function ToolConfigPanel({
  workspaceId,
  toolKey,
  initialConfig,
}: {
  workspaceId: string;
  toolKey: string;
  initialConfig: Record<string, unknown> | null;
}) {
  if (toolKey === "schedule_link") {
    return (
      <ScheduleLinkForm
        workspaceId={workspaceId}
        initialConfig={initialConfig}
      />
    );
  }
  if (toolKey === "custom_webhook") {
    return (
      <WebhookForm workspaceId={workspaceId} initialConfig={initialConfig} />
    );
  }
  return null;
}

/** Tool keys that expose a config panel. */
export const CONFIGURABLE_TOOLS = new Set(["schedule_link", "custom_webhook"]);
