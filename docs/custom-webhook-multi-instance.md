# Investigación: soportar múltiples `custom_webhook` por workspace

> Estado: solo investigación, ningún código fue modificado. Fecha: 2026-08-17.

Objetivo: que un workspace (ej. Valeria) pueda tener N webhooks personalizados
simultáneos (`calcular_envio`, `registrar_lead`, `notificar_humano`,
`enviar_fotos`), cada uno con su propia URL, nombre visible para la IA,
descripción y parámetros IA.

## 1. Modelo de datos hoy — estrictamente singular

- **Catálogo global** (`supabase/migrations/20260608000000_foundation.sql:399-406`):
  tabla `tools`, una fila con `key='custom_webhook'`, compartida entre todos
  los workspaces.
  ```sql
  CREATE TABLE IF NOT EXISTS tools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT UNIQUE NOT NULL,        -- 'custom_webhook' vive acá, una sola fila
    name TEXT NOT NULL,
    description TEXT,
    schema JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
  );
  ```
  Seed en `supabase/migrations/20260608000006_tools_sensitivity.sql:12-21`.

- **Config por workspace** (misma migración fundacional, líneas 411-421):
  tabla `tool_configs` con `UNIQUE (workspace_id, tool_id)`. Esta constraint
  es la raíz del problema: físicamente impide más de una config de
  `custom_webhook` por workspace.
  ```sql
  CREATE TABLE IF NOT EXISTS tool_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    tool_id UUID NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
    enabled BOOLEAN DEFAULT FALSE NOT NULL,
    credentials JSONB DEFAULT '{}'::jsonb NOT NULL,
    config JSONB DEFAULT '{}'::jsonb NOT NULL,
    ...
    UNIQUE (workspace_id, tool_id)   -- fuerza exactamente 1 fila por (workspace, tool)
  );
  ```

- **Shape del JSON `config`** (`src/features/tools/lib/tool-config.ts:139-144`):
  ```ts
  export const webhookConfigSchema = z.object({
    webhook_url: HTTPS_URL,                       // una sola URL, no array
    payload_fields: z.array(webhookFieldSchema).max(20).default([]),
    ai_params: z.array(aiParamSchema).max(20).default([]),
  });
  export type WebhookConfig = z.infer<typeof webhookConfigSchema>;
  ```
  `payload_fields` y `ai_params` sí son arrays, pero son sub-listas *dentro
  de* un único webhook (campos del payload / parámetros IA), no una lista de
  webhooks distintos.

- **Lectura en runtime** (`src/features/tools/tools/custom-webhook.ts:81-105`):
  usa `.eq("workspace_id", ...).eq("tool_id", ...).single()` — literalmente
  falla si hubiera más de una fila. Confirma en código la asunción singular.

## 2. UI — `tool-config-panel.tsx`

`src/features/settings/components/tool-config-panel.tsx`

- `WebhookForm` (líneas 142-466) renderiza **un solo formulario** por
  workspace:
  - `url` — state único (línea 157), input de texto (líneas 260-268), no hay
    selector de "cuál webhook".
  - `fields` (`payload_fields`) — array editable con botón "Agregar campo"
    (líneas 158, 180-185, 293-325): múltiples *campos*, no múltiples
    *webhooks*.
  - `aiParams` (`ai_params`) — array editable con botón "Agregar parámetro"
    (líneas 159, 192-200, 380-444): parámetros IA dinámicos, también dentro
    del mismo webhook único.
  - El guardado (líneas 220-246) llama
    `saveToolConfig(workspaceId, "custom_webhook", parsed.data)` — un solo
    PATCH con `toolKey: "custom_webhook"` fijo.
- El dispatcher (líneas 470-497) mapea `toolKey === "custom_webhook"` a un
  único `<WebhookForm/>`; `CONFIGURABLE_TOOLS` (línea 496) es un `Set` de
  *keys de tool*, no de instancias.
- `tools-catalog.tsx` (línea 145: `CONFIGURABLE_TOOLS.has(tool.key)`, línea
  219: `initialConfig={tool.config}`) itera sobre `tools`, cada uno con
  **un** `config` singular — no hay concepto de "lista de instancias" en
  ningún nivel de la UI.

## 3. Registro en el tool registry / tool-calling

- **`name` hardcodeado** como string literal
  (`src/features/tools/tools/custom-webhook.ts:159-167`):
  ```ts
  export const customWebhookTool: Tool<Args> = {
    name: "custom_webhook",   // literal fijo, no generado dinámicamente
    description:
      "Envía los datos del contacto a un webhook externo configurado por el negocio. Úsalo cuando debas notificar o registrar al contacto en un sistema externo.",
    sensitivity: "sensitive",
    schema,
    enabledFor: () => true,
    run,
  };
  ```
- **`description` es fija en código**, NO viene de la config del usuario: el
  usuario nunca escribe una descripción de "para qué sirve este webhook"
  que el modelo lea; solo configura URL/campos/params.
- **Registro estático** (`src/features/tools/index.ts:1-14`):
  `registry.register(customWebhookTool)` en tiempo de carga del módulo — una
  única instancia global, singleton tipo `Map<string, Tool>`
  (`src/features/tools/registry.ts:80,82-84`), indexado por `tool.name`.
- **Personalización por workspace ya existe, pero solo del *schema*, no del
  name/description** (`src/features/tools/services/tool-configs.ts:47-58`):
  ```ts
  return registry.list().filter((t) => enabledKeys.has(t.name)).map((t) => {
      if (t.name !== "custom_webhook") return t;
      const config = configByKey.get(t.name);
      const aiParams = ... config!.ai_params ...
      if (aiParams.length === 0) return t;
      return { ...t, schema: buildCustomWebhookSchema(aiParams) };  // clona el Tool, reemplaza solo `schema`
  });
  ```
  Esto demuestra el patrón para "personalizar por workspace": clonar el
  objeto `Tool` y sobreescribir campos — sería el mismo patrón a extender
  para múltiples instancias, pero hoy el filtro `t.name !== "custom_webhook"`
  asume que solo hay UNA entrada con ese nombre en `registry.list()`.
- **Handler que ejecuta el fetch**
  (`src/features/tools/tools/custom-webhook.ts:77-157`, función `run()`,
  `fetch(webhookUrl, ...)` en líneas 145-150). Se invoca vía
  `registry.run(name, args, ctx)`
  (`src/features/tools/registry.ts:90-153`), a su vez invocado por el AI SDK
  (`src/features/inbox/services/openrouter.ts:225-227` en
  `generateChatReply`, y líneas 308-314 en `generateWithTools`) — ahí es
  donde `tool({ description: forgeTool.description, inputSchema:
  zodSchema(forgeTool.schema), execute: ... })` arma el objeto de
  function-calling que ve el modelo, usando `aiTools[forgeTool.name] = ...`.
  Es decir, **el nombre de la key en el `ToolSet` del AI SDK es literalmente
  `forgeTool.name`** (`"custom_webhook"`).
- **No hay ninguna tool comparable que ya soporte múltiples instancias.** Se
  revisaron `echo.ts`, `schedule-link.ts`, `schedule-highlevel.ts`
  (`src/features/tools/tools/schedule-highlevel.ts:156-164`),
  `check-availability.ts` — todas siguen el mismo patrón: un objeto `Tool`
  estático con `name` literal, registrado una vez en `index.ts`, con a lo
  sumo un `tool_configs` row por workspace. No existe un concepto de
  "custom actions" o "flows" como lista en el código.

## 4. Lugares que asumen "un solo custom_webhook por workspace"

1. `supabase/migrations/20260608000000_foundation.sql:420` —
   `UNIQUE (workspace_id, tool_id)` en `tool_configs`. Restricción raíz: para
   soportar N instancias hay que romper esta unicidad o introducir una tabla
   nueva.
2. `src/app/api/tools/[workspaceId]/route.ts:162-171` — el `upsert` usa
   `onConflict: "workspace_id,tool_id"`, cada PATCH sobreescribe la única
   fila existente (no hay `instanceId`).
3. `src/features/tools/tools/custom-webhook.ts:87-93` —
   `.eq("tool_id", ...).single()` para leer la config: rompe si hay >1 fila.
4. `src/features/tools/services/tool-configs.ts:51` —
   `if (t.name !== "custom_webhook") return t;` asume una sola entrada de
   registro con ese `name` para inyectarle el schema dinámico.
5. `src/features/tools/lib/tool-config.ts:207-211` —
   `configSchemaForTool(toolKey)` mapea `toolKey → schema` 1:1, sin noción
   de instancia.
6. `src/features/settings/components/tool-config-panel.tsx:479-491`
   (dispatcher) y `:496` (`CONFIGURABLE_TOOLS` Set) — un panel por
   `toolKey`, no por instancia.
7. `src/features/settings/components/tools-catalog.tsx:33,142,219` —
   `ToolItem.config: Record<string, unknown> | null` singular.
8. `src/features/tools/registry.ts:80,82-84` — `Map<string, Tool>` indexado
   por `name`; registrar dos tools con el mismo `name` simplemente pisa la
   anterior (`this.tools.set(tool.name, tool)`).

## 5. Resumen

- **(a) Shape actual de datos:** estrictamente singular. Una fila de
  catálogo (`tools`, `key='custom_webhook'`) y, por workspace, como mucho
  una fila en `tool_configs` (constraint `UNIQUE(workspace_id, tool_id)`)
  cuyo `config` JSONB tiene forma
  `{ webhook_url: string, payload_fields: WebhookField[], ai_params: AiParam[] }`.
  Los arrays existentes son sub-listas de un único webhook, no una lista de
  webhooks.

- **(b) Cómo se registra la tool ante el modelo:** objeto `Tool` estático
  con `name: "custom_webhook"` hardcodeado y `description` fija en español
  (no configurable por el usuario), registrado una única vez en el
  `ToolRegistry` (singleton `Map` por `name`). Lo único personalizable por
  workspace es el `schema` (los `ai_params` se agregan como propiedades
  extra). El puente hacia el AI SDK usa `forgeTool.name` como key del
  `ToolSet`, así que el modelo siempre ve una tool llamada exactamente
  `custom_webhook`.

- **(c) Archivos a tocar para soportar N instancias con name/description
  dinámicos:**

  | Capa | Archivo | Cambio |
  |---|---|---|
  | DB | `supabase/migrations/...foundation.sql` | Nueva migración: romper `UNIQUE(workspace_id, tool_id)` o crear tabla `custom_webhooks` con `id`, `workspace_id`, `name`, `description`, `webhook_url`, `payload_fields`, `ai_params` |
  | Schema/tipos | `src/features/tools/lib/tool-config.ts` | Agregar `name`/`description` al schema, por instancia; `buildCustomWebhookSchema` (líneas 195-204) debe aceptarlos |
  | Registry | `src/features/tools/registry.ts` | Pasar de `Map` por `name` estático a generación dinámica de `Tool` por workspace (`custom_webhook_<id>` como name) |
  | Resolución config | `src/features/tools/services/tool-configs.ts:47-58` | Expandir: por cada fila de config generar un `Tool` propio en vez de mutar una única entrada |
  | Handler | `src/features/tools/tools/custom-webhook.ts` | `.single()` → búsqueda por instancia; factory `makeCustomWebhookTool(instanceConfig)` en vez de objeto estático |
  | API | `src/app/api/tools/[workspaceId]/route.ts` | PATCH/upsert con identificador de instancia; GET devuelve lista |
  | UI | `src/features/settings/components/tool-config-panel.tsx`, `tools-catalog.tsx` | Lista de formularios (uno por instancia) en vez de uno fijo |

## 6. Recomendación

Tabla nueva **`webhook_tools`** (en vez de forzar múltiples filas en
`tool_configs`, que tiene semántica 1:1 tool↔config en varios lugares del
código: RLS, tipos generados de Supabase, otras queries). Cada fila = una
instancia con su `name`, `description`, URL y params. `custom_webhook` en el
catálogo pasa a ser "el tipo de tool", y el registry genera N `Tool`
dinámicas por workspace a partir de esas filas, con `name` tipo
`webhook_<slug o id corto>` para que el modelo las distinga.

### Estimación de esfuerzo

2-3 días de un dev familiarizado con el repo:

- Migración + tipos: 0.5d
- Registry dinámico + `tool-configs` service: 1d
- API route: 0.5d
- UI (rehacer `WebhookForm` como lista con agregar/eliminar/reordenar): 1d
- Testing manual del tool-calling con 4 webhooks simultáneos: 0.5d

**Punto de mayor riesgo:** el registry hoy asume un `Tool` por `name`
global y cacheado a nivel módulo; pasar a resolución por-workspace-y-por-
request es el cambio más invasivo, más que el CRUD en sí.
