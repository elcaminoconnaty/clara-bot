# Errores conocidos — Bot Clara en N8N (Instagram)

Este archivo documenta todos los errores cometidos durante la migración del bot de ManyChat a N8N, con sus causas y soluciones. Leer ANTES de tocar cualquier nodo.

---

## ERROR 1 — Token con endpoint incorrecto
**Síntoma:** `Authorization failed - Invalid OAuth access token - Cannot parse access token`
**Causa:** El token IGAAN (`IGAANdb0vL...`) solo funciona con `graph.instagram.com`, NO con `graph.facebook.com`.
**Solución:** URL del nodo "Enviar Mensaje Instagram" debe ser:
```
https://graph.instagram.com/v21.0/me/messages
```
**Estado:** ✅ Corregido

---

## ERROR 2 — Campo de respuesta de Clara Bot incorrecto
**Síntoma:** El bot enviaba mensajes vacíos / `Bad request - text is blank`
**Causa:** El body del nodo "Enviar Mensaje Instagram" usaba `$json.response`, pero Clara Bot devuelve la respuesta en `content.messages[0].text`.
**Solución:** Body del nodo debe ser:
```javascript
{{ JSON.stringify({
  recipient: { id: $('Parsear Webhook').item.json.userId },
  message: { text: $json.content.messages[0].text }
}) }}
```
**Estado:** ✅ Corregido

---

## ERROR 3 — Loop infinito por mensajes echo del bot (FIX INCOMPLETO)
**Síntoma:** El bot respondía infinitamente a la cuenta `villa_posada_ph` con mensajes vacíos.
**Causa parcial identificada:** Instagram manda un webhook cuando el bot envía un mensaje (`is_echo: true`, y `sender.id === entry.id`). El fix aplicado chequeaba esto, pero era INSUFICIENTE.
**Causa real (raíz):** Instagram también manda webhooks para:
- **Delivery receipts** (confirmación de entrega): el `messaging` object tiene `delivery`, NO tiene `message`
- **Read receipts** (confirmación de lectura): el `messaging` object tiene `read`, NO tiene `message`
- **Reactions**: el `messaging` object tiene `reaction`, NO tiene `message`
- **Stickers / media sin texto**: tienen `message` pero sin `text`

En todos estos casos, `sender.id` existe (es el usuario o el bot), `message.text` es vacío, y el código anterior enviaba `[mensaje sin texto]` al usuario, lo que generaba más webhooks → loop infinito.

**Solución correcta (ver ERROR 3 FIX abajo):** Filtrar agresivamente al inicio del nodo "Parsear Webhook".
**Estado:** ✅ Corregido en v3

---

## ERROR 3 FIX — Código correcto para "Parsear Webhook"
```javascript
const item = $input.first().json;
const query = item.query;
if (query && query['hub.mode'] === 'subscribe') {
  return [{ json: { isVerification: true, challenge: query['hub.challenge'] } }];
}
const body = item.body;
const entry = body?.entry?.[0];
const messaging = entry?.messaging?.[0];

// Solo procesar si hay un objeto "message" real (excluye delivery, read, reaction, etc.)
const hasMessage = !!messaging?.message;
const senderId = messaging?.sender?.id || '';
const messageText = messaging?.message?.text || '';
const botId = entry?.id || '';
const isEcho = messaging?.message?.is_echo === true;
const isFromBot = senderId !== '' && senderId === botId;

// IGNORAR si: no hay message, no hay sender, es echo, sender es el bot, o no hay texto
if (!hasMessage || !senderId || isEcho || isFromBot || !messageText) {
  return [{ json: { isVerification: false, skip: true, userId: '', message: '' } }];
}

return [{ json: { isVerification: false, skip: false, userId: senderId, message: messageText } }];
```
**Diferencias clave vs versión anterior:**
1. ✅ `hasMessage` — solo procesa si existe el objeto `message` (filtra delivery/read/reaction)
2. ✅ `!messageText` — solo procesa si hay texto real (filtra stickers, media sin caption)
3. ✅ Eliminado el fallback `'[mensaje sin texto]'` — si no hay texto, se ignora
4. ✅ `isEcho` — filtra mensajes enviados por el propio bot
5. ✅ `isFromBot` — filtra si sender === bot account ID

---

## ERROR 4 — Edición del CodeMirror en N8N corrompe el código
**Síntoma:** Al usar Cmd+A + type en el editor de código de N8N, el texto se añade en vez de reemplazarse, corrompiendo el código.
**Causa:** N8N usa CodeMirror, que no responde bien a Cmd+A + type desde automatización de browser.
**Solución:** Usar la API REST de N8N para actualizar el código:
```
GET  /api/v1/workflows/{id}      → obtener workflow completo
PUT  /api/v1/workflows/{id}      → guardar cambios
POST /api/v1/workflows/{id}/activate  → publicar
```
Requiere header: `X-N8N-API-KEY: <key>`
La key se crea en Settings → n8n API → Create an API Key.
**IMPORTANTE:** En el PUT, el campo `settings` solo puede tener `executionOrder`. Quitar `binaryMode` y `availableInMCP` o da error 400.
**Estado:** ✅ Documentado

---

## ERROR 5 — Pausa falsa masiva: la credencial Postgres de n8n dejó de autenticar (2026-09-07 → 2026-09-11)

**Síntoma:** Clara respondía el PRIMER mensaje de cada lead nuevo de IG y después se quedaba muda. En el panel la conversación aparecía como "Naty intervino" (status `naty`, pausa 48h) con una fila `sent_by='naty'` idéntica a la respuesta de Clara. Alberto mandó 17 avisos de "🙋 Naty tomó la conversación" en 3 días que nadie cuestionó. Remarketing muerto en el mismo período (103 ejecuciones en error, una por hora).

**Causa raíz:** la credencial `Supabase Postgres BayMax` (`77LyzCQh9TZFg73d`) de n8n empezó a fallar con `password authentication failed for user "postgres"` el 2026-09-07 entre 21:00 y 22:00 UTC (última corrida buena de remarketing: 21:00; primera pausa falsa: 23:50). La usan DOS nodos:
- `Buscar Echo Conocido` (workflow IG) — tiene `onError: continueRegularOutput`, así que el error pasa como un item sin `known` → `Clasificar Echo` lo lee como `known=false` → **cada eco de la propia Clara se clasifica como intervención manual de Naty** → `/intervention` pausa 48h + inserta la fila fantasma.
- `Buscar Candidatos` (workflow Remarketing) — sin fallback: la ejecución muere y no sale ningún mensaje de reenganche.

**¿Y WhatsApp? La pausa falsa NO lo toca; el remarketing muerto SÍ, y más fuerte.** El workflow `Clara - WhatsApp` (`XuOuodKtWoW03RBL`) **no tiene ningún nodo Postgres** — todo Supabase va por HTTP Request con la llave REST — y **no tiene rama de ecos** (la Cloud API de WhatsApp no manda echoes; Naty solo interviene por el panel → `/send`, que registra el `mid` él mismo). Verificado el 2026-09-11: 0 filas fantasma `sent_by='naty'` en WA, 0 conversaciones pausadas, 0 pausas nuevas desde el 7-sep, 37 respuestas de Clara en 3 días y **ninguna conversación de WA con el último mensaje del cliente sin responder en 21 días**.
Pero el RPC de remarketing sirve a los dos canales, así que el cron muerto dejó sin mensaje de 24h a **15 leads de WhatsApp** (vs. 2 de Instagram) entre el 7 y el 10 de sep. **Esos 15 ya NO se recuperan con Clara**: pasaron entre 47 y 99 horas, o sea están fuera de la ventana de servicio de 24h de Meta y un mensaje libre sería rechazado (haría falta una plantilla aprobada). Es el daño irreversible del incidente, y es de WhatsApp, no de Instagram.

**Cómo se detecta rápido:**
```sql
-- filas "de Naty" que son copia exacta de una respuesta de Clara (±2 min)
SELECT m.conversation_id, m.created_at FROM messages m
WHERE m.sent_by='naty' AND EXISTS (SELECT 1 FROM messages m2 WHERE m2.conversation_id=m.conversation_id
  AND m2.sent_by='clara' AND m2.content=m.content
  AND m2.created_at BETWEEN m.created_at - interval '2 minutes' AND m.created_at + interval '2 minutes');
```
Y en n8n: `get_execution` del workflow IG con `nodeNames: ['Buscar Echo Conocido']` muestra el error aunque la ejecución esté en verde.

**Fix (commits `2ac0884`, `bf0cd76` y el cron):**
1. `server.js` → `isOwnOutgoing()`: `/intervention` con `source='naty'` consulta por REST si ese mid o ese texto ya está registrado como saliente en los últimos 15 min; si sí, responde `{ignored:'echo_propio'}` y NO pausa. El cerebro deja de confiar en la clasificación de n8n.
2. `POST /remarketing/candidates` (RPC `get_remarketing_candidates` por REST, protegido con el secret) + cron interno en el cerebro (13-22 UTC, minuto 1). El workflow de n8n sigue publicado y sigue fallando cada hora hasta que se arregle la credencial o se reemplace su nodo Postgres por un HTTP Request a este endpoint (el clasificador de auto-mode bloqueó ese `update_workflow`; el código SDK validado está en el log de la sesión del 2026-09-11).
3. Reparación de datos: 17 filas fantasma `sent_by='naty'` borradas; 14 conversaciones devueltas a `status='clara'`; Yuri Leon (`1403197735111790`, perdida por un timeout de 30s en `Llamar a Clara Bot` el 7-sep) registrada a mano.

**Pendiente:** actualizar la contraseña de la credencial Postgres en n8n (Settings → Credentials → Supabase Postgres BayMax) o quitarle el nodo Postgres a los dos workflows. Mientras `Buscar Echo Conocido` siga fallando, cada respuesta de Clara en IG pasa por `/intervention` y se descarta ahí (2 s extra por mensaje, sin efecto visible).

**Estado:** ✅ Cerebro blindado y desplegado (2026-09-11). ⚠️ Credencial de n8n sigue rota.

---

## DATOS IMPORTANTES DEL SISTEMA

| Campo | Valor |
|-------|-------|
| Bot Instagram Account ID | `17841429353425573` |
| Workflow ID (N8N) | `JVKit1RQ4fwaUKwc` |
| N8N URL | `https://primary-production-d866.up.railway.app` |
| Instagram API endpoint | `https://graph.instagram.com/v21.0/me/messages` |
| Clara Bot endpoint | `POST https://clara-bot-o1zm.onrender.com/chat` |
| Clara Bot respuesta | `response.content.messages[0].text` |
| Token tipo | IGAAN (`IGAANdb0vL...`) |

---

## REGLAS PARA FUTURAS MODIFICACIONES

1. **NUNCA** usar `graph.facebook.com` con el token IGAAN
2. **NUNCA** editar código JavaScript en N8N desde el browser — usar siempre la API REST
3. **SIEMPRE** filtrar `!hasMessage`, `isEcho`, `isFromBot`, y `!messageText` en Parsear Webhook
4. **NUNCA** enviar `[mensaje sin texto]` — si no hay texto, retornar `skip: true`
5. **SIEMPRE** verificar en la pestaña Executions después de cualquier cambio
