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
3. **Workflow n8n `Clara - Aprendizaje semanal`** (`q82Uw0Krdd9MaZuq`): cron
   `0 0 1 * * 1` (lunes 01:00 UTC = domingo 8pm Bogotá) → `POST /learn`.
4. **Inyección en Clara**: `getNatyLessons()` carga la última fila **aprobada**
   (`status=eq.approved`) en memoria (refresh cada 6h) y la agrega como bloque de system con su
   propio `cache_control` en `/chat` y `/remarketing`. El caché de ese bloque solo se invalida
   cuando se aprueba una versión nueva.

## Aprobación (Nico decide, edita y activa)

Ningún aprendizaje entra al system prompt sin aprobación. Flujo:

1. El cron destila y deja la fila `pending`; Telegram avisa *"Nuevo aprendizaje propuesto…
   PENDIENTE de aprobación"*. Clara sigue usando la versión aprobada.
2. Nico revisa **conmigo (Claude Code) sección por sección** — Tono / Datos / Objeciones /
   Ejemplos —: para cada bloque aprueba tal cual o dice qué quitar/cambiar. Ensamblo el texto
   final con las ediciones.
3. Activación vía **`POST /learn/approve`** (header `x-intervention-secret`),
   body `{ id, decision: 'approve'|'reject', lessons? }`:
   - `approve`: marca la fila `approved` (con el `lessons` editado si viene), pone
     `updated_at=now()` y refresca el caché en memoria → Clara la usa al instante.
   - `reject`: marca la fila `rejected`; Clara conserva la aprobada anterior.

> **Protocolo para futuras sesiones**: al revisar una propuesta, presentar SIEMPRE las 4
> secciones numeradas una por una y esperar decisión de Nico en cada una antes de aprobar el
> conjunto. Nunca activar sin su OK explícito.

## Operación

- Corrida manual (destila → deja `pending`): `curl -X POST https://clara-bot-production-b2ca.up.railway.app/learn -H "x-intervention-secret: <INTERVENTION_SECRET>"`.
- Aprobar/editar una propuesta:
  `curl -X POST https://clara-bot-production-b2ca.up.railway.app/learn/approve -H "x-intervention-secret: <INTERVENTION_SECRET>" -H "Content-Type: application/json" -d '{"id": <N>, "decision": "approve", "lessons": "<texto final opcional>"}'`.
- Si la tabla no existe o no hay fila `approved`, Clara funciona normal (sin bloque de lecciones).
- Los mensajes `[mensaje manual sin texto]` (echoes de IG con adjuntos) se excluyen.
