# Clara Bot

Asistente de Instagram para [El Camino con Naty y Nico](https://elcaminoconnaty.com), integrado con ManyChat via Dynamic Content.

## Stack

- **Runtime**: Node.js 18+
- **Framework**: Express
- **IA**: Claude (Anthropic) para respuestas de texto
- **Transcripción**: Whisper (OpenAI) para mensajes de voz

## Variables de entorno requeridas

Configura estas variables en Render (o en un archivo `.env` local):

```
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
```

## Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/chat` | Endpoint principal (ManyChat Dynamic Content) |
| GET | `/health` | Health check |
| GET | `/historial/:userId` | Ver historial de un usuario |
| DELETE | `/historial/:userId` | Borrar historial de un usuario |

## Despliegue en Render

1. Conecta este repositorio en Render como **Web Service**
2. **Build Command**: `npm install`
3. **Start Command**: `npm start`
4. Agrega las variables de entorno `ANTHROPIC_API_KEY` y `OPENAI_API_KEY`
