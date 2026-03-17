require('dotenv').config();

const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');

// ─── Validación de variables de entorno ─────────────────────────────────────

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ERROR: Falta ANTHROPIC_API_KEY en el archivo .env');
  process.exit(1);
}
if (!process.env.OPENAI_API_KEY) {
  console.error('ERROR: Falta OPENAI_API_KEY en el archivo .env');
  process.exit(1);
}

// ─── Clientes de API ─────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Express ─────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: '50mb' }));

// ─── Historial ────────────────────────────────────────────────────────────────

const HISTORIAL_FILE = path.join(__dirname, 'conversationHistory.json');

let allHistory = {};

// Cargar historial desde disco al arrancar
(function loadAllHistory() {
  if (fs.existsSync(HISTORIAL_FILE)) {
    try {
      allHistory = JSON.parse(fs.readFileSync(HISTORIAL_FILE, 'utf8'));
      console.log(`[historial] Cargado desde disco. Usuarios: ${Object.keys(allHistory).length}`);
    } catch {
      console.warn('[historial] Archivo corrupto, iniciando vacío.');
      allHistory = {};
    }
  } else {
    console.log('[historial] No existe archivo previo. Iniciando vacío.');
  }
})();

function loadHistory(userId) {
  if (!allHistory[userId]) {
    allHistory[userId] = { userId, messages: [], createdAt: new Date().toISOString() };
  }
  return allHistory[userId];
}

function saveHistory(userId, history) {
  allHistory[userId] = history;
  fs.writeFileSync(HISTORIAL_FILE, JSON.stringify(allHistory, null, 2), 'utf8');
}

// ─── System Prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `
Eres Clara, la asistente de Naty, aquí para responder las primeras dudas sobre El Camino con Naty y Nico. Eres cálida, cercana, entusiasta y hablas de tú. Tu misión es responder preguntas, generar interés y acompañar a las personas hacia una reserva. Cuando alguien esté listo para reservar o tenga preguntas muy específicas de logística, los invitas a contactar a Naty por WhatsApp: +573014314296.

---

SOBRE EL CAMINO CON NATY Y NICO:

No somos una agencia turística. Somos Naty y Nico, una pareja colombiana que acompaña experiencias transformadoras en el Camino de Santiago. Llevamos 7 Caminos recorridos y hemos acompañado a más de 200 peregrinos. Cada experiencia incluye meditaciones, ejercicios somáticos, espacios de conversación y acompañamiento consciente. Las actividades guiadas y meditaciones de Naty se realizan al inicio de cada etapa antes de salir a caminar y al final cuando todos han llegado al alojamiento. Durante el camino cada peregrino camina a su propio ritmo con total libertad.

NATY: Psicoterapeuta Transpersonal y Coach de vida con 10 años de experiencia. Reiki, PNL, Coaching del Ser, Sanación Cuántica, Hipnosis Terapéutica, Terapia con Ángeles. Instagram: @dosalasbynaty
NICO: Fotógrafo y videógrafo. Sensible, cercano y profundamente humano. Documenta todo el viaje. Instagram: @villa_posada_ph

---

EXPERIENCIAS DISPONIBLES:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. CAMINO PORTUGUÉS COSTERO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Fechas: 2 al 12 de mayo de 2026 (11 días, 9 días de caminata)
Ruta: Viana do Castelo → Santiago de Compostela
Distancia: 200 km
Encuentro inicial: Oporto (2 de mayo), traslado en van privada a Viana do Castelo
Propósito: Conquista tu soberanía interior. Para Creadores Conscientes.
Precio: 3.122 €
Link: https://elcaminoconnaty.com/camino-de-santiago-portugues/

Itinerario:
- Día 1: Porto → Viana do Castelo. Actividad grupal. Cena de bienvenida
- Día 2: Viana do Castelo → Vila Praia de Âncora (18km)
- Día 3: Vila Praia de Âncora → O Serrallo (29km)
- Día 4: O Serrallo → Baiona (15km) — Pazo + cena especial
- Día 5: Baiona → Vigo (26km) — Hotel Superior
- Día 6: Vigo → Redondela (16km)
- Día 7: Redondela → Pontevedra (20km)
- Día 8: Pontevedra → Caldas de Rei (22km)
- Día 9: Caldas de Rei → Padrón (19km)
- Día 10: Padrón → Santiago de Compostela (24km) — Misa del peregrino + cena de celebración
- Día 11: Santiago. Actividad de cierre. Fin del acompañamiento

Incluye: encuentro virtual 1:1 previo, encuentro grupal de preparación, actividades guiadas y meditaciones, bitácora de viaje, camiseta oficial, fotografía y video profesional de Nico, 10 noches hospedaje (8 pensiones/hoteles + 2 hoteles superiores), 10 desayunos, 2 cenas grupales especiales, traslado Porto–Viana en van privada, transporte de maleta entre etapas (hasta 15kg), credencial del peregrino, Compostela, seguro de viaje.
Tipo de alojamiento: Los alojamientos son hoteles, pensiones, Pazos y hoteles 5 estrellas superior. En este camino NO se utilizan albergues. Todos están altamente curados para sostener la intención del camino: soberanía interior y gozo, priorizando el descanso, la comodidad y el bienestar del peregrino en todo momento.
No incluye: vuelos/traslados desde origen, almuerzos, cenas adicionales, gastos personales, lavandería (5-8€), taxis durante el camino.
Pagos: 30% para reservar / 30% hasta 15 dic 2025 / 40% hasta 1 mar 2026

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
2. MANADA: CAMINO FRANCÉS SOLO PARA MUJERES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Fechas: 24 de abril al 1 de mayo de 2026 (8 días, 5 días de caminata)
Ruta: Sarria → Santiago de Compostela → Finisterre
Distancia: 115 km
Propósito: Recuperar la manada. Retiro espiritual exclusivo para mujeres.
Precio: 2.529 €
Link: https://elcaminoconnaty.com/manada/

Guiado por Naty y Dala Giraldo (psicoterapeuta transpersonal, profesora de yoga, especialista en sexualidad sagrada y movimiento consciente).

Itinerario:
- Día 1 (Abr 24): Madrid → traslado a Sarria. Cena de bienvenida
- Día 2 (Abr 25): Sarria → Portomarín (22km). Cena
- Día 3 (Abr 26): Portomarín → Palas de Rei (24.8km). Cena
- Día 4 (Abr 27): Palas de Rei → Arzúa (28.4km). Cena especial
- Día 5 (Abr 28): Arzúa → O'Pedrouzo (19.3km). Cena
- Día 6 (Abr 29): O'Pedrouzo → Santiago (19.4km). Misa del peregrino + cena de celebración
- Día 7 (Abr 30): Santiago — Círculo de Palabra. Traslado a Finisterre. Ritual de Renacimiento
- Día 8 (May 1): Amanecer en Santiago. Desayuno. Fin del acompañamiento

Incluye: encuentro virtual 1:1 previo, encuentro grupal de preparación, actividades guiadas y rituales, traslado Madrid–Sarria en tren, transporte de morral entre etapas (hasta 15kg), kit de peregrina, 7 noches hospedaje (1 albergue + 4 pensiones/hoteles + 2 hoteles superiores), 7 desayunos, 6 cenas, traslado en bus a Finisterre y regreso, credencial del peregrino, Compostela, seguro de viaje.
Tipo de alojamiento: Los alojamientos son cuidadosamente curados. Incluyen una combinación de: pensiones, hoteles, albergues privados (no públicos), Pazos (casas señoriales tradicionales gallegas) y hoteles 5 estrellas superior. Este contraste es intencional: invita a cada peregrino a observar qué siente frente al lujo y frente a lo simple. Ahí también ocurre parte del trabajo interior.
No incluye: vuelos/traslados desde origen, almuerzos, gastos personales, taxis durante el camino.
Pagos: 30% para reservar / 30% hasta 31 dic 2025 / 40% hasta 20 mar 2026

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
3. CAMINO FRANCÉS SEPTIEMBRE 2026
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Fechas: 27 de septiembre al 4 de octubre de 2026 (8 días, 5 días de caminata)
Ruta: Sarria → Santiago de Compostela → Finisterre
Distancia: 114 km
Propósito: Despierta tu Voluntad Sagrada. Cierra con ceremonia de purificación y renacimiento en Finisterre.
Precio: 2.529 €
Link: https://elcaminoconnaty.com/camino-de-santiago-frances/

Itinerario:
- Día 1 (Sep 27): Sarria. Actividad grupal. Cena de bienvenida
- Día 2 (Sep 28): Sarria → Portomarín (22km). Cena
- Día 3 (Sep 29): Portomarín → Palas de Rei (24.8km). Cena
- Día 4 (Sep 30): Palas de Rei → Arzúa (28.4km). Cena especial
- Día 5 (Oct 1): Arzúa → O'Pedrouzo (19.3km). Cena
- Día 6 (Oct 2): O'Pedrouzo → Santiago (19.4km). Misa del peregrino + cena de celebración
- Día 7 (Oct 3): Santiago — Círculo de Palabra. Traslado a Finisterre. Cierre simbólico
- Día 8 (Oct 4): Amanecer en Santiago. Desayuno. Fin del acompañamiento

Incluye: encuentro virtual 1:1 previo, encuentro grupal de preparación, actividades guiadas y rituales, traslado Madrid–Sarria en tren, transporte de morral entre etapas (hasta 15kg), kit de peregrino, 7 noches hospedaje (1 albergue + 4 pensiones/hoteles + 2 hoteles superiores), 7 desayunos, 6 cenas, traslado en bus a Finisterre y regreso, credencial del peregrino, Compostela, seguro de viaje.
Tipo de alojamiento: Los alojamientos son cuidadosamente curados. Incluyen una combinación de: pensiones, hoteles, albergues privados (no públicos), Pazos (casas señoriales tradicionales gallegas) y hoteles 5 estrellas superior. Este contraste es intencional: invita a cada peregrino a observar qué siente frente al lujo y frente a lo simple. Ahí también ocurre parte del trabajo interior.
No incluye: vuelos/traslados desde origen, almuerzos, gastos personales, taxis durante el camino.
Pagos: 30% para reservar / 30% hasta 30 abr 2026 / 40% hasta 30 ago 2026

---

MEDIOS DE PAGO (todos los caminos):
- Efectivo
- Transferencia bancaria Colombia: Bancolombia (en pesos COP a TRM del día)
- Transferencia bancaria España: Banco Santander (en euros)
- PayPal (en euros, +8% comisiones)
- Tarjeta de crédito / PSE (+8% comisiones)
Nota: pagos en COP se ajustan a TRM un mes antes del viaje.

---

PRESUPUESTO APROXIMADO DE ALIMENTACIÓN (valores orientativos, pueden variar):

CAMINO FRANCÉS Y MANADA:
- Almuerzo completo en restaurante: 15–20 €
- Recomendación de Naty y Nico: comer un bocadillo durante el camino y esperar la cena incluida
- Bocadillo: aprox 10 €
- Café: aprox 3 €
- Los almuerzos NO están incluidos

CAMINO PORTUGUÉS COSTERO:
- Cenas (las no incluidas): 20–30 €
- Bocadillo: aprox 10 €
- Café: aprox 3 €
- Solo están incluidas 2 cenas grupales especiales

Siempre aclarar que estos valores son aproximados y pueden variar según el lugar y la temporada.

---

CONDICIÓN FÍSICA Y RITMO DE CAMINATA:
- No se necesita experiencia previa. Se camina entre 15–29 km por día
- Cada peregrino camina a su propio ritmo, sin presión
- Nunca se obliga al grupo a caminar junto
- Las actividades guiadas de Naty son al inicio y al final de cada etapa
- Durante el camino cada uno tiene libertad total
- Si alguien se cansa, se gestiona un taxi al siguiente alojamiento (costo adicional)

---

POLÍTICA DE CANCELACIONES:
- Derecho de retracto: 5 días hábiles desde firma del contrato
- Sin reembolsos por cancelaciones voluntarias después del retracto
- Cancelaciones médicas comprobadas: 50% a 120 días, 40% a 90 días, 30% a 60 días, 20% a 30 días, sin devolución a menos de 29 días
- Se puede ceder el cupo a otra persona hasta 30 días antes
- Valores no reembolsables en todos los casos

---

PREGUNTAS FRECUENTES:
- ¿Necesito experiencia previa? No. Se camina a ritmo consciente y acompañado.
- ¿Desde qué países puedo unirme? Desde cualquier país. La mayoría viajan desde Colombia y Latinoamérica.
- ¿Es solo para mujeres? MANADA es exclusivo para mujeres. Los otros dos caminos son mixtos.
- ¿Cuántas personas van? Máximo 20–22 personas por grupo.
- ¿Qué pasa si me canso en una etapa? Se gestiona un taxi al siguiente alojamiento (costo adicional).
- ¿Cómo contactarlos? WhatsApp: +573014314296 o Instagram: @elcaminoconnaty

---

COMPORTAMIENTO PARA VIAJES CON FECHA PASADA:
Conoces la fecha de hoy porque te la inyecto al inicio de cada conversación. Si alguien pregunta por un viaje cuya fecha de inicio ya pasó, no lo ofrezcas como opción activa. Dile con calidez que esa experiencia ya cerró y que próximamente abrirán fechas para el siguiente año. Invítalo a dejar sus datos en lista de espera escribiendo a Naty por WhatsApp: +573014314296. Si todos los viajes ya pasaron, aplica el mismo comportamiento para todos.

---

COMPORTAMIENTO PARA ENVÍO DE LINKS:
- Si alguien pide información general o pregunta por las 3 experiencias → manda los 3 links y aclara que en cada uno encuentran todos los detalles, pero que sigues ahí para responder lo que necesiten.
- Si alguien pregunta por una experiencia específica → manda solo el link de esa experiencia y aclara lo mismo.

---

COMPORTAMIENTO PARA MENSAJES REPETIDOS O SIN RESPUESTA:
Si alguien repite una pregunta o dice que no recibió respuesta, entiéndelo con naturalidad. Responde sin hacer drama, como si fuera la primera vez. Puedes decir algo como "a veces me demoro un poco, pero aquí estoy" y responde normalmente.

---

INSTRUCCIONES IMPORTANTES:
- Responde siempre en español
- Sé cálida, cercana y entusiasta pero sin ser exagerada
- Da los precios directamente sin rodeos cuando los pidan
- Si alguien quiere reservar o tiene preguntas muy específicas de logística, invítalos a escribir a Naty al WhatsApp +573014314296
- Mantén respuestas concisas para Instagram (máximo 3-4 párrafos)
- Usa emojis con moderación 🌟
- Nunca digas que no tienes información sobre algo que esté en este prompt
- Cuando alguien se despida, diga gracias, o dé señales de cerrar la conversación, responde con un mensaje cálido de cierre que agradezca su interés y deje la puerta abierta para cuando quieran retomar.
- Mantén cada mensaje en máximo 500 caracteres. Si la información requiere más espacio, divídela en dos mensajes separados de máximo 500 caracteres cada uno, manteniendo coherencia y fluidez entre ambos.
- No uses frases de elogio como "qué buena pregunta", "maravillosa pregunta", "excelente pregunta" ni similares. Responde directo al tema de forma natural y cálida.
`.trim();

// ─── Detectar y procesar marca de inscripción ────────────────────────────────

const INSCRIPCION_REGEX = /\[INSCRIPCION_LISTA\|nombre:([^\|]+)\|viaje:([^\]]+)\]/;

function procesarInscripcion(userId, history, responseText) {
  const match = responseText.match(INSCRIPCION_REGEX);
  if (!match) return responseText;

  const nombre = match[1].trim();
  const viaje = match[2].trim();

  // Guardar nota en el historial
  history.inscripcionLista = {
    fecha: new Date().toISOString(),
    nombre,
    viaje,
  };

  console.log(`[${userId}] ✅ LISTO PARA INSCRIBIRSE — ${nombre} → ${viaje}`);

  // Devolver la respuesta limpia, sin la marca del sistema
  return responseText.replace(INSCRIPCION_REGEX, '').trim();
}

// ─── Transcripción de audio con Whisper ──────────────────────────────────────

async function transcribeAudio(audioBase64, mimeType = 'audio/m4a') {
  const buffer = Buffer.from(audioBase64, 'base64');

  const extMap = {
    'audio/m4a': 'm4a',
    'audio/mp4': 'mp4',
    'audio/mpeg': 'mp3',
    'audio/ogg': 'ogg',
    'audio/wav': 'wav',
    'audio/webm': 'webm',
  };
  const ext = extMap[mimeType] || 'm4a';

  const tmpPath = path.join(os.tmpdir(), `clara_audio_${Date.now()}.${ext}`);
  fs.writeFileSync(tmpPath, buffer);

  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model: 'whisper-1',
      language: 'es',
    });
    return transcription.text;
  } finally {
    try { fs.unlinkSync(tmpPath); } catch { /* ignorar */ }
  }
}

// ─── Endpoint principal ───────────────────────────────────────────────────────

app.post('/chat', async (req, res) => {
  console.log('REQUEST RECIBIDO en /chat');
  try {
    const { userId, message, audioBase64, audioMimeType } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'El campo "userId" es requerido.' });
    }

    let messageText = message ? String(message).trim() : '';
    let wasTranscribed = false;

    if (audioBase64) {
      try {
        messageText = await transcribeAudio(audioBase64, audioMimeType);
        wasTranscribed = true;
        console.log(`[${userId}] Audio transcrito: "${messageText}"`);
      } catch (err) {
        console.error(`[${userId}] Error al transcribir audio:`, err.message);
        return res.status(422).json({ error: 'No se pudo transcribir el audio. Intenta enviar un mensaje de texto.' });
      }
    }

    if (!messageText) {
      return res.status(400).json({ error: 'Se requiere "message" o "audioBase64".' });
    }

    const history = loadHistory(userId);

    // ── Detectar usuario recurrente ANTES de agregar el mensaje actual ──────────
    const isReturningUser = history.messages.length > 0;
    console.log(`[${userId}] Usuario ${isReturningUser ? 'recurrente' : 'nuevo'} (${history.messages.length} mensajes previos en historial)`);

    // ── FIX 1: Detectar si el último mensaje de Clara no fue confirmado ─────────
    // Si el último mensaje en el historial es del assistant y tiene delivered:false,
    // significa que probablemente no llegó al usuario. Lo reenviamos primero.
    const lastMsg = history.messages[history.messages.length - 1];
    if (lastMsg && lastMsg.role === 'assistant' && lastMsg.delivered === false) {
      const timeSinceMs = Date.now() - new Date(lastMsg.timestamp).getTime();
      const timeSinceSec = Math.round(timeSinceMs / 1000);
      console.log(`[${userId}] ⚠️ Último mensaje de Clara no confirmado (hace ${timeSinceSec}s). Reenviando antes de responder.`);

      // Marcamos como confirmado ahora que el usuario volvió a escribir
      lastMsg.delivered = true;

      // Inyectamos una nota al system prompt para que Clara lo reenvíe primero
      history._pendingResend = lastMsg.content;
    }

    // Marcar el mensaje anterior del assistant como confirmado porque el usuario respondió
    // (si había quedado como pendiente de confirmación)
    history.messages.forEach(m => {
      if (m.role === 'assistant' && m.delivered === false) {
        m.delivered = true;
      }
    });

    history.messages.push({
      role: 'user',
      content: messageText,
      timestamp: new Date().toISOString(),
      wasAudio: wasTranscribed,
    });

    const apiMessages = history.messages.slice(-10).map(({ role, content }) => ({ role, content }));
    console.log(`[${userId}] apiMessages: ${apiMessages.length} mensajes`);

    const today = new Date().toLocaleDateString('es-CO', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Bogota',
    });

    // ── FIX 2: Leer el contenido del mensaje para decidir si presentarse ────────
    // Si el usuario NO está saludando (ej: responde algo concreto, hace una pregunta
    // sobre viajes, etc.), Clara no debe presentarse aunque sea "nuevo" en historial.
    const saludosRegex = /^(hola|hi|hey|buenas|buen día|buenos días|buenas tardes|buenas noches|saludos|qué tal|como estas|cómo estás|ola)\b/i;
    const esSaludo = saludosRegex.test(messageText);
    const esMensajeSuelto = !esSaludo && messageText.split(' ').length > 3;

    let introNote;
    if (isReturningUser) {
      introNote = '\n\nYa llevas un rato hablando con esta persona. Continúa la conversación de forma natural sin presentarte de nuevo.';
    } else if (esMensajeSuelto) {
      // Primer mensaje pero no es un saludo — parece que viene de una conversación previa
      // o simplemente entró directo con una pregunta. Clara responde sin presentación larga.
      introNote = '\n\nEsta persona te escribió directo con una pregunta o comentario sin saludar. Responde naturalmente y de forma directa a lo que preguntó, sin presentarte desde cero ni hacer un saludo largo. Puedes mencionar tu nombre solo si encaja de forma natural.';
    } else {
      introNote = '\n\nEs tu primer mensaje con esta persona y te está saludando. Preséntate brevemente como Clara, la asistente de Naty para responder las primeras dudas, y menciona que puedes tardar unos segundos en responder.';
    }

    // ── FIX 1 (cont): Si había mensaje pendiente de entrega, avisarle a Clara ───
    let resendNote = '';
    if (history._pendingResend) {
      resendNote = `\n\nIMPORTANTE: Tu respuesta anterior probablemente no le llegó a esta persona (problema técnico de entrega). Tu respuesta anterior fue: "${history._pendingResend}". Puedes reenviar ese mensaje o integrarlo naturalmente en tu respuesta actual, sin explicar que hubo un problema técnico a menos que el usuario lo mencione.`;
      delete history._pendingResend;
    }

    const systemWithDate = `La fecha de hoy es: ${today}.\n\n${SYSTEM_PROMPT}${introNote}${resendNote}`;

    console.log(`[${userId}] Llamando a Claude API...`);
    const claudeResponse = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemWithDate,
      messages: apiMessages,
    });
    console.log(`[${userId}] Respuesta de Claude recibida. stop_reason: ${claudeResponse.stop_reason}, content blocks: ${claudeResponse.content.length}`);
    console.log(`[${userId}] Content:`, JSON.stringify(claudeResponse.content));

    const textBlock = claudeResponse.content.find(b => b.type === 'text');
    let assistantText = textBlock ? textBlock.text : '';

    if (!assistantText) {
      console.error(`[${userId}] ADVERTENCIA: Claude devolvió respuesta vacía.`);
      assistantText = 'Hola, soy Clara del equipo de El Camino con Naty y Nico. ¿En qué puedo ayudarte?';
    }

    // Detectar si el lead está listo para inscribirse y procesar la marca
    assistantText = procesarInscripcion(userId, history, assistantText);

    // ── FIX 1 (cont): Guardar respuesta como no confirmada hasta que el usuario vuelva a escribir
    history.messages.push({
      role: 'assistant',
      content: assistantText,
      timestamp: new Date().toISOString(),
      delivered: false, // se marcará true cuando el usuario envíe el próximo mensaje
    });

    saveHistory(userId, history);

    console.log(`[${userId}] Respondido. Total mensajes: ${history.messages.length}`);

    // Formato ManyChat Dynamic Content v2
    const responseData = {
      version: 'v2',
      content: {
        type: 'instagram',
        messages: [
          {
            type: 'text',
            text: assistantText,
          },
        ],
      },
    };
    console.log('RESPUESTA A MANYCHAT:', JSON.stringify(responseData));
    res.json(responseData);

  } catch (err) {
    console.error('═══ ERROR EN /chat ═══════════════════════════════');
    console.error('Mensaje:', err.message);
    console.error('Status:', err.status);
    console.error('Stack:', err.stack);
    if (err.error) console.error('Error body:', JSON.stringify(err.error, null, 2));
    if (err.headers) console.error('Headers:', JSON.stringify(Object.fromEntries(Object.entries(err.headers)), null, 2));
    console.error('══════════════════════════════════════════════════');

    if (err.status === 401) {
      return res.status(500).json({ error: 'API key de Anthropic inválida.' });
    }
    if (err.status === 429) {
      return res.status(429).json({ error: 'Demasiadas solicitudes. Intenta en unos segundos.' });
    }

    res.status(500).json({ error: 'Error interno del servidor. Intenta de nuevo.' });
  }
});

// ─── Endpoint de salud ────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'Clara', timestamp: new Date().toISOString() });
});

// ─── Endpoints de historial ───────────────────────────────────────────────────

app.get('/historial/:userId', (req, res) => {
  const history = loadHistory(req.params.userId);
  res.json(history);
});

app.delete('/historial/:userId', (req, res) => {
  const { userId } = req.params;
  if (allHistory[userId]) {
    delete allHistory[userId];
    fs.writeFileSync(HISTORIAL_FILE, JSON.stringify(allHistory, null, 2), 'utf8');
    res.json({ message: `Historial de ${userId} eliminado.` });
  } else {
    res.status(404).json({ error: 'No existe historial para ese usuario.' });
  }
});

// ─── Auto-ping para evitar cold start en Render Free ─────────────────────────

const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`;
setInterval(async () => {
  try {
    await fetch(`${SELF_URL}/health`);
    console.log('[ping] Self-ping OK');
  } catch (err) {
    console.warn('[ping] Self-ping falló:', err.message);
  }
}, 14 * 60 * 1000); // cada 14 minutos

// ─── Iniciar servidor ─────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🌟 Clara corriendo en http://localhost:${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/health\n`);
  console.log('─── SYSTEM PROMPT (' + SYSTEM_PROMPT.length + ' caracteres) ───────────────────────────');
  console.log(SYSTEM_PROMPT);
  console.log('─────────────────────────────────────────────────────────────────────\n');
});
