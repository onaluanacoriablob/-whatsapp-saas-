# Fase 3 — Cleanup del handler

> Feature: múltiples `custom_webhook` por workspace. Ver
> [Fase 1](webhook-multi-instance-phase-1.md),
> [Fase 2](webhook-multi-instance-phase-2.md),
> `docs/custom-webhook-multi-instance.md` (investigación) y
> `Prompt_Feature_MultiWebhook.md` (spec/ritmo de trabajo).

## Estado

✅ Completa. `npx tsc --noEmit` limpio en todo el proyecto, `npx eslint`
limpio en los archivos tocados. Cero referencias colgantes a
`customWebhookTool` en `src/` (verificado con grep, ver más abajo).

## Archivos tocados

- `src/features/tools/tools/custom-webhook.ts`
- `src/features/tools/index.ts`

## Qué se hizo

Esta fase era puro cleanup — la Fase 2 ya había dejado
`buildWebhookInstanceTool` funcional de punta a punta; `customWebhookTool`
(el objeto estático viejo) y su `run()` (lookup por `tool_id` en
`tool_configs`, `.single()`) habían quedado registrados pero inalcanzables.

1. **`custom-webhook.ts`**: borrado el `run()` viejo completo (lookup a
   `tools`/`tool_configs` por key `custom_webhook`) y el export
   `customWebhookTool`. El módulo queda consolidado alrededor de:
   - `runWebhookPayload(config, args, ctx)` — la lógica de fetch/payload,
     sin cambios de comportamiento, solo ya no tiene un segundo llamador
     (el `run()` viejo) además de `buildWebhookInstanceTool`.
   - `buildWebhookInstanceTool(row)` — el único punto de construcción de
     tools de webhook ahora.
   - `type Args` pasó de derivarse de un `const schema = buildCustomWebhookSchema()`
     module-level (que solo existía para tipar el objeto estático borrado) a
     `z.infer<ReturnType<typeof buildCustomWebhookSchema>>` inline — ya no
     queda una constante `schema` sin usar dando vueltas.
   - Comentarios que hacían referencia a "legacy tool" / "Phase 3 remove
     this" actualizados para reflejar el estado final.

2. **`index.ts`**: borrado el import de `customWebhookTool` y su
   `registry.register(customWebhookTool)`. Agregado un comentario explicando
   por qué `custom_webhook` no se registra acá (a diferencia de las otras 4
   tools estáticas) — se arma dinámicamente por workspace en
   `getEnabledTools()`.

## Confirmación pedida: cero referencias colgantes

```
$ grep -rn "customWebhookTool" src/
(sin resultados)
```

Nada en `src/` — ni imports, ni el registro en `index.ts`, ni tipos — hace
referencia al objeto borrado. `npx tsc --noEmit` sobre todo el proyecto
confirma que no quedó ningún import roto.

## Loose end que encontré (no es un bug, pero avisa para la Fase 5)

Grep de `"custom_webhook"` (el string, no el objeto) todavía aparece en:

- `tool-config-panel.tsx` / `tools-catalog.tsx` — el formulario viejo
  (`WebhookForm`) sigue montado, sigue pudiendo guardar en
  `tool_configs.config` vía `PATCH /api/tools/:workspaceId` con
  `toolKey: "custom_webhook"`.
- `tool-config.ts` — `configSchemaForTool("custom_webhook")` sigue
  devolviendo el `webhookConfigSchema` viejo (singular).

Esto **no está roto** — el endpoint y el formulario siguen funcionando
exactamente como antes de esta feature — pero desde la Fase 2 quedaron
**huérfanos**: lo que ahí se guarda ya no lo lee ningún camino de
tool-calling (`getEnabledTools` ya no mira `tool_configs` para
`custom_webhook`). Un admin que hoy entre a Settings y edite el webhook
"de toda la vida" va a ver que se guarda sin error, pero no va a tener
ningún efecto sobre lo que el modelo puede llamar. La Fase 5 reemplaza este
formulario por la lista de instancias — hasta entonces, si hace falta,
convendría al menos ocultar el panel viejo del catálogo para no confundir
al usuario. Lo dejo señalado, no lo toqué (fuera del alcance de esta fase).

## Qué falta (próximas fases)

| Fase | Contenido |
|---|---|
| 4 | API route — CRUD de instancias (GET lista, POST crea, PATCH edita, DELETE borra) sobre `webhook_tools`, con `webhookToolConfigSchema` |
| 5 | UI — reemplazar `WebhookForm` (el formulario huérfano de arriba) por una lista de instancias |
| 6 | Verificación — simular el workspace de Valeria con las 4 tools y confirmar que el modelo las ve por separado |
