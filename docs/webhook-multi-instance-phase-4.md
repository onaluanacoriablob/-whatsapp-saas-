# Fase 4 — API route (CRUD de webhook_tools)

> Feature: múltiples `custom_webhook` por workspace. Ver
> [Fase 1](webhook-multi-instance-phase-1.md),
> [Fase 2](webhook-multi-instance-phase-2.md),
> [Fase 3](webhook-multi-instance-phase-3.md),
> `docs/custom-webhook-multi-instance.md` (investigación) y
> `Prompt_Feature_MultiWebhook.md` (spec/ritmo de trabajo).

## Estado

✅ Completa. `npx tsc --noEmit` y `npx eslint` limpios. Encontré y corregí un
bug real de fusión de PATCH antes de cerrar la fase (ver más abajo) —
verificado con un repro de Zod, no solo revisado a ojo.

## Archivos tocados

- `src/app/api/tools/[workspaceId]/webhooks/route.ts` (nuevo)
- `src/features/tools/lib/tool-config.ts` (split de `webhookToolConfigSchema`
  en shape base + refinamiento, para poder derivar un `.partial()`)

## Qué se hizo

Endpoint nuevo `GET/POST/PATCH/DELETE /api/tools/[workspaceId]/webhooks`,
mismo patrón que el resto de la API (`requireWorkspaceMember` +
`readJsonBody`, visto en `workspace/[id]/team/route.ts`). `GET` es de
cualquier miembro activo; `POST`/`PATCH`/`DELETE` requieren `minRole:
"manager"`, igual que el resto de mutaciones de configuración.

- **GET**: lista todas las instancias del workspace (activas o no — el admin
  necesita verlas todas para gestionarlas, igual que `team` devuelve
  miembros inactivos).
- **POST**: crea una instancia, valida con `webhookToolConfigSchema` completo.
- **PATCH**: edita por `id` en el body (no en la URL, seguí el patrón de
  `team`/`templates`/`automations`). Fusiona parcial contra la fila actual y
  re-valida el objeto completo.
- **DELETE**: borra por `id` en el body.

## 1. Validación de unicidad de `name` (lo que pediste explícito)

Dos capas, en **POST y PATCH**:

1. **Zod, al parsear el body**: `webhookToolConfigSchema` ya trae
   `webhookToolNameSchema` (Fase 1) — rechaza nombres que colisionen con
   `RESERVED_TOOL_NAMES` (`echo`, `schedule_link`, `schedule_highlevel`,
   `check_availability`) antes de tocar la DB. Error 400, con el mensaje de
   Zod.
2. **Pre-check + mapeo del error de Postgres** — el error claro que pediste,
   "no en runtime":
   ```ts
   const { data: existing } = await supabase
     .from("webhook_tools")
     .select("id")
     .eq("workspace_id", workspaceId)
     .eq("name", parsed.data.name)
     .maybeSingle();
   if (existing) return nameClashError(parsed.data.name); // 409
   ```
   Esto le da al admin un 409 con mensaje legible (`Ya existe una tool
   llamada "X" en este workspace — elegí otro nombre`) en el momento de
   guardar. La constraint `UNIQUE(workspace_id, name)` de la Fase 1 sigue
   siendo la garantía real bajo carrera (dos requests simultáneos); si el
   pre-check no la agarra, el `insert`/`update` falla con Postgres
   `23505`, que el código mapea al mismo 409 en vez de dejarlo salir como
   500 genérico.

   En **PATCH** el mismo check corre solo si `name` efectivamente cambió
   (`parsed.data.name !== current.name`), excluyendo la propia fila
   (`.neq("id", id)`) para no auto-bloquearse al guardar sin cambiar el
   nombre.

## 2. DELETE seguro (lo otro que pediste explícito)

```ts
const { data, error } = await supabase
  .from("webhook_tools")
  .delete()
  .eq("id", parsed.data.id)
  .eq("workspace_id", workspaceId)   // ← doble filtro: no alcanza otra fila
  .select("id")
  .maybeSingle();

if (!data) return 404;  // confirma que SÍ había una fila, no un no-op silencioso
```

- **No afecta a otras instancias**: el doble filtro `id` + `workspace_id`
  hace que el `DELETE` solo pueda matchear como máximo una fila — ni otra
  instancia del mismo workspace, ni (por el filtro de `workspace_id`) una
  fila de otro workspace vía IDOR.
- **No deja registros colgados**: `webhook_tools` no tiene ninguna tabla
  hija con FK hacia su `id` (a diferencia de, por ejemplo, `kb_documents` →
  `kb_chunks`, que si necesita `ON DELETE CASCADE`) — no hay nada que
  pueda quedar huérfano.
- Agregué `.select("id")` sobre el delete para confirmar que realmente
  borró una fila (devuelve 404 si el `id` no existe o pertenece a otro
  workspace) en vez de responder `200 ok` silenciosamente ante un no-op —
  distinto del patrón que ya existe en `templates`/`automations`/`kb`
  (que no verifican esto), pero me pareció justificado dado que pediste
  explícitamente "seguro" para el DELETE de esta feature en particular.

## Bug encontrado y corregido antes de cerrar la fase

Al armar el PATCH con `webhookToolConfigObjectSchema.partial()`, verifiqué
empíricamente (no asumí) cómo Zod resuelve campos con `.default(...)`
dentro de un `.partial()`. Resultado: **los defaults se rellenan igual
aunque el campo esté ausente del body** — no quedan `undefined`.

```js
// repro real, con el shape exacto del endpoint:
PatchBodySchema.parse({ id: 'x', description: 'new desc' })
// → { id:'x', description:'new desc', enabled: true, payload_fields: [], ai_params: [] }
```

Un PATCH que solo mandara `{ description: "..." }` iba a **reactivar** una
instancia que el admin había apagado (`enabled: false → true`) y **vaciar**
`payload_fields`/`ai_params` — silenciosamente, sin que el campo estuviera
en el request. Lo arreglé filtrando el `patch` a solo las keys que
realmente vinieron en el body crudo (`key in rawBody`) antes de fusionar
contra la fila actual, y volví a confirmar con el mismo repro que
`enabled:false` y los arrays sobreviven un PATCH parcial:

```js
merged.enabled === false           // true — se preservó
merged.payload_fields = ['a']      // true — se preservó
```

## Loose end de la Fase 3, anotado para la Fase 5

Recordatorio (no lo toco en esta fase, es explícitamente el primer paso que
pediste para la Fase 5): `WebhookForm` en `tool-config-panel.tsx` sigue
montado y sigue escribiendo en `tool_configs` sin ningún efecto real desde
la Fase 2. **Primer paso de la Fase 5: sacar/deshabilitar ese formulario
viejo ANTES de montar la lista nueva de instancias**, para que no quede
ninguna ventana donde un admin guarde ahí pensando que hace algo.

## Qué falta (próximas fases)

| Fase | Contenido |
|---|---|
| 5 | UI — quitar `WebhookForm` viejo primero, después montar la lista de instancias (agregar/editar/eliminar) sobre este endpoint |
| 6 | Verificación — simular el workspace de Valeria con las 4 tools y confirmar que el modelo las ve por separado |
