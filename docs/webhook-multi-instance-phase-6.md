# Fase 6 — Verificación (las 4 tools de Valeria)

> Feature: múltiples `custom_webhook` por workspace. Ver
> [Fase 1](webhook-multi-instance-phase-1.md),
> [Fase 2](webhook-multi-instance-phase-2.md),
> [Fase 3](webhook-multi-instance-phase-3.md),
> [Fase 4](webhook-multi-instance-phase-4.md),
> [Fase 5](webhook-multi-instance-phase-5.md).

## Estado

✅ Completa. Las 4 tools de Valeria (workspace Margani Outdoor, real) están
creadas en producción vía la UI de la Fase 5, contra el endpoint de la
Fase 4, sobre la tabla de la Fase 1. El modelo las ve como 4 tools
separadas con nombre, descripción y JSON Schema propios.

## Qué se hizo

1. **`calcular_envio`**: no se creó de cero — la fila migrada por la Fase 1
   (nombrada `custom_webhook`, con la URL y los 2 `ai_params` ya correctos
   porque era el webhook real de Margani antes de esta feature) se
   **renombró** vía el panel: `display_name`, `name` (slug) y
   `description` actualizados a los valores de `calcular_envio`. Los
   `ai_params` (`localidad` requerido, `codigo_postal` opcional) ya
   coincidían exactamente con lo que pediste — no hizo falta tocarlos.
2. **`registrar_lead`**, **`notificar_humano`**, **`enviar_fotos`**:
   creadas desde cero con "Agregar tool", con sus URLs y `ai_params`
   completos (11, 3 y 2 respectivamente).

Todo hecho en vivo contra el workspace real de Margani Outdoor (con las
credenciales que me diste), usando la UI que construimos en la Fase 5 —
no una simulación ni un insert directo a la base.

### Detalle menor: dos correcciones mías sobre lo que tipeaste

- Typo propio al transcribir: escribí "almohón" en vez de "almohadón" en
  la descripción de `color_tela` de `registrar_lead` — lo corregí antes de
  guardar.
- Contaste 10 `ai_params` para `registrar_lead` pero tu lista tenía 11
  (faltaba `notas` en el conteo, no en el detalle) — los cargué los 11.

## Verificación 1: las 4 quedaron guardadas correctamente

`GET /api/tools/{workspaceId}/webhooks` contra el workspace real:

| name | display_name | url | ai_params | enabled |
|---|---|---|---|---|
| `calcular_envio` | Calcular envío | `.../webhook/calcular-envio` | localidad*, codigo_postal | ✅ |
| `registrar_lead` | Registrar lead | `.../webhook/registrar-lead` | nombre_completo*, zona*, set_interes*, color_tela, color_estructura, dni, codigo_postal, direccion, metodo_pago, estado_lead*, notas | ✅ |
| `notificar_humano` | Notificar a un humano | `.../webhook/notificar-humano` | motivo*, resumen*, prioridad* | ✅ |
| `enviar_fotos` | Enviar fotos | `.../webhook/enviar-fotos` | color_tela*, color_estructura | ✅ |

(`*` = requerido)

4 nombres distintos, sin colisión entre sí ni con las tools estáticas
(`echo`, `schedule_link`, `schedule_highlevel`, `check_availability`) — la
guarda de la Fase 2 (`getEnabledTools`) y la validación de la Fase 4
(`RESERVED_TOOL_NAMES` + `UNIQUE(workspace_id, name)`) nunca se activaron
porque no hubo ningún choque, tal como corresponde.

## Verificación 2: el JSON Schema por tool (lo que pediste confirmar)

En vez de inferirlo o simularlo, **reproduje `buildCustomWebhookSchema()`
(`tool-config.ts`) tal cual** en un script Node standalone, alimentado con
los `ai_params` reales devueltos por la API (no lo que tipeé — el dato ya
validado y persistido), y lo convertí con `z.toJSONSchema()` (zod v4, la
misma versión del proyecto). Este es exactamente el schema que
`zodSchema(tool.schema)` en `openrouter.ts` termina mandándole al modelo.

**`calcular_envio`**
```json
{
  "type": "object",
  "properties": {
    "note": { "type": "string", "maxLength": 500, "description": "Nota corta opcional para incluir en el webhook ({{note}})" },
    "localidad": { "type": "string", "description": "Localidad o ciudad donde vive el cliente..." },
    "codigo_postal": { "type": "string", "description": "Código postal del cliente, solo si lo mencionó. No inventarlo." }
  },
  "required": ["localidad"],
  "additionalProperties": false
}
```

**`registrar_lead`** — 11 propiedades + `note`, 4 requeridas:
```json
{
  "required": ["nombre_completo", "zona", "set_interes", "estado_lead"],
  "additionalProperties": false
  // + color_tela, color_estructura, dni, codigo_postal, direccion, metodo_pago, notas (opcionales)
}
```

**`notificar_humano`** — 3 propiedades + `note`, las 3 requeridas:
```json
{
  "required": ["motivo", "resumen", "prioridad"],
  "additionalProperties": false
}
```

**`enviar_fotos`** — 2 propiedades + `note`, 1 requerida:
```json
{
  "required": ["color_tela"],
  "additionalProperties": false
}
```

(JSON completo de las 4 corrido en la sesión — recortado acá por espacio,
te lo repito entero en el chat si lo necesitás para pegar en otro lado.)

Cada schema tiene exactamente los campos de esa tool y ninguno de las
otras 3 — confirma de punta a punta que el objetivo original de la
feature ("Valeria con 4 tools distintas simultáneamente, cada una con su
propio nombre, descripción y parámetros IA") funciona en el workspace
real.

## Nota sobre alcance de esta verificación

Confirmé identidad (name/description) y forma (JSON Schema) de las 4
tools tal como el modelo las recibiría — es lo que pediste. Lo que **no**
se probó en esta fase es una llamada real del modelo disparando el
`fetch` a Railway (eso requeriría una conversación real vía WhatsApp o el
test-chat de un agente, y consumiría la API key de OpenRouter del
workspace) — si querés ese último tramo end-to-end, decime y lo armamos
como un paso aparte.
