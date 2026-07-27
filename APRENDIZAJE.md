# Aprendizaje de Clara a partir de Naty

> Implementado 2026-07-10. Clara aprende de las respuestas manuales de Naty (intervenciones
> del panel / app de IG) y usa más contexto por conversación.

## Contexto por conversación

- Clara ahora recuerda los últimos **30 mensajes** de cada conversación (antes 6).
  `fetchHistory` trae 30 y `/chat` usa `.slice(-30)`; el remarketing usa `.slice(-12)`.
- Costo marginal: ~1.000-1.500 tokens extra de input por llamada; el system prompt sigue
  cacheado.

## Destilación semanal

1. **Tabla `naty_lessons`** (Supabase): `id, lessons text, examples jsonb, pairs_count int,
   last_message_at timestamptz, updated_at timestamptz default now(), status text default
   'pending'`. Cada corrida inserta una fila nueva.
   Estados: `pending` (propuesta sin revisar), `approved` (en vigor), `rejected` (descartada),
   `superseded` (reemplazada por una propuesta más nueva, o histórica).
2. **`POST /learn`** (server.js, header `x-intervention-secret`):
   - Busca mensajes `sent_by='naty'` posteriores al `last_message_at` de la última fila
     **aprobada**.
   - **Sin mensajes nuevos → `{skipped:true}`, no llama a Claude (costo $0)** y avisa por
     Telegram.
   - Con mensajes: arma pares (mensaje del cliente → respuesta de Naty), llama a Claude UNA
     vez con las lecciones **aprobadas** acumuladas + los pares nuevos, y guarda las lecciones
     actualizadas (tono, datos nuevos, manejo de objeciones + hasta 8 ejemplos reales).
     Costo por corrida ~$0.02-0.05.
   - **No aplica nada solo**: la fila nace `status='pending'` y NO entra al system prompt.
     Marca cualquier `pending` anterior como `superseded` (la nueva es superset porque
     re-procesa desde el último corte aprobado) y avisa por Telegram que hay algo por revisar.
   - En la misma llamada, Claude devuelve el documento y, tras el marcador
     `=== CAMBIOS ===`, de 4 a 8 viñetas `NUEVO:/MODIFICADO:/ELIMINADO:`. El servidor parte la
     respuesta: lo de arriba se guarda en `lessons`, lo de abajo viaja al aviso de Telegram.
   - **Guarda anti-erosión** en el prompt del destilador: no puede eliminar ni suavizar las
     prohibiciones ("Clara no da cifras"), prioridades ("hay urgencia real") ni negativas
     ("no desde Ferrol") de la versión anterior salvo que Naty las contradiga, y si lo hace
     debe declararlo en CAMBIOS. Tampoco puede repetir teléfonos ni políticas que ya estén en
     el `SYSTEM_PROMPT`. (La propuesta #4 borró las tres guardas y duplicó el celular de Naty.)
3. **Workflow n8n `Clara - Aprendizaje semanal`** (`q82Uw0Krdd9MaZuq`): cron
   `0 0 1 * * 1` → `POST /learn`. Ojo: las corridas reales caen **05:00 UTC = lunes 00:00
   Bogotá**, no domingo 8pm como dice la descripción del workflow — la instancia de n8n
   interpreta el cron en su propia zona (parece `America/New_York`).
4. **Inyección en Clara**: `getNatyLessons()` carga la última fila **aprobada**
   (`status=eq.approved`) en memoria (refresh cada 6h) y la agrega como bloque de system con su
   propio `cache_control` en `/chat` y `/remarketing`. El caché de ese bloque solo se invalida
   cuando se aprueba una versión nueva.

## Aprobación (Nico decide, edita y activa)

Ningún aprendizaje entra al system prompt sin aprobación. Flujo:

1. El cron destila y deja la fila `pending`, y el bot de Telegram **`@Alertas_clara_bot`**
   (el que Nico llama "Alberto") avisa con el `id`, el número de intervenciones, la ventana de
   fechas y el changelog — suficiente para decidir desde el celular si vale la pena sentarse:

   ```
   📚 Aprendizaje #5 PENDIENTE de aprobación
   12 intervenciones de Naty · 25 jul → 31 jul
   Clara sigue con la versión aprobada.

   Qué cambiaría:
   NUEVO: …
   ELIMINADO: …

   En Claude Code: "revisa el aprendizaje pendiente de Clara"
   ```

2. Nico revisa **conmigo (Claude Code) sección por sección** — Tono / Datos / Objeciones /
   Ejemplos —: para cada bloque aprueba tal cual o dice qué quitar/cambiar. Ensamblo el texto
   final con las ediciones. **`GET /learn/pending`** devuelve la propuesta y la vigente juntas,
   que es lo que hace falta para armar la tabla comparativa sin consultar Supabase a mano.
3. Activación vía **`POST /learn/approve`** (header `x-intervention-secret`),
   body `{ id, decision: 'approve'|'reject', lessons? }`:
   - `approve`: marca la fila `approved` (con el `lessons` editado si viene), pone
     `updated_at=now()` y refresca el caché en memoria → Clara la usa al instante.
     Antes marca `superseded` la aprobada anterior, para que solo haya una vigente.
   - `reject`: marca la fila `rejected`; Clara conserva la aprobada anterior.
   - Solo decide sobre filas en `pending`: cualquier otro estado responde **409** (antes un
     PATCH ciego por id revivía filas ya rechazadas o supersedidas).

> **Protocolo para futuras sesiones** (obligatorio):
> 1. SIEMPRE presentar los aprendizajes/insights para aprobación con una **tabla comparativa**
>    de **qué estaba (antes)** vs **qué va a cambiar (después)** — fila por fila, marcando lo
>    nuevo, lo modificado y lo eliminado. Nunca mostrar solo el texto nuevo.
> 2. Revisar sección por sección (Tono / Datos / Objeciones / Ejemplos); esperar la decisión de
>    Nico en cada una antes de aprobar el conjunto.
> 3. Nunca activar sin su OK explícito.

## Operación

- Corrida manual (destila → deja `pending`): `curl -X POST https://clara-bot-production-b2ca.up.railway.app/learn -H "x-intervention-secret: <INTERVENTION_SECRET>"`.
- Ver la propuesta pendiente junto a la vigente:
  `curl https://clara-bot-production-b2ca.up.railway.app/learn/pending -H "x-intervention-secret: <INTERVENTION_SECRET>"`.
- Aprobar/editar una propuesta:
  `curl -X POST https://clara-bot-production-b2ca.up.railway.app/learn/approve -H "x-intervention-secret: <INTERVENTION_SECRET>" -H "Content-Type: application/json" -d '{"id": <N>, "decision": "approve", "lessons": "<texto final opcional>"}'`.
- Si la tabla no existe o no hay fila `approved`, Clara funciona normal (sin bloque de lecciones).
- Los mensajes `[mensaje manual sin texto]` (echoes de IG con adjuntos) se excluyen.

## Historial de versiones

| id | Estado | Pares | Notas |
|---|---|---|---|
| 1 | `superseded` | 29 | Primera destilación (2026-07-10). |
| 2 | `superseded` | 32 | 2026-07-13. |
| 3 | `superseded` | 34 | Aprobada editada el 2026-07-21: se le metió a mano la prioridad absoluta de septiembre. |
| 4 | **`approved`** | 26 | 16–24 jul. Aprobada editada el 2026-07-27. Aportó la política del Camino Portugués y "ruta no disponible en grupo"; se le re-inyectaron las 3 guardas que había borrado (urgencia de septiembre, "Clara no da cifras", "no desde Ferrol") y los 2 ejemplos eliminados, y se le quitó el celular de Naty (ya está en el `SYSTEM_PROMPT`, `server.js:425` y `:715`). |
