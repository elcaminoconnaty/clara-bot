# Remarketing de Clara — Documentación completa

Documento de referencia del sistema de remarketing construido el **2026-06-03**.
Cubre la migración a Railway, el re-engagement en ventana de 24h (Fase 1) y las
plantillas de WhatsApp para el backlog (Fase 2).

---

## 1. Resumen

Clara (bot de El Camino con Naty) era **100% reactiva**: solo respondía cuando
alguien le escribía. Se construyó un sistema de **remarketing** para reactivar
automáticamente a los leads que se quedaron callados, en dos fases:

- **Fase 1 — Ventana 24h (GRATIS, IG + WhatsApp):** mientras la conversación sigue
  dentro de la ventana de 24h de Meta, Clara genera y envía un mensaje de
  reactivación personalizado. **CORRIENDO en producción.**
- **Fase 2 — Backlog con plantillas (WhatsApp, de pago):** para conversaciones
  fuera de la ventana de 24h, se usan plantillas de marketing aprobadas por Meta,
  con cadencia +2d / +7d / +21d. **En preparación** (depende de aprobación de
  plantillas por Meta).

La regla central: **NO se hace remarketing** a quien ya recibió handoff (Clara le
dio el número de Nico/Naty), a pausados por Naty, al admin, ni a opt-outs. Se
prioriza por temperatura del lead (caliente → tibio → frío).

---

## 2. Infraestructura e IDs

### Railway (proyecto `el-camino-con-naty`)
- Project ID: `eea43bc7-3b07-4cda-a287-c9d8ab945911`
- Environment production: `08f441b3-3abc-4ca5-a0dc-ffe2d38504b8`
- Servicio Clara: `clara-bot` (`fee059bf-676f-4e50-ab2a-cc87750475a7`)
- **URL pública:** `https://clara-bot-production-b2ca.up.railway.app`
- URL privada interna: `clara-bot.railway.internal`
- Env vars: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (PORT lo inyecta Railway)
- ⚠️ **El servicio NO tiene auto-deploy en `git push`.** Tras pushear a `main` hay
  que disparar el deploy manualmente (Railway MCP `deployment_trigger`, o conectar
  el repo en la UI para auto-deploy).
- n8n vive en OTRO proyecto Railway (`BayMax-El-Grande`, servicio `Primary` =
  `https://primary-production-d866.up.railway.app`).

### Render (legado)
- `clara-bot-o1zm.onrender.com` — sigue encendido como **rollback**. Apagar tras
  24-48h estable. Antes: revisar si el dashboard de Naty usa esa URL (/paused,
  /historial, /intervention).

### Supabase (`yvytzquewjsjsmgiwmaa`)
- URL: `https://yvytzquewjsjsmgiwmaa.supabase.co`
- Tablas operacionales: `conversations`, `messages`, `token_usage`.
- Columnas añadidas a `conversations` para remarketing:
  `remarketing_stage` (text, default 'none'), `remarketing_next_at` (timestamptz),
  `remarketing_count` (int, default 0), `remarketing_last_at` (timestamptz),
  `lead_temp` (text: caliente/tibio/frio).
- RPCs: `get_remarketing_candidates(p_limit)` (Fase 1), `get_template_candidates(p_limit)` (Fase 2).

### n8n
- Workflow IG: `JVKit1RQ4fwaUKwc` (Instagram Bot - Clara)
- Workflow WA: `XuOuodKtWoW03RBL` (Clara - WhatsApp)
- **Workflow Remarketing: `AZAZ1Opzn0ntCmua` (Clara - Remarketing 24h) — ACTIVO**
- Credenciales usadas:
  - Postgres `Supabase Postgres BayMax` (`77LyzCQh9TZFg73d`)
  - WhatsApp `WhatsApp Bearer Token` (`Fl1YOKby5Bm95DLh`)
  - Instagram `Instagram Clara Token` (`lqnTvMZ8KkYw27NE`)
- ⚠️ Al crear/actualizar workflows vía MCP, **las credenciales NO se enlazan
  solas** → hay que reasignarlas a mano en la UI (cada nodo) + **Cmd+S**, y luego
  `publish_workflow`.

### Meta / WhatsApp
- **Clara WhatsApp:** phone_number_id `1045960141936016`, WABA `886940637640404`.
- **Isabel** (otro bot, NO Clara): WABA `1047960878402629`.
- Número de prueba viejo a ignorar: `990708964134287`.
- Instagram bot account id: `17841429353425573`. Token IG: tipo IGAAN (en credencial).

### Identidades
- Admin Nico: `573004910929` (excluido del remarketing).
- Números de handoff (si Clara los entregó → excluir): Nico `3004910929`, Naty `3014314296`.

### Clara backend (server.js)
- Endpoints: `/chat`, `/intervention`, `/remarketing`, `/paused`, `/health`, `/historial/:userId`.
- Repo GitHub: `elcaminoconnaty/clara-bot`.

---

## 3. Fase 0 — Migración Render → Railway (hecha)

Se migró Clara de Render (cold starts en free tier) a Railway (junto al resto de
proyectos del dueño). Pasos: crear servicio desde el repo, copiar env vars,
generar dominio, validar `/health` + `/chat` reales, reapuntar los nodos
`Llamar a Clara Bot` (IG) y `Llamar a Clara` (WA) de Render → Railway, validar con
tráfico real, dejar Render como rollback. **Verificado:** tráfico de producción
fluye por Railway, caché de prompt OK, Supabase OK.

---

## 4. Fase 1 — Re-engagement en ventana 24h (CORRIENDO)

### 4.1 Endpoint `POST /remarketing` (server.js)
Genera el mensaje de reactivación. **No envía ni escribe en DB** (eso lo hace n8n).
- Auth opcional: header `x-intervention-secret` (= `INTERVENTION_SECRET`; hoy no
  seteado en Railway → endpoint abierto, pendiente endurecer).
- Body: `{ userId, channel }`.
- Reusa `fetchHistory`, `isPaused` (fail-closed), `ADMIN_USERS`, `SYSTEM_PROMPT` cacheado.
- **Calificación Nivel 2 (IA):** Clara lee el historial y decide go/no-go. Devuelve
  `SKIP|motivo` si ya cerró bien (handoff, cliente, no_interesado, no_lead), o
  `SEND|temperatura|mensaje` si procede.
- Detalle clave: la directiva de reactivación se manda como **turno `user` final**
  (si no, Claude "continúa" el último turno del assistant y devuelve vacío).
- Respuesta: `{ action:'send', message, channel, lead_temp, usage }` o `{ action:'skip', reason }`.

### 4.2 Supabase RPC `get_remarketing_candidates(p_limit)`
Selector de candidatos en ventana. Calificación Nivel 1 (SQL):
- `status='clara'`, no admin, `remarketing_stage='none'`, último msg global =
  assistant (la persona se calló), sin handoff (número), sin opt-out.
- **Timing "última franja hábil antes del cierre":** `cierre = último_msg_usuario +
  24h − 90min`. Se envía en la última marca horaria dentro de **08:00–18:00
  America/Bogota** que sea ≤ cierre → gap máximo, nunca de noche, sin salirse de
  ventana. Piso mínimo de gap 3h.

### 4.3 Workflow n8n `Clara - Remarketing 24h` (`AZAZ1Opzn0ntCmua`)
Cron `0 0 13-22 * * *` UTC (= **cada hora, 8am–5pm COT**) →
`Buscar Candidatos` (Postgres RPC) → `Generar Mensaje` (HTTP a `/remarketing`) →
`¿Enviar?` (IF action=send) → `¿Instagram?` (IF channel) →
- IG: `Enviar IG` (HTTP, credencial IG) → `Registrar IG` (Postgres)
- WA: `Enviar WA` (HTTP, credencial WA, phone_number_id `1045960141936016`) → `Registrar WA` (Postgres)

Pacing anti-spam: `batching` 1 envío / 12s. `p_limit=5` por corrida.
`Registrar` hace **UPDATE (marcar stage=window, count=1, last_at, lead_temp) +
INSERT (mensaje en historial)** en una sola consulta (CTE), con
`onError: continueRegularOutput`.

### 4.4 Máquina de estados (evita loops)
```
none ─(en ventana, su franja)→ window   [1 nudge IA, GRATIS]
window ─(no responde, ventana cerrada, +2d)→ tpl_1 → tpl_2 → tpl_3 → exhausted   [plantillas WA, Fase 2]
cualquiera ─(responde)→ replied   (Clara sigue normal)
cualquiera ─("BAJA"/"no")→ opted_out
instagram fuera de ventana → ig_cold   (no se puede DM; audiencia de ads)
```
Una sola entrada a `window` (desde `none`) → imposible re-tocar en ventana.

---

## 5. El bug de la 1ra corrida real y su fix

**Síntoma (exec 15842, 5pm COT):** la corrida con 4 candidatos terminó en `error`.
Los 3 IG se enviaron y marcaron OK, pero `Insertar Mensaje IG` falló con
`ExpressionError: Multiple matches found`, y el error detuvo la ejecución → la rama
de WhatsApp no corrió.

**Causa:** tener DOS nodos Postgres en fila (Marcar → Insertar). El primero colapsa
N ítems en 1, y el segundo ya no puede resolver `$("Buscar Candidatos").item`
(ambigüedad de pairedItem).

**Fix (aplicado y verificado, exec 15865):** fusionar Marcar+Insertar en **un solo
nodo Postgres por canal** (`Registrar IG`/`Registrar WA`) con UPDATE+INSERT en una
consulta CTE, y `onError: continueRegularOutput` para que un fallo no tumbe la otra
rama. Workflow quedó en 9 nodos (versión `ed97804f`). Probado en vivo con el lead WA
`573218208580`: envío OK, marcado window, mensaje guardado, sin error.

---

## 6. Fase 2 — Plantillas de WhatsApp (en preparación)

Para el backlog fuera de ventana (~300 conversaciones WA elegibles). **Bloqueado
hasta que Meta apruebe las plantillas.** Pago de WhatsApp ya configurado.

### 6.1 Plantillas (v2, tono humano) — crear en WABA `886940637640404`
**`reactivacion_camino_1`** (+2d):
> Hola 😊 Te escribo de El Camino con Naty. El otro día estuvimos hablando del
> Camino de Santiago y se nos quedó la conversación por ahí. Me quedé con la duda
> de si todavía le estás dando vueltas a la idea. Si quieres, seguimos charlando
> con calma, sin afán.
> Pie: `Si prefieres no recibir más mensajes, escribe BAJA.` · Botones: `Sí, sigamos` · `Ahora no`

**`reactivacion_camino_2`** (+7d):
> Hola, ¿cómo vas? 😊 Soy Clara, de El Camino con Naty. Sé que un viaje así no se
> decide de un día para otro, tranquilo. Te escribo solo para recordarte que aquí
> seguimos y que los cupos se van moviendo. Si te animas a retomarlo, te acompaño
> con gusto.
> Pie: `Si prefieres no recibir más mensajes, escribe BAJA.` · Botones: `Cuéntame` · `Ahora no`

**`reactivacion_camino_3`** (+21d):
> Hola 😊 Soy Clara, de El Camino con Naty. No te quiero abrumar con mensajes, así
> que este sería el último. Si algún día te vuelve la idea de hacer el Camino, aquí
> vamos a estar para ayudarte con cariño. ¡Un abrazo y buen camino! 🙏
> Pie: `Si prefieres no recibir más mensajes, escribe BAJA.` · Botones: `Retomemos` · `No, gracias`

### 6.2 RPC `get_template_candidates(p_limit)` (creada)
Devuelve WhatsApp elegibles: `stage IN (window,tpl_1,tpl_2)`, último msg=assistant,
sin handoff/opt-out, respetando cadencia (window→+2d para tpl_1; tpl_1/tpl_2 por
`remarketing_next_at`). Ordena calientes primero. Devuelve `next_template`
('tpl_1'|'tpl_2'|'tpl_3').

### 6.3 Workflow de backlog (CREADO, desactivado)
`Clara - Remarketing Backlog WA` (`nEj0pVb1ydjBmqQx`) — **desactivado**. Cron
`0 0 14,20 * * *` UTC (9am/3pm COT). RPC `get_template_candidates(40)` → IF por
`next_template` (tpl_1/tpl_2/tpl_3) → `Enviar Plantilla N` (WA tipo `template`,
name=`reactivacion_camino_N`, language `es`, pacing 15s) → `Registrar tpl_N`
(UPDATE estado + `remarketing_next_at`: tpl_1→+5d, tpl_2→+14d, tpl_3→exhausted).
Falta reasignar 7 credenciales + publish (ver checklist abajo).

### 6.4 Opt-out (IMPLEMENTADO) y Backfill (HECHO)
- **Opt-out** en `/chat` (commit 883b903, desplegado): detecta "baja/stop/no
  gracias/no me interesa" + frases de unsubscribe → marca `remarketing_stage=
  'opted_out'` (helper `setRemarketingStage`) + responde con cierre cálido.
  Conservador (no falso-positivo con "no me decido…"). Cubre el botón "No, gracias".
- **Backfill:** los 3 mensajes IG de la corrida 15842 ya insertados en `messages`.
- **Backlog elegible:** 277 conversaciones WA (de 371; 51 handoff + 1 optout excluidos).

### 6.5 Checklist de lanzamiento (cuando las plantillas estén Approved)
1. Confirmar idioma exacto aprobado (es vs es_CO) → ajustar `language.code` en los 3 nodos Enviar Plantilla si difiere.
2. Reasignar 7 credenciales del workflow `nEj0pVb1ydjBmqQx` + Cmd+S + `publish_workflow`.
3. Probar 1 envío real → verificar entrega + `stage=tpl_1` + `next_at`.
4. Sembrar backlog: `UPDATE conversations SET remarketing_stage='window', remarketing_last_at=now()-interval '3 days' WHERE channel='whatsapp' AND status='clara' AND remarketing_stage='none' AND user_id<>'573004910929' AND <sin handoff de número> AND <último msg=assistant> AND <sin optout>;`
5. Activar y monitorear primeras corridas.

### 6.4 Costo (WhatsApp 98% Colombia, ~$0,0125/msg)
- Backlog inicial: **~$9 USD una vez**. Recurrente: **~$5–8 USD/mes**.
- Nudges en ventana (Fase 1) y DMs dentro de 24h: **gratis**.

---

## 7. Operación

### Monitorear
- Ejecuciones: n8n → workflow `AZAZ1Opzn0ntCmua` → Executions. Una corrida que
  envía dura ~12s+ por mensaje (pacing); las vacías ~2s.
- Quién ya fue contactado:
  ```sql
  SELECT user_id, channel, remarketing_stage, lead_temp, remarketing_last_at
  FROM conversations WHERE remarketing_stage <> 'none' ORDER BY remarketing_last_at DESC;
  ```
- Candidatos ahora: `SELECT * FROM get_remarketing_candidates(5);`

### Pausar / rollback
- Pausar remarketing: desactivar el workflow `AZAZ1Opzn0ntCmua` en n8n. No afecta a
  Clara (chat reactivo sigue).
- Reintentar a alguien: `UPDATE conversations SET remarketing_stage='none', remarketing_next_at=NULL WHERE user_id='…';`
- Rollback de Clara a Render: reapuntar las URLs en n8n a `clara-bot-o1zm.onrender.com`.

### Deploy de Clara
- Editar `server.js` → `git push origin main` → disparar deploy en Railway
  (MCP `deployment_trigger` con el commit, o UI). Validar `/health` post-deploy.

---

## 8. Pendientes

1. **Fase 2:** aprobar plantillas en Meta → construir workflow de backlog + sembrar.
2. **Apagar Render** tras confirmar estabilidad (revisar consumidores de su URL).
3. **Endurecer:** setear `INTERVENTION_SECRET` en Railway + header en `/remarketing`.
4. **Backfill opcional:** los 3 mensajes IG de la corrida 15842 que no se guardaron
   en `messages` (cosmético).
5. **Instagram frío:** no se puede DM fuera de ventana → considerar ads de retargeting.

---

*Plan original: `~/.claude/plans/clara-es-un-bot-virtual-koala.md`. Memorias del
proyecto en `~/.claude/projects/.../memory/` (project_clara_remarketing,
reference_clara_railway, feedback_clara_push_auth).*
