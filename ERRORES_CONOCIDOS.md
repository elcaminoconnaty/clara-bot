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
