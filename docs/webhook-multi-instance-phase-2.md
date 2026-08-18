# Fase 2 — Registry dinámico + resolución de config

> Feature: múltiples `custom_webhook` por workspace. Ver
> [Fase 1](webhook-multi-instance-phase-1.md),
> `docs/custom-webhook-multi-instance.md` (investigación) y
> `Prompt_Feature_MultiWebhook.md` (spec/ritmo de trabajo).

## Estado

✅ Completa. `npx tsc --noEmit` y `npx eslint` limpios en los 5 archivos
tocados.

## Archivos tocados

- `src/features/tools/registry.ts`
- `src/features/inbox/services/openrouter.ts`
- `src/features/tools/tools/custom-webhook.ts`
- `src/features/tools/services/tool-configs.ts`

## El problema que resolvía esta fase

`registry.run(name, args, ctx)` resolvía la tool a ejecutar buscándola por
`name` en un `Map<string, Tool>` **global y estático**, poblado una sola vez
en `index.ts` con `registry.register(...)`. Las tools dinámicas
(`calcular_envio`, `registrar_lead`, etc., generadas por workspace desde
`webhook_tools`) nunca están en ese `Map` — no existen hasta que se arma la
lista por request. Si `registry.run` seguía buscando por nombre en el `Map`
global, cualquier llamada del modelo a una tool dinámica hubiera fallado con
`Tool "calcular_envio" not found`.

## Qué se hizo

### 1. `registry.ts` — `run()` ya no busca por nombre

Investigando los dos únicos call-sites de `registry.run` (ambos en
`openrouter.ts`) confirmé que **ya tienen el objeto `Tool` completo en
scope** (`forgeTool`, que viene de `getEnabledTools()`) antes de llamar a
`registry.run` — no hacía falta el nombre en absoluto, era redundante.

```diff
- async run(name: string, args, ctx, opts) {
-   const tool = this.tools.get(name);
-   if (!tool) return { ok: false, output: null, error: `Tool "${name}" not found` };
+ async run(tool: Tool, args, ctx, opts) {
+   const name = tool.name;
```

`registry.run` ahora ejecuta el objeto `Tool` que le pasan, sin volver a
resolverlo por nombre. Esto elimina la dependencia del `Map` global para
**ejecución** por completo — el `Map` sigue existiendo y sigue siendo la
fuente de verdad para `list()`/`get()`/`register()` (usado por
`getEnabledStaticTools`), pero ya no es parte del camino de ejecución.

`openrouter.ts` (los 2 call-sites, `generateChatReply` y
`generateWithTools`): cambian `registry.run(forgeTool.name, args, ctx)` →
`registry.run(forgeTool, args, ctx)`. Un `sed` de una palabra, sin más
lógica tocada.

### 2. `tool-configs.ts` — split en dos fuentes + merge con guarda de colisión

`getEnabledTools()` ahora combina dos listas independientes:

- **`getEnabledStaticTools(workspaceId)`**: exactamente la misma query y
  misma lógica de filtrado que existía antes (`tool_configs` join
  `tools(key)`, `enabled=true`, intersección con `registry.list()` por
  `name`) — con un único cambio: excluye explícitamente la key
  `custom_webhook` (`key === "custom_webhook"` → `continue`). Para
  `echo`, `schedule_link`, `schedule_highlevel`, `check_availability` el
  comportamiento es idéntico byte a byte al de antes — **checkpoint #1**.

- **`getEnabledWebhookInstanceTools(workspaceId)`**: query nueva a
  `webhook_tools` (`enabled=true`), un `Tool` por fila vía
  `buildWebhookInstanceTool` (ver más abajo).

- **Merge con guarda anti-colisión** (**checkpoint #2**): `getEnabledTools`
  arma `[...staticTools, ...webhookTools]` y va agregando a un `Set<string>`
  de nombres ya vistos; cualquier tool cuyo `name` ya esté en el set se
  descarta (con `console.warn`) en vez de agregarse. Los estáticos van
  primero, así que en un choque de nombres gana siempre la tool estática
  del sistema, nunca un webhook. Esto es defensa en profundidad: hoy nada
  más lo impide a nivel runtime, porque el endpoint CRUD de `webhook_tools`
  (que sí validará con `webhookToolNameSchema` + `RESERVED_TOOL_NAMES`
  contra los mismos nombres) todavía no existe — llega en la Fase 4. Hasta
  entonces, esta guarda en `getEnabledTools` es la única barrera contra que
  el modelo reciba dos tools con el mismo `name` (por ejemplo si alguien
  insertara una fila `webhook_tools` con `name='echo'` a mano en la DB). La
  restricción `UNIQUE(workspace_id, name)` de la tabla previene duplicados
  *entre filas de webhook_tools*, pero no colisiones contra los nombres de
  las tools estáticas — de ahí que la guarda en código siga haciendo falta
  igual después de la Fase 4.

### 3. `custom-webhook.ts` — factory `buildWebhookInstanceTool` + lógica de fetch compartida

Extraje el cuerpo del `run()` viejo (resolución de variables, armado de
payload, merge de `ai_params`, fetch) a una función pura
`runWebhookPayload(config, args, ctx)` que **no hace ningún lookup a DB** —
recibe el config ya resuelto. Tanto el `run()` viejo (que sigue haciendo el
lookup por `tool_id` en `tool_configs`) como la nueva factory la reusan:

```ts
export function buildWebhookInstanceTool(row: WebhookToolRow): Tool<Args> {
  return {
    name: row.name,
    description: row.description,
    sensitivity: "sensitive",
    schema: buildCustomWebhookSchema(row.ai_params),
    enabledFor: () => true,
    run: (args, ctx) =>
      runWebhookPayload(
        { webhook_url: row.webhook_url, payload_fields: row.payload_fields, ai_params: row.ai_params },
        args,
        ctx,
      ),
  };
}
```

Como el `run` de cada instancia cierra sobre `row` (ya lo trae
`getEnabledWebhookInstanceTools` de la query a `webhook_tools`), **no hay
forma de que una instancia ejecute contra la URL de otra** — no hay
re-lookup por `tool_id`/nombre en el momento de ejecutar, así que no hay
ventana para mezclar instancias.

## Verificación explícita de los dos checkpoints pedidos

**1. Tools estáticas se resuelven igual que antes.**
`getEnabledStaticTools` es la misma query + mismo filtro que el
`getEnabledTools` viejo, solo con una línea nueva (`key === "custom_webhook"
→ continue`). `schedule_highlevel`, `echo`, `schedule_link`,
`check_availability` no pasan por ningún código nuevo — mismo objeto `Tool`
de `registry.list()`, mismo camino de ejecución en `registry.run` (que
ahora recibe el objeto en vez de re-buscarlo, pero es el mismo objeto).

**2. Ningún camino produce dos tools con el mismo `name`.**
Guarda explícita en `getEnabledTools` (Set de nombres vistos, estáticos
primero) — cualquier colisión se descarta y se loguea, nunca llega al
`ToolSet` que arma `openrouter.ts`. Documentado en el comentario de la
función para que quede claro por qué sigue haciendo falta incluso después
de que la Fase 4 agregue validación en el POST/PATCH.

## Estado intencional al cierre de esta fase (no es una regresión)

- `customWebhookTool` (el objeto estático viejo en `custom-webhook.ts`)
  queda **sin usar** — sigue registrado en `index.ts` pero
  `getEnabledTools` ya no lo incluye nunca (se excluye explícitamente por
  key). Es código muerto pero inofensivo: nada lo puede alcanzar. Lo dejé
  así a propósito en vez de borrarlo ahora — es justamente el trabajo de
  limpieza que describe la Fase 3 ("de objeto estático a factory").
- La factory `buildWebhookInstanceTool` ya está completa y funcional (no es
  un stub) — hace el fetch real contra la URL de cada fila. La Fase 3, tal
  como la definiste, queda entonces enfocada en el cleanup: borrar
  `customWebhookTool`/`run()` viejo y consolidar el módulo alrededor de la
  factory, no en "hacer que funcione" (ya funciona).
- Ningún endpoint ni UI escribe todavía en `webhook_tools` (eso es Fase 4 y
  5) — por ahora la única forma de tener filas ahí es la migración de datos
  de la Fase 1.

## Qué falta (próximas fases)

| Fase | Contenido |
|---|---|
| 3 | Cleanup del handler — borrar `customWebhookTool`/`run()` viejo de `custom-webhook.ts`, dejar el módulo consolidado alrededor de `buildWebhookInstanceTool` |
| 4 | API route — CRUD de instancias (GET lista, POST crea, PATCH edita, DELETE borra) con `webhookToolConfigSchema` |
| 5 | UI — `tool-config-panel.tsx` de un formulario fijo a lista de instancias |
| 6 | Verificación — simular el workspace de Valeria con las 4 tools y confirmar que el modelo las ve por separado |
