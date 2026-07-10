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
   last_message_at timestamptz, updated_at timestamptz default now()`. Cada corrida inserta
   una fila nueva; la vigente es la de `updated_at` más reciente.
2. **`POST /learn`** (server.js, header `x-intervention-secret`):
   - Busca mensajes `sent_by='naty'` posteriores al `last_message_at` de la última fila.
   - **Sin mensajes nuevos → `{skipped:true}`, no llama a Claude (costo $0)** y avisa por
     Telegram.
   - Con mensajes: arma pares (mensaje del cliente → respuesta de Naty), llama a Claude UNA
     vez con las lecciones acumuladas + los pares nuevos, y guarda las lecciones
     actualizadas (tono, datos nuevos, manejo de objeciones + hasta 8 ejemplos reales).
     Costo por corrida ~$0.02-0.05.
3. **Workflow n8n `Clara - Aprendizaje semanal`** (`q82Uw0Krdd9MaZuq`): cron
   `0 0 1 * * 1` (lunes 01:00 UTC = domingo 8pm Bogotá) → `POST /learn`.
4. **Inyección en Clara**: `getNatyLessons()` carga la última fila en memoria (refresh cada
   6h) y la agrega como bloque de system con su propio `cache_control` en `/chat` y
   `/remarketing`. El caché de ese bloque solo se invalida cuando las lecciones cambian.

## Operación

- Corrida manual: `curl -X POST https://clara-bot-production-b2ca.up.railway.app/learn -H "x-intervention-secret: <INTERVENTION_SECRET>"`.
- Si la tabla no existe o está vacía, Clara funciona normal (sin bloque de lecciones).
- Los mensajes `[mensaje manual sin texto]` (echoes de IG con adjuntos) se excluyen.
