# Fase 1 — DB + tipos

> Feature: múltiples `custom_webhook` por workspace. Ver
> `docs/custom-webhook-multi-instance.md` (investigación) y
> `Prompt_Feature_MultiWebhook.md` (spec/ritmo de trabajo).

## Estado

✅ Completa. Type-check limpio (`npx tsc --noEmit`, sin errores). Cambio
puramente aditivo — no toca `tool_configs` ni ningún código de runtime, el
flujo actual de un solo `custom_webhook` sigue funcionando sin cambios.

## Archivos tocados

- `supabase/migrations/20260817000000_webhook_tools.sql` (nuevo)
- `src/features/tools/lib/tool-config.ts` (modificado)

## Qué se hizo

### Migración `webhook_tools`

Tabla nueva, una fila = una instancia de webhook:

```sql
CREATE TABLE IF NOT EXISTS webhook_tools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (name ~ '^[a-z0-9_]+$' AND length(name) BETWEEN 1 AND 64),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 500),
  webhook_url TEXT NOT NULL,
  payload_fields JSONB DEFAULT '[]'::jsonb NOT NULL,
  ai_params JSONB DEFAULT '[]'::jsonb NOT NULL,
  enabled BOOLEAN DEFAULT TRUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE (workspace_id, name)
);
```

- `UNIQUE(workspace_id, name)` reemplaza al `UNIQUE(workspace_id, tool_id)`
  de `tool_configs` — la unicidad ahora es por nombre de instancia, no por
  tipo de tool. Es la restricción que permite N filas por workspace.
- `name` es el slug que va a ver el modelo como nombre de la tool (ej.
  `calcular_envio`) — mismo charset que las keys de `ai_params`/
  `payload_fields` (`^[a-z0-9_]+$`).
- RLS calcada del patrón admin/manager que ya usa `tool_configs`
  (`webhook_tools_select_admins` / `webhook_tools_write_admins`).
- Trigger `updated_at` reusando la función `update_updated_at()` existente.

### Migración de datos

Si un workspace ya tenía un `custom_webhook` configurado (con `webhook_url`
no vacío), se copia a una fila nueva en `webhook_tools` con
`name='custom_webhook'` (slug válido, sigue siendo invocable), sin perder
`ai_params` ni `payload_fields`. La fila vieja en `tool_configs` queda
intacta (no se borra) — el cambio es reversible.

⚠️ **Pendiente para vos:** la fila migrada del workspace de Margani va a
quedar nombrada `custom_webhook`, no `calcular_envio` — no hay forma de
inferir el nombre semántico correcto desde SQL. Cuando la Fase 5 (UI) esté
lista, van a tener que renombrarla a mano a `calcular_envio`.

### Tipos Zod (`tool-config.ts`)

- `checkFieldKeyCollisions`: extraje la validación de colisión de keys
  (`payload_fields` vs `ai_params` vs el campo `note` reservado) a un helper
  compartido, reusado tanto por el schema viejo (`webhookConfigSchema`)
  como por el nuevo — evita tener la misma lógica de validación duplicada.
- `RESERVED_TOOL_NAMES`: set con los nombres ya usados por tools estáticas
  (`echo`, `schedule_link`, `schedule_highlevel`, `check_availability`) —
  para que no se pueda nombrar una instancia de webhook igual a otra tool
  del sistema (rompería el tool-calling: dos tools, mismo nombre).
- `webhookToolNameSchema`: slug + rechaza los nombres reservados.
- `webhookToolConfigSchema` / `WebhookToolConfig`: shape completo de una
  instancia — `name`, `display_name`, `description`, `webhook_url`,
  `payload_fields`, `ai_params`, `enabled`.
- El schema viejo (`webhookConfigSchema`) queda intacto — todavía en uso
  por el código no migrado (UI y handler actuales, hasta las próximas
  fases).

## Qué falta (próximas fases)

| Fase | Contenido |
|---|---|
| 2 | Registry dinámico — `getEnabledTools()` genera un `Tool` por fila de `webhook_tools`; resolver que `registry.run` deje de depender de un `Map` global por `name` estático |
| 3 | Handler — `custom-webhook.ts` de objeto estático a factory `makeWebhookTool(instanceConfig)` |
| 4 | API route — CRUD de instancias (GET lista, POST crea, PATCH edita, DELETE borra) con validación de unicidad de `name` |
| 5 | UI — `tool-config-panel.tsx` de un formulario fijo a lista de instancias |
| 6 | Verificación — simular el workspace de Valeria con las 4 tools y confirmar que el modelo las ve por separado |

## Nota de arquitectura para la Fase 2

Los dos únicos call-sites de `registry.run(forgeTool.name, args, ctx)`
(`openrouter.ts:226` y `:312`) ya tienen el objeto `Tool` completo en scope
(`forgeTool`), no solo el nombre — así que se puede evitar el lookup por
`Map` global por completo para las tools dinámicas, pasando el objeto
resuelto directamente en vez de re-buscarlo por nombre. Menos riesgoso de
lo que parecía en la investigación inicial.
