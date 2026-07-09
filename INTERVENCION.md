# Intervención de Naty (handoff humano) — cómo funciona

> Implementado 2026-07-09. Permite que Naty tome una conversación y Clara se calle
> SOLO en esa conversación, en Instagram y WhatsApp.

## Cómo interviene Naty

1. **Instagram (app)**: responde normal desde la app de Instagram. El webhook recibe el
   echo, el workflow de n8n detecta que el `mid` no fue enviado por Clara → llama a
   `POST /intervention` → la conversación queda `status='naty'` con pausa de 48h.
2. **Panel web** (`elcaminoconnaty.com/panel-clara/`): "Tomar control" pausa; el campo de
   texto ahora envía DE VERDAD por la API de Meta vía `POST /send` del cerebro (antes solo
   guardaba en la base y el cliente nunca recibía nada).
3. **WhatsApp**: solo por el panel (el número vive en la Cloud API; no hay echoes de
   mensajes manuales). Requiere `WA_ACCESS_TOKEN` en Railway (pendiente).

## Cómo se reactiva Clara

- **Automático**: 48h después del último mensaje manual de Naty (`paused_until`, se
  renueva con cada mensaje suyo). `PAUSE_HOURS` en server.js.
- **Frase**: Naty escribe algo que contenga "te responde Clara" en el chat (IG app o panel).
- **Panel**: botón "Devolver a Clara".

## Piezas

| Pieza | Qué hace |
|---|---|
| `server.js /intervention` | Pausa/reanuda + siembra mensaje + alerta Telegram. Header `x-intervention-secret`. |
| `server.js /send` | Envío real IG/WA desde el panel + registro con `external_message_id` + pausa 48h. CORS solo para elcaminoconnaty.com. |
| `server.js isPaused()` | Pausada si `status IN ('naty','paused')`; auto-reanuda si `paused_until` venció; `paused_until NULL` = indefinida (botón "Pausar" del panel). |
| `/chat` en pausa | Guarda el mensaje del cliente (para que Naty lo vea en el panel) y responde `skip_reason:'paused'`. |
| Workflow IG (`JVKit1RQ4fwaUKwc`) | Rama echo: espera 8s → busca el `mid`/contenido en `messages` (Postgres) → conocido: ignora; desconocido: `/intervention`. Guarda `external_message_id` de cada envío de Clara. No alerta cuando hay `skip_reason`. |
| Workflow Remarketing (`AZAZ1Opzn0ntCmua`) | Guarda `external_message_id` del envío IG (para que sus echoes no parezcan de Naty) y manda el secret a `/remarketing`. |
| Workflow WA (`XuOuodKtWoW03RBL`) | No alerta a Telegram cuando hay `skip_reason`. |
| Panel (página WP 1338, widget Elementor) | `sendMsg()` → `/send`; "Tomar control" fija `paused_until` +48h. Script embebido en base64; copia legible en `n8n-backups/panel-clara-nuevo.js`. |
| Supabase | `conversations.paused_until timestamptz` (nueva), `messages.external_message_id`. |

## Claves y variables (Railway, servicio clara-bot)

`INTERVENTION_SECRET` (mismo valor hardcodeado en los nodos n8n y en el script del panel),
`IG_ACCESS_TOKEN`, `WA_PHONE_NUMBER_ID=1045960141936016`, `PANEL_ORIGIN`,
`WA_ACCESS_TOKEN` (**pendiente** — sin él, responder por WhatsApp desde el panel da error claro).

## Notas / historia

- La frase "hola te habla naty" del intento anterior nunca funcionó porque los mensajes de
  Naty llegan como echo y el workflow los botaba antes de llegar a `/chat`. Los regex siguen
  en `/chat` como fallback inofensivo.
- El echo de IG **no trae `app_id`** (verificado con payloads reales): la única forma de
  distinguir Clara vs. Naty es correlacionar el `mid`.
- 2026-07-09: la credencial n8n "Instagram Clara Token" tenía token vencido (el remarketing
  IG fallaba en silencio); se actualizó con el token vigente.
- Backups pre-cambio: `n8n-backups/` (gitignored, contiene claves).
- 4 conversaciones pausadas desde mayo (mecanismo viejo) fueron devueltas a Clara el 2026-07-09.

## Rollback

- Workflow IG: importar `n8n-backups/instagram-bot-clara-pre-echo.json` o restaurar versión
  anterior desde el historial de n8n. Ojo: esa versión usa el token hardcodeado.
- server.js: revertir commit `feat: intervención de Naty por conversación`.
- Panel: script original en `n8n-backups/panel-clara-original.js`.
