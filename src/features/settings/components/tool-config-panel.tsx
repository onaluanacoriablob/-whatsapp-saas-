"use client";

import { useEffect, useState } from "react";
import {
  Plus,
  Trash2,
  Save,
  Link as LinkIcon,
  Loader2,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
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
  webhookToolConfigSchema,
  type WebhookField,
  type AiParam,
} from "@/features/tools/lib/tool-config";

const AI_PARAM_TYPE_LABELS: Record<AiParam["type"], string> = {
  string: "Texto",
  number: "Número",
  boolean: "Sí/No",
};

// ── Shared save helper (schedule_link only — webhook instances use their own
// CRUD endpoint, /api/tools/[workspaceId]/webhooks) ─────────────────────────────

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

// ── webhook_tools (multi-instance) ────────────────────────────────────────────
// Reusable editors for the two field-list sections shared by every instance
// (lifted from the old single-webhook WebhookForm, unchanged behavior — just
// controlled by value/onChange so each instance card can own its own state).

function PayloadFieldsEditor({
  value,
  onChange,
}: {
  value: WebhookField[];
  onChange: (next: WebhookField[]) => void;
}) {
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);
  const [flashed, setFlashed] = useState<string | null>(null);

  function updateField(idx: number, patch: Partial<WebhookField>) {
    onChange(value.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  }
  function addField() {
    onChange([...value, { key: "", value: "" }]);
  }
  function removeField(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }
  function insertVariable(token: string) {
    const idx = focusedIdx ?? value.length - 1;
    if (idx < 0) {
      toast.message("Agrega un campo primero para insertar la variable");
      return;
    }
    onChange(
      value.map((f, i) =>
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

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium text-foreground">
        Payload{" "}
        <span className="font-normal text-xs text-muted-foreground">
          (campos con variables)
        </span>
      </Label>

      {value.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Sin campos: se enviará un payload por defecto (nombre, teléfono,
          último mensaje y nota).
        </p>
      )}

      {value.map((f, idx) => (
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
  );
}

function AiParamsEditor({
  value,
  onChange,
}: {
  value: AiParam[];
  onChange: (next: AiParam[]) => void;
}) {
  function updateAiParam(idx: number, patch: Partial<AiParam>) {
    onChange(value.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }
  function addAiParam() {
    onChange([
      ...value,
      { key: "", type: "string", description: "", required: false },
    ]);
  }
  function removeAiParam(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  return (
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

      {value.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Sin parámetros IA: el agente solo puede adjuntar una nota corta.
        </p>
      )}

      {value.map((p, idx) => (
        <div key={idx} className="space-y-2 rounded-md border border-border p-3">
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
            onChange={(e) => updateAiParam(idx, { description: e.target.value })}
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
  );
}

interface WebhookInstance {
  id: string;
  name: string;
  display_name: string;
  description: string;
  webhook_url: string;
  payload_fields: WebhookField[];
  ai_params: AiParam[];
  enabled: boolean;
}

/** Draft shape for a not-yet-created instance — same fields, no id yet. */
type WebhookInstanceDraft = Omit<WebhookInstance, "id">;

const BLANK_DRAFT: WebhookInstanceDraft = {
  name: "",
  display_name: "",
  description: "",
  webhook_url: "",
  payload_fields: [],
  ai_params: [],
  enabled: true,
};

function instanceSnapshot(v: WebhookInstanceDraft): string {
  return JSON.stringify(v);
}

/** Extracts the friendliest message out of a webhookToolConfigSchema error. */
function friendlyValidationError(fieldErrors: {
  [key: string]: string[] | undefined;
}): string {
  return (
    fieldErrors.name?.[0] ??
    fieldErrors.display_name?.[0] ??
    fieldErrors.description?.[0] ??
    fieldErrors.webhook_url?.[0] ??
    fieldErrors.ai_params?.[0] ??
    fieldErrors.payload_fields?.[0] ??
    "Revisá los campos — nombre en minúsculas/guion bajo, URL HTTPS y descripción obligatoria"
  );
}

/**
 * One webhook instance, editable in place. Used both for existing instances
 * (id set, PATCH/DELETE against the CRUD endpoint) and for composing a new
 * one (id null, POST on save, with a Cancel to discard the draft).
 */
function WebhookInstanceCard({
  workspaceId,
  instance,
  onCreated,
  onUpdated,
  onDeleted,
  onCancelDraft,
}: {
  workspaceId: string;
  instance: WebhookInstance | null;
  onCreated: (created: WebhookInstance) => void;
  onUpdated: (updated: WebhookInstance) => void;
  onDeleted: (id: string) => void;
  onCancelDraft?: () => void;
}) {
  const isDraft = instance === null;
  const initial: WebhookInstanceDraft = instance ?? BLANK_DRAFT;

  const [form, setForm] = useState<WebhookInstanceDraft>(initial);
  const [baseline, setBaseline] = useState(() => instanceSnapshot(initial));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const dirty = instanceSnapshot(form) !== baseline;

  function patch(fields: Partial<WebhookInstanceDraft>) {
    setForm((prev) => ({ ...prev, ...fields }));
  }

  async function save() {
    const parsed = webhookToolConfigSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(friendlyValidationError(parsed.error.flatten().fieldErrors));
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/tools/${workspaceId}/webhooks`, {
        method: isDraft ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isDraft ? parsed.data : { id: instance.id, ...parsed.data },
        ),
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: WebhookInstance;
        error?: unknown;
      };
      if (!res.ok) {
        throw new Error(
          typeof json.error === "string"
            ? json.error
            : "Error al guardar la tool",
        );
      }
      const saved = json.data as WebhookInstance;
      setBaseline(instanceSnapshot(saved));
      setForm(saved);
      if (isDraft) {
        toast.success(`Tool "${saved.name}" creada`);
        onCreated(saved);
      } else {
        toast.success(`Tool "${saved.name}" guardada`);
        onUpdated(saved);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (isDraft || !instance) return;
    if (
      !window.confirm(
        `¿Eliminar la tool "${instance.display_name || instance.name}"? El agente ya no va a poder llamarla. Esta acción no se puede deshacer.`,
      )
    ) {
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch(`/api/tools/${workspaceId}/webhooks`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: instance.id }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          error?: unknown;
        };
        throw new Error(
          typeof json.error === "string" ? json.error : "Error al eliminar",
        );
      }
      toast.success(`Tool "${instance.display_name || instance.name}" eliminada`);
      onDeleted(instance.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al eliminar");
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-muted/10 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-2">
          <div>
            <Label
              htmlFor={`wh-display-${instance?.id ?? "new"}`}
              className="text-sm font-medium text-foreground"
            >
              Nombre visible
            </Label>
            <Input
              id={`wh-display-${instance?.id ?? "new"}`}
              value={form.display_name}
              onChange={(e) => patch({ display_name: e.target.value })}
              placeholder="Calcular envío"
              className="mt-1"
            />
          </div>
          <div>
            <Label
              htmlFor={`wh-name-${instance?.id ?? "new"}`}
              className="text-sm font-medium text-foreground"
            >
              Nombre técnico
            </Label>
            <Input
              id={`wh-name-${instance?.id ?? "new"}`}
              value={form.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="calcular_envio"
              className="mt-1 font-mono text-sm"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Así identifica el modelo a esta tool internamente — minúsculas,
              números y guion bajo, sin espacios.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Switch
            checked={form.enabled}
            onCheckedChange={(v) => patch({ enabled: v })}
            aria-label={
              form.enabled ? "Desactivar esta tool" : "Activar esta tool"
            }
          />
          {!isDraft && (
            <button
              type="button"
              onClick={remove}
              disabled={deleting}
              className="rounded p-1 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
              aria-label="Eliminar tool"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label
          htmlFor={`wh-desc-${instance?.id ?? "new"}`}
          className="text-sm font-medium text-foreground"
        >
          Descripción
        </Label>
        <Textarea
          id={`wh-desc-${instance?.id ?? "new"}`}
          value={form.description}
          onChange={(e) => patch({ description: e.target.value })}
          placeholder="Calcula el costo de envío según la localidad del cliente y responde con el monto"
          className="min-h-[64px] text-sm"
        />
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Describí para qué sirve esta tool: el agente lee esto para decidir
          cuándo llamarla. Una descripción vaga hace que el modelo no sepa
          cuándo usarla o la confunda con otra.
        </p>
      </div>

      <div className="space-y-2 rounded-lg border border-border bg-background p-3">
        <Label
          htmlFor={`wh-url-${instance?.id ?? "new"}`}
          className="text-sm font-medium text-foreground"
        >
          URL del webhook
        </Label>
        <div className="relative">
          <LinkIcon
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id={`wh-url-${instance?.id ?? "new"}`}
            value={form.webhook_url}
            onChange={(e) => patch({ webhook_url: e.target.value })}
            placeholder="https://n8n.tu-dominio.com/webhook/abc123"
            type="url"
            className="pl-9"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          El agente hará POST a esta URL (solo HTTPS público) con:
        </p>
        <pre className="overflow-x-auto rounded-md border border-border bg-muted/20 px-3 py-2 font-mono text-xs text-muted-foreground">
          {`{ "workspace_id": "…", "payload": { … } }`}
        </pre>
      </div>

      <PayloadFieldsEditor
        value={form.payload_fields}
        onChange={(payload_fields) => patch({ payload_fields })}
      />

      <AiParamsEditor
        value={form.ai_params}
        onChange={(ai_params) => patch({ ai_params })}
      />

      <div className="flex items-center gap-3 border-t border-border/60 pt-3">
        <Button
          size="sm"
          onClick={save}
          disabled={saving || !dirty}
          aria-busy={saving}
        >
          <Save className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {saving ? "Guardando…" : isDraft ? "Crear tool" : "Guardar cambios"}
        </Button>
        {isDraft && onCancelDraft && (
          <Button size="sm" variant="ghost" onClick={onCancelDraft}>
            Cancelar
          </Button>
        )}
        <DirtyHint dirty={dirty} />
      </div>
    </div>
  );
}

/**
 * Lists every webhook_tools instance for the workspace and lets the admin
 * create/edit/delete them — the multi-instance replacement for the old
 * single-webhook WebhookForm (removed; it wrote to tool_configs, which
 * getEnabledTools() stopped reading back in Phase 2, so it silently had no
 * effect on what the model could call).
 */
function WebhookInstancesPanel({ workspaceId }: { workspaceId: string }) {
  const [instances, setInstances] = useState<WebhookInstance[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showDraft, setShowDraft] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/tools/${workspaceId}/webhooks`);
        const json = (await res.json().catch(() => ({}))) as {
          data?: WebhookInstance[];
          error?: unknown;
        };
        if (!res.ok) {
          throw new Error(
            typeof json.error === "string"
              ? json.error
              : "No se pudieron cargar las tools",
          );
        }
        if (!cancelled) setInstances(json.data ?? []);
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err instanceof Error ? err.message : "No se pudieron cargar las tools",
          );
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  if (loadError) {
    return <p className="text-sm text-destructive">{loadError}</p>;
  }

  if (instances === null) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Cargando tools…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Cada tool de acá aparece ante el modelo por separado, con su propio
        nombre y descripción — el agente elige cuál llamar según lo que
        necesite en cada momento. El interruptor de cada una la activa o
        desactiva individualmente.
      </p>

      {instances.length === 0 && !showDraft && (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          Todavía no hay ninguna tool de webhook configurada.
        </p>
      )}

      {instances.map((inst) => (
        <WebhookInstanceCard
          key={inst.id}
          workspaceId={workspaceId}
          instance={inst}
          onCreated={() => {}}
          onUpdated={(updated) =>
            setInstances((prev) =>
              (prev ?? []).map((i) => (i.id === updated.id ? updated : i)),
            )
          }
          onDeleted={(id) =>
            setInstances((prev) => (prev ?? []).filter((i) => i.id !== id))
          }
        />
      ))}

      {showDraft && (
        <WebhookInstanceCard
          workspaceId={workspaceId}
          instance={null}
          onCreated={(created) => {
            setInstances((prev) => [...(prev ?? []), created]);
            setShowDraft(false);
          }}
          onUpdated={() => {}}
          onDeleted={() => {}}
          onCancelDraft={() => setShowDraft(false)}
        />
      )}

      {!showDraft && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowDraft(true)}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          Agregar tool
        </Button>
      )}
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
    return <WebhookInstancesPanel workspaceId={workspaceId} />;
  }
  return null;
}

/** Tool keys that expose a config panel. */
export const CONFIGURABLE_TOOLS = new Set(["schedule_link", "custom_webhook"]);
