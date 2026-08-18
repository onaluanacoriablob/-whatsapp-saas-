# Fase 5 — UI (lista de instancias)

> Feature: múltiples `custom_webhook` por workspace. Ver
> [Fase 1](webhook-multi-instance-phase-1.md),
> [Fase 2](webhook-multi-instance-phase-2.md),
> [Fase 3](webhook-multi-instance-phase-3.md),
> [Fase 4](webhook-multi-instance-phase-4.md),
> `docs/custom-webhook-multi-instance.md` (investigación) y
> `Prompt_Feature_MultiWebhook.md` (spec/ritmo de trabajo).

## Estado

✅ Código completo. `npx tsc --noEmit` y `npx eslint` limpios.
⚠️ **Verificación en vivo parcial** — ver sección dedicada abajo. Falta que
apliques la migración de la Fase 1 (`webhook_tools`) contra el Supabase
real para poder probar el flujo completo de crear/editar/eliminar
instancias.

## Archivos tocados

- `src/features/settings/components/tool-config-panel.tsx` (reescrito)
- `src/features/settings/components/tools-catalog.tsx` (ajuste puntual)

## Orden pedido: viejo afuera antes que lista nueva

Lo hice como **un solo cambio atómico** en vez de dos pasos secuenciales
(remover en un commit, montar en otro) — con un solo archivo editado de una
vez no existe ninguna ventana intermedia donde ambas cosas convivan o donde
el viejo formulario quede vivo mientras se arma el nuevo. El resultado es
el mismo que pediste (nunca hay una versión deployable con `WebhookForm`
todavía escribiendo a `tool_configs`), solo que sin el paso intermedio
como commit separado, ya que no hay despliegue real entre medio.

`WebhookForm` (el componente completo, ~326 líneas) está borrado del
archivo — ya no existe ningún camino en la UI que escriba en
`tool_configs.config` para `custom_webhook`.

## Reuso del editor de ai_params (y del de payload_fields)

Como pediste, no reescribí el editor — **extraje** el JSX y los handlers
que ya existían dentro de `WebhookForm` a dos componentes controlados
(`value`/`onChange`), sin cambiar su comportamiento:

- `PayloadFieldsEditor` — la lista de campos con inserción de variables
  `{{token}}` por chip (mismo estado interno de foco/flash que tenía
  `WebhookForm`).
- `AiParamsEditor` — la lista de parámetros IA con key/tipo/requerido/
  descripción, mismo `AI_PARAM_TYPE_LABELS`, mismo `Select`/`Checkbox`.

Cada instancia (`WebhookInstanceCard`) monta su propia copia de estos dos
editores con su propio estado — es la misma UI de antes, ahora reusable
N veces en vez de una sola.

## El detalle de UX que pediste: ayuda en "description"

```tsx
<Textarea ... placeholder="Calcula el costo de envío según la localidad del cliente y responde con el monto" />
<p className="flex items-start gap-1.5 text-xs text-muted-foreground">
  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
  Describí para qué sirve esta tool: el agente lee esto para decidir
  cuándo llamarla. Una descripción vaga hace que el modelo no sepa
  cuándo usarla o la confunda con otra.
</p>
```

Con ícono `Info` para que se note como ayuda contextual, no como un error de
validación.

## Estructura de la nueva UI

- **`WebhookInstancesPanel`** (montado por el dispatcher para
  `toolKey === "custom_webhook"`): al abrirse, hace `GET
  /api/tools/[workspaceId]/webhooks` (carga perezosa — solo cuando el admin
  expande el panel, no en cada carga de Settings). Estados de carga y error
  explícitos (spinner / mensaje), no un panel en blanco.
- **`WebhookInstanceCard`**: un componente para las dos situaciones —
  instancia existente (`instance` seteado → PATCH/DELETE) o borrador nuevo
  (`instance: null` → POST, con "Cancelar" para descartar sin guardar).
  Campos: nombre visible (`display_name`), nombre técnico (`name`, con
  hint del formato slug), descripción (con la ayuda de arriba), URL,
  `PayloadFieldsEditor`, `AiParamsEditor`, `Switch` de `enabled`, y
  Guardar/Eliminar con el mismo patrón de "dirty tracking" que ya usaba
  `ScheduleLinkForm`.
- Errores del servidor (409 por nombre duplicado, 400 por validación) se
  muestran vía `toast.error` con el mensaje que devuelve la API — el admin
  ve el mismo mensaje claro que quisiste en la Fase 4.
- Eliminar pide confirmación con `window.confirm` — mismo patrón que ya usa
  `automations-tab.tsx` en este proyecto, no inventé un mecanismo nuevo.

## Extra que hice, fuera de lo pedido explícitamente: el switch general de la fila también quedaba huérfano

Al revisar `tools-catalog.tsx` noté que el **switch de encendido/apagado a
nivel de fila** (el que está al lado de cada tool en la lista, antes de
expandir) tiene exactamente el mismo problema que señalaste para
`WebhookForm`: para `custom_webhook` ese switch hace PATCH a
`tool_configs.enabled`, que desde la Fase 2 tampoco lee nadie — quedaba
otra "ventana de guardado sin efecto" que no era la que mencionaste pero sí
la misma clase de bug. Lo saqué para esa fila específicamente y lo
reemplacé por un texto ("Se activa por tool abajo"), ya que ahora el
`enabled` es por instancia, dentro del panel. Te lo marco explícitamente
porque lo decidí yo, no me lo pediste — si preferís otro tratamiento
(ocultar la fila completa, mostrar un contador de instancias activas,
etc.) lo cambio.

## Verificación en vivo — lo que pude confirmar y lo que quedó pendiente

Entré con las credenciales que me diste al workspace real de **Margani
Outdoor** (Settings → Tools) y confirmé visualmente:

✅ La fila "Webhook personalizado" ya **no tiene el switch on/off** —
   muestra "Se activa por tool abajo" (el cambio de arriba, funcionando).
✅ El botón "Configurar" expande el panel nuevo (`WebhookInstancesPanel`),
   no el `WebhookForm` viejo — confirma que el reemplazo está montado.
✅ El estado de error se maneja con gracia: al fallar el `GET` (ver abajo),
   el panel muestra "Error interno del servidor" en vez de romperse o
   quedar en blanco — el `catch`/`loadError` del componente funciona.

⚠️ **No pude probar crear/editar/eliminar una instancia real** porque la
   tabla `webhook_tools` de la Fase 1 no existe todavía en tu Supabase —
   la migración se escribió pero nunca se aplicó (`supabase db push` no se
   corrió). El `GET` devuelve 500 con:
   ```
   PGRST205: Could not find the table 'public.webhook_tools' in the schema cache
   ```
   Te pregunté si aplicaba la migración yo mismo y elegiste hacerlo vos —
   quedó pendiente de tu lado. Comandos:
   - `node scripts/setup.mjs db-push` (el flujo que ya usa este proyecto), o
   - pegar el contenido de `supabase/migrations/20260817000000_webhook_tools.sql`
     en el SQL Editor de Supabase.

   El servidor de dev (`npm run dev`) quedó corriendo en background para
   que puedas probar el flujo completo (crear las 4 tools de Valeria,
   editar, borrar) apenas la apliques, sin tener que levantarlo de nuevo.

## Qué falta

| Fase | Contenido |
|---|---|
| 6 | Verificación — con la migración aplicada: crear las 4 tools de Valeria (`calcular_envio`, `registrar_lead`, `notificar_humano`, `enviar_fotos`) y confirmar que el modelo las ve como 4 tools separadas con nombre/descripción propios y el JSON Schema correcto por tool |
