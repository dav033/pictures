/**
 * GUARDIA: ninguna llamada a un proveedor de IA (ni decisión de un modelo) sin pasar por un envoltorio de
 * src/lib/registro. Sin red ni coste:
 *
 *   npx tsx scripts/test/test-guardia-proveedores-ia.ts             # estricto (por defecto desde la 2.ª pasada)
 *   REGISTRO_GUARDIA_ESTRICTA=0 npx tsx scripts/test/test-guardia-proveedores-ia.ts  # solo puntos NO inventariados
 *
 * Cómo funciona: detecta en el código de servidor (src/, packages/*\/src) las formas crudas de llamar a una IA
 * (SDK de Gemini u otros, hosts de proveedores, procesos hijo, transporte al Python, fábricas de ChatPort,
 * bucles de herramientas, operaciones del Python que ejecutan un modelo). Cada línea detectada debe estar en
 * INVENTARIO con su punto de enganche; el punto está «envuelto» cuando el archivo de enganche contiene el
 * envoltorio. Lo mismo para las rutas /api (conRegistro) y para los fetch del navegador que deben llevar el id
 * de conversación. Desde la segunda pasada es estricta por defecto: cualquier punto sin envolver la hace fallar.
 * También comprueba los enganches de la conversación (vistas, ruta guiada, Python) que el registro necesita.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ESTRICTO_POR_DEFECTO = true;
const RAIZ = path.resolve(__dirname, "..", "..");
const ESTRICTO = process.argv.includes("--estricto") || process.env.REGISTRO_GUARDIA_ESTRICTA === "1" || (ESTRICTO_POR_DEFECTO && process.env.REGISTRO_GUARDIA_ESTRICTA !== "0");

interface Enganche {
  archivo: string;
  contiene: RegExp;
}

interface Punto {
  id: string;
  archivo: string;
  /** Qué líneas del archivo cubre esta entrada. */
  patron: RegExp;
  que: string;
  envoltorio: string;
  enganche: Enganche[];
}

const GEMINI_CENTRAL: Enganche = { archivo: "src/lib/gemini.ts", contiene: /envolverClienteGemini\(/ };
const CHATPORT_CENTRAL: Enganche = { archivo: "src/lib/ia/nucleo/registro.ts", contiene: /envolverChatPort\(/ };
/** W5: Claude (solo local). El ChatPort lo entrega `chatDe("claude")` envuelto; el cliente directo, `getClaudeClient`. */
const CHATPORT_CLAUDE: Enganche = { archivo: "src/lib/ia/nucleo/registro.ts", contiene: /envolverChatPort\(crearChatClaude\(/ };
const CLAUDE_CENTRAL: Enganche = { archivo: "src/lib/claude.ts", contiene: /envolverClienteAnthropic\(/ };
/** W5: los llamadores de una sola pasada piden su cliente al registro: Gemini (getGeminiClient) o Claude local con la forma de Gemini. */
const GENERATIVO_CENTRAL: Enganche = { archivo: "src/lib/ia/nucleo/cliente-generativo.ts", contiene: /comoClienteGemini\(claude, configClaudeLocal\(\)\)/ };
const PYTHON_CENTRAL: Enganche = { archivo: "src/lib/ia/nucleo/python-adapter.ts", contiene: /crearFetchAuditado\(/ };
const PYTHON_IA: Enganche = { archivo: "src/lib/ia/nucleo/python-adapter.ts", contiene: /propositoIa\s*:/ };
const PYTHON_CONVERSACION: Enganche = { archivo: "src/lib/ia/nucleo/python-adapter.ts", contiene: /x-conversacion-id|cabecerasCorrelacion\(/ };

/** Todas las llamadas a proveedores / decisiones de modelos del servidor, con su enganche propuesto. */
export const INVENTARIO: readonly Punto[] = [
  // ── Gemini directo (@google/genai) ──
  { id: "gemini-cliente", archivo: "src/lib/gemini.ts", patron: /new\s+GoogleGenAI/, que: "cliente compartido getGeminiClient()", envoltorio: "getGeminiClient(proposito) → envolverClienteGemini(cliente, { proposito })", enganche: [GEMINI_CENTRAL] },
  { id: "gemini-parser-intencion", archivo: "src/lib/ia/inari/parse.ts", patron: /\.models\.generateContent\(/, que: "Inari: parser de intención (JSON) cuando INTENT_PARSER_PYTHON_ENABLED está apagado (o con Claude local)", envoltorio: "clienteGenerativoDe(\"parser_intencion\") (getGeminiClient o getClaudeClient) + registrarSegunProveedor", enganche: [GEMINI_CENTRAL, GENERATIVO_CENTRAL, { archivo: "src/lib/ia/inari/parse.ts", contiene: /clienteGenerativoDe\("parser_intencion"\)/ }, { archivo: "src/lib/ia/inari/parse.ts", contiene: /registrarSegunProveedor\(generativo\.proveedor/ }] },
  { id: "gemini-traduccion-revision", archivo: "src/lib/ia/kagutsuchi/traducir-revision-modelo.ts", patron: /\.models\.generateContent\(/, que: "traducción al inglés de la revisión pedida para FLUX (antes dentro de /api/generate)", envoltorio: "clienteGenerativoDe(\"traduccion_revision\") (getGeminiClient o getClaudeClient)", enganche: [GEMINI_CENTRAL, GENERATIVO_CENTRAL, { archivo: "src/lib/ia/kagutsuchi/traducir-revision-modelo.ts", contiene: /clienteGenerativoDe\(PROPOSITO_TRADUCCION_REVISION\)/ }, { archivo: "src/app/api/generate/route.ts", contiene: /traducirRevisionParaFlux\(revisionInstruction, traducirRevisionConModelo\)/ }] },
  { id: "gemini-escena-ia", archivo: "src/lib/globos3d/modelo-escena/sesion-gemini.ts", patron: /\.models\.generateContent\(/, que: "taller 3D: bucle de herramientas que arma la escena (solo texto, sin imágenes) — sesión de Gemini", envoltorio: "modeloEscenaIADe(\"gemini\") → getGeminiClient(\"escena_ia\") + conRegistro + decidir por herramienta", enganche: [GEMINI_CENTRAL, { archivo: "src/lib/globos3d/modelo-escena/crear-modelo.ts", contiene: /getGeminiClient\("escena_ia"\)/ }, { archivo: "src/app/api/escena-ia/route.ts", contiene: /decidir\("herramienta:escena_ia"/ }] },
  { id: "gemini-lectura-foto", archivo: "src/lib/globos3d/leer-foto-ia.ts", patron: /\.models\.generateContent\(/, que: "taller 3D: Gemini lee la foto de una decoración (visión, salida JSON; nunca genera imágenes)", envoltorio: "clienteGenerativoDe(\"lectura_foto_escena\") (Gemini o Claude local) + registrarSegunProveedor + decidir por intento", enganche: [GEMINI_CENTRAL, GENERATIVO_CENTRAL, { archivo: "src/lib/globos3d/leer-foto-ia.ts", contiene: /clienteGenerativoDe\(PROPOSITO_LECTURA_FOTO\)/ }, { archivo: "src/lib/globos3d/leer-foto-ia.ts", contiene: /registrarSegunProveedor\(/ }, { archivo: "src/lib/globos3d/leer-foto-ia.ts", contiene: /decidir\("modelo:lectura_foto"/ }] },
  { id: "gemini-deteccion-globos", archivo: "src/lib/globos3d/detectar-globos-ia.ts", patron: /\.models\.generateContent\(/, que: "taller 3D: Gemini detecta los globos (mosaico de 3 × 3) y los fondos de la foto con su caja (visión, salida JSON; nunca genera imágenes)", envoltorio: "clienteGenerativoDe(\"deteccion_globos_foto\") (Gemini o Claude local) (pedido y respuesta de cada trozo) + registrarSegunProveedor + decidir del resultado", enganche: [GEMINI_CENTRAL, GENERATIVO_CENTRAL, { archivo: "src/lib/globos3d/detectar-globos-ia.ts", contiene: /clienteGenerativoDe\(PROPOSITO_DETECCION_GLOBOS\)/ }, { archivo: "src/lib/globos3d/detectar-globos-ia.ts", contiene: /registrarSegunProveedor\(/ }, { archivo: "src/lib/globos3d/detectar-globos-ia.ts", contiene: /decidir\("modelo:deteccion_globos"/ }] },
  { id: "gemini-interpretar-modulo", archivo: "src/lib/modulos-estudio/interpretar-ia.ts", patron: /\.models\.generateContent\(/, que: "estudio de módulos: Gemini Flash separa las palabras de un pedido («dúo de reflex rojo con azul mate») en JSON (solo texto; nunca genera imágenes)", envoltorio: "clienteGenerativoDe(\"modulos_interpretar\") (Gemini o Claude local) + registrarSegunProveedor + decidir del resultado", enganche: [GEMINI_CENTRAL, GENERATIVO_CENTRAL, { archivo: "src/lib/modulos-estudio/interpretar-ia.ts", contiene: /clienteGenerativoDe\(PROPOSITO_INTERPRETAR_MODULO\)/ }, { archivo: "src/lib/modulos-estudio/interpretar-ia.ts", contiene: /registrarSegunProveedor\(/ }, { archivo: "src/lib/modulos-estudio/interpretar-ia.ts", contiene: /decidir\("modelo:modulos_interpretar"/ }] },
  { id: "gemini-feedback-resumen", archivo: "src/lib/feedback-ia/resumen-gemini.ts", patron: /\.models\.generateContent\(/, que: "REQ-010: resumen opcional de los huecos recurrentes del feedback (solo texto sobre métricas agregadas, Flash, entrada y salida acotadas, coste máx. US$0,02)", envoltorio: "clienteGenerativoDe(\"feedback_ia_resumen\") (Gemini o Claude local) + registrarSegunProveedor + decidir del resultado", enganche: [GEMINI_CENTRAL, GENERATIVO_CENTRAL, { archivo: "src/lib/feedback-ia/resumen-gemini.ts", contiene: /clienteGenerativoDe\(PROPOSITO_RESUMEN\)/ }, { archivo: "src/lib/feedback-ia/resumen-gemini.ts", contiene: /registrarSegunProveedor\(/ }, { archivo: "src/lib/feedback-ia/resumen-gemini.ts", contiene: /decidir\("modelo:feedback_ia_resumen"/ }] },
  { id: "gemini-embedding", archivo: "src/lib/rag/embeddings.ts", patron: /\.models\.embedContent\(/, que: "embeddings de consulta/documento (RAG)", envoltorio: "getGeminiClient(\"embedding\")", enganche: [GEMINI_CENTRAL] },
  // ── @sempertex/agente-core (paquete): adaptador Gemini del ChatPort ──
  { id: "agente-core-cliente", archivo: "packages/agente-core/src/gemini/chat.ts", patron: /new\s+GoogleGenAI|export function crearChatGemini/, que: "ChatPort Gemini (chat clásico, guiado, Amaterasu, venue)", envoltorio: "chatDe()/chatOmoikaneDe() → envolverChatPort(port, { proposito })", enganche: [CHATPORT_CENTRAL] },
  { id: "agente-core-turno", archivo: "packages/agente-core/src/gemini/chat.ts", patron: /\.models\.generateContent(Stream)?\(/, que: "turno y turno en streaming del ChatPort Gemini", envoltorio: "envolverChatPort (cubre turno y turnoStream)", enganche: [CHATPORT_CENTRAL] },
  // ── Claude / Anthropic (W5, SOLO local: ia/claude/config.ts) — transporte fetch con la forma del SDK ──
  { id: "anthropic-transporte", archivo: "src/lib/ia/claude/cliente.ts", patron: /api\.anthropic\.com/, que: "transporte HTTP de la API de mensajes (create y stream); nunca se llama crudo", envoltorio: "crearChatClaude → chatDe(\"claude\") → envolverChatPort; getClaudeClient → envolverClienteAnthropic", enganche: [CHATPORT_CLAUDE, CLAUDE_CENTRAL] },
  { id: "anthropic-chatport", archivo: "src/lib/ia/claude/chat.ts", patron: /export function crearChatClaude|crearClienteAnthropic\(|\.messages\.(create|stream)\(/, que: "ChatPort de Claude (chat clásico, guiado, lectura de foto y venue en local), turno y turno en flujo", envoltorio: "chatDe()/chatLecturaFotoDe() → envolverChatPort(crearChatClaude(configClaudeLocal()), { proposito })", enganche: [CHATPORT_CLAUDE] },
  { id: "anthropic-cli-transporte", archivo: "src/lib/ia/claude/cli/proceso.ts", patron: /child_process/, que: "transporte por Claude Code (`claude -p` con la sesión de la suscripción, IA_CLAUDE_TRANSPORTE=cli, solo local): proceso hijo aislado (sin herramientas, CLAUDE.md, hooks ni MCP); nunca se llama crudo", envoltorio: "crearClienteClaudeCli → crearChatClaude → chatDe(\"claude\") → envolverChatPort; getClaudeClient → envolverClienteAnthropic(cliente, { proposito, transporte })", enganche: [CHATPORT_CLAUDE, CLAUDE_CENTRAL, { archivo: "src/lib/ia/claude/chat.ts", contiene: /crearClienteClaudeCli\(\)/ }, { archivo: "src/lib/claude.ts", contiene: /crearClienteClaudeCli\(\)/ }] },
  { id: "anthropic-cliente", archivo: "src/lib/claude.ts", patron: /crearClienteAnthropic\(/, que: "cliente compartido getClaudeClient() (null fuera de local)", envoltorio: "getClaudeClient(proposito) → envolverClienteAnthropic(cliente, { proposito })", enganche: [CLAUDE_CENTRAL] },
  { id: "anthropic-escena-ia", archivo: "src/lib/globos3d/modelo-escena/sesion-claude.ts", patron: /\.messages\.create\(/, que: "taller 3D: el mismo bucle de la escena con Claude en local (texto e imágenes, herramientas de Anthropic)", envoltorio: "modeloEscenaIADe(\"claude\") → getClaudeClient(\"escena_ia\") + registrarClaude por vuelta + decidir por herramienta", enganche: [CLAUDE_CENTRAL, { archivo: "src/lib/globos3d/modelo-escena/crear-modelo.ts", contiene: /getClaudeClient\("escena_ia"\)/ }, { archivo: "src/lib/globos3d/modelo-escena/sesion-claude.ts", contiene: /registrar\(\{ \.\.\.telemetria, modelo: respuesta\.model, resultado: "ok"/ }, { archivo: "src/lib/globos3d/modelo-escena/sesion-claude.ts", contiene: /\?\? registrarClaude/ }, { archivo: "src/app/api/escena-ia/route.ts", contiene: /decidir\("herramienta:escena_ia"/ }] },
  { id: "anthropic-como-gemini", archivo: "src/lib/ia/claude/como-gemini.ts", patron: /\.messages\.create\(/, que: "Claude con la forma de Gemini para la lectura de la foto 3D, la detección de globos, el parser, el intérprete de módulos, el resumen del feedback y la traducción (solo local)", envoltorio: "clienteGenerativoDe(proposito) → comoClienteGemini(getClaudeClient(proposito)) (auditado por envolverClienteAnthropic) + registrarSegunProveedor en cada llamador", enganche: [CLAUDE_CENTRAL, GENERATIVO_CENTRAL] },
  // ── @sempertex/happie-package-ia (paquete) ──
  { id: "happie-gemini", archivo: "packages/happie-package-ia/src/recomendador.ts", patron: /new\s+GoogleGenAI|\.models\.generateContent\(/, que: "Happie: recomendación/extracción estructurada (crearGeneradorGemini y su uso por defecto si `generar` falta)", envoltorio: "pasar SIEMPRE generar: envolverFuncionIa(generador, { proveedor, proposito: \"happie\" })", enganche: [{ archivo: "src/lib/happie/ia-recomendacion.ts", contiene: /envolverFuncionIa\(/ }, { archivo: "src/lib/happie/conversacion-webhook.ts", contiene: /envolverFuncionIa\(|generadorHappieAuditado\(/ }] },
  // ── fal / FLUX directo ──
  { id: "fal-flux", archivo: "src/lib/ia/kagutsuchi/flux.ts", patron: /queue\.fal\.run|rest\.alpha\.fal\.ai/, que: "FLUX en fal (cola submit → status → result → descarga)", envoltorio: "generarConSempertexFlux → auditarGeneracionImagen(...); fetchFalAllowed (fal-cola.ts) → crearFetchAuditado(fetch, { tipo: \"http\", proveedor: \"fal\", omitir: sondeos de estado })", enganche: [{ archivo: "src/lib/ia/kagutsuchi/flux.ts", contiene: /auditarGeneracionImagen\(/ }, { archivo: "src/lib/ia/kagutsuchi/fal-cola.ts", contiene: /crearFetchAuditado\(/ }] },
  { id: "fal-cola", archivo: "src/lib/ia/kagutsuchi/fal-cola.ts", patron: /queue\.fal\.run|rest\.alpha\.fal\.ai/, que: "transporte común de la cola de fal (hosts permitidos, redirecciones, lectura acotada de la imagen) que usan FLUX.2, FLUX.1 [dev] y Kontext", envoltorio: "crearFetchAuditado(fetch, { tipo: \"http\", proveedor: \"fal\", omitir: sondeos de estado })", enganche: [{ archivo: "src/lib/ia/kagutsuchi/fal-cola.ts", contiene: /crearFetchAuditado\(/ }] },
  { id: "fal-kontext", archivo: "src/lib/ia/kagutsuchi/kontext.ts", patron: /queue\.fal\.run|rest\.alpha\.fal\.ai/, que: "FLUX.1 Kontext pro/max en fal (cola submit → status → result, retomable por request_id)", envoltorio: "generarConFluxKontext → auditarGeneracionImagen(...); fetchFalAllowed (fal-cola.ts) → crearFetchAuditado", enganche: [{ archivo: "src/lib/ia/kagutsuchi/kontext.ts", contiene: /auditarGeneracionImagen\(/ }, { archivo: "src/lib/ia/kagutsuchi/fal-cola.ts", contiene: /crearFetchAuditado\(/ }] },
  // ── Transporte Next → Python (todas las llamarPython*) ──
  { id: "python-transporte", archivo: "src/lib/ia/nucleo/python-adapter.ts", patron: /\(input\.fetchImpl\s*\?\?\s*fetch\)|\/internal\/v1\/|env\.PYTHON_BACKEND_URL/, que: "abrirPeticionPython: las 37 operaciones /internal/v1/* (catálogo, plan, armados, guía de escena, IA)", envoltorio: "crearFetchAuditado(input.fetchImpl ?? fetch, { tipo: \"python\", propositoIa }) + header x-conversacion-id", enganche: [PYTHON_CENTRAL, PYTHON_IA, PYTHON_CONVERSACION] },
  // ── Proceso hijo: opencode (OpenAI) ──
  { id: "opencode-caption-orden", archivo: "src/lib/ordenes/generarCaption.ts", patron: /spawnSync|child_process/, que: "captions de órdenes con opencode (openai/gpt-*) en el panel admin", envoltorio: "auditarLlamadaIaSincrona({ proveedor: \"opencode\", modelo: OPENCODE_MODELO, proposito: \"caption_orden\" }, () => spawnSync(...))", enganche: [{ archivo: "src/lib/ordenes/generarCaption.ts", contiene: /auditarLlamadaIaSincrona\(/ }] },
  // ── Fábricas de ChatPort respaldadas por Python ──
  { id: "chatport-amaterasu-python", archivo: "src/lib/ia/amaterasu/chat-python.ts", patron: /export function crearChat\w*/, que: "Amaterasu (análisis de foto/venue) vía Python: crearChatTurnoPython", envoltorio: "return envolverChatPort(port, { proposito: \"analisis_foto\" })", enganche: [{ archivo: "src/lib/ia/amaterasu/chat-python.ts", contiene: /envolverChatPort\(/ }] },
  { id: "chatport-omoikane-python", archivo: "src/lib/ia/omoikane/chat-python.ts", patron: /export function crearChat\w*/, que: "Omoikane (chat clásico/guiado) vía Python: crearChatGeminiPython", envoltorio: "chatOmoikaneDe() → envolverChatPort", enganche: [CHATPORT_CENTRAL] },
  // ── Bucles de herramientas ──
  { id: "herramientas-omoikane", archivo: "src/lib/ia/omoikane/ejecutar.ts", patron: /crearRegistroHerramientas\(/, que: "herramientas del chat clásico (buscar_catalogo_rag, armar_plan, ...)", envoltorio: "registro: envolverRegistroHerramientas(crearRegistroHerramientas(...))", enganche: [{ archivo: "src/lib/ia/omoikane/ejecutar.ts", contiene: /envolverRegistroHerramientas\(/ }] },
  { id: "bucle-chat-clasico", archivo: "src/app/api/chat/route.ts", patron: /ejecutarConversacionStream\(\s*\{/, que: "bucle de tool-calling del chat clásico", envoltorio: "cubierto por herramientas-omoikane + chatOmoikaneDe", enganche: [{ archivo: "src/lib/ia/omoikane/ejecutar.ts", contiene: /envolverRegistroHerramientas\(/ }, CHATPORT_CENTRAL] },
  { id: "herramientas-guiado", archivo: "src/app/api/asistente-guiado/route.ts", patron: /protegerHerramientas\(|ejecutarConversacionStream\(\s*\{/, que: "bucle y herramientas de la vista guiada (guardar_brief_guiado, buscar_decoraciones_sempertex, proponer_composicion, costear_decoracion, ...)", envoltorio: "registro: envolverRegistroHerramientas(protegerHerramientas(registro)) + conRegistro + decidir(...)", enganche: [{ archivo: "src/app/api/asistente-guiado/route.ts", contiene: /envolverRegistroHerramientas\(/ }, CHATPORT_CENTRAL] },
  // ── Dictado por voz (REQ-009): Whisper propio en el VPS ──
  { id: "voz-whisper-vps", archivo: "src/lib/voz/config.ts", patron: /VOZ_URL/, que: "dictado por voz: audio → texto con faster-whisper en el VPS (firmado con HMAC, sin coste por llamada; ni audio ni texto se guardan)", envoltorio: "ruta /api/voz/transcribir: auditarLlamadaIa({ proveedor: \"whisper-vps\", proposito: \"dictado_voz\" }, () => transcribirEnVps(...)) con auditarSalida apagado", enganche: [{ archivo: "src/app/api/voz/transcribir/route.ts", contiene: /auditarLlamadaIa\(/ }, { archivo: "src/app/api/voz/transcribir/route.ts", contiene: /proveedor:\s*"whisper-vps"/ }, { archivo: "src/app/api/voz/transcribir/route.ts", contiene: /auditarEntrada:\s*false,\s*auditarSalida:\s*false/ }] },
  // ── Operaciones del Python que ejecutan un modelo (consumidores) ──
  { id: "py-ia-intent-parse", archivo: "src/lib/ia/inari/parse.ts", patron: /llamarPythonIntentParse\(/, que: "parser de intención vía Python", envoltorio: "propositoIa(/ia/intent-parse) = \"parser_intencion\"", enganche: [PYTHON_CENTRAL, PYTHON_IA] },
  { id: "py-ia-happie", archivo: "src/lib/happie/generador-python.ts", patron: /llamarPythonHappieGenerate\(/, que: "Happie vía Python", envoltorio: "envolverFuncionIa en ia-recomendacion/conversacion-webhook (no duplicar en propositoIa)", enganche: [PYTHON_CENTRAL, { archivo: "src/lib/happie/ia-recomendacion.ts", contiene: /envolverFuncionIa\(/ }] },
  { id: "py-ia-reference-turn", archivo: "src/lib/ia/amaterasu/chat-python.ts", patron: /llamarPythonReferenceTurn\(/, que: "turno de Amaterasu vía Python", envoltorio: "envolverChatPort en crearChatTurnoPython", enganche: [PYTHON_CENTRAL, { archivo: "src/lib/ia/amaterasu/chat-python.ts", contiene: /envolverChatPort\(/ }] },
  { id: "py-ia-patron-referencia", archivo: "src/lib/ia/amaterasu/patron-referencia.ts", patron: /llamarPythonPatronReferencia\(/, que: "lectura del patrón de color de la foto (visión en Python)", envoltorio: "propositoIa = \"lectura_patron_foto\"", enganche: [PYTHON_CENTRAL, PYTHON_IA] },
  { id: "py-ia-bouquet-referencia", archivo: "src/lib/ia/amaterasu/bouquet-referencia.ts", patron: /llamarPythonBouquetReferencia\(/, que: "lectura de bouquet de la foto (visión en Python)", envoltorio: "propositoIa = \"lectura_bouquet_foto\"", enganche: [PYTHON_CENTRAL, PYTHON_IA] },
  { id: "py-ia-conteo-referencia", archivo: "src/lib/ia/amaterasu/conteo-referencia.ts", patron: /llamarPythonConteoReferencia\(/, que: "conteo de globos de la foto (visión en Python)", envoltorio: "propositoIa = \"conteo_foto\"", enganche: [PYTHON_CENTRAL, PYTHON_IA] },
  { id: "py-ia-guirnalda-referencia", archivo: "src/lib/ia/amaterasu/guirnalda-referencia.ts", patron: /llamarPythonGuirnaldaReferencia\(/, que: "lectura de guirnalda de la foto (visión en Python)", envoltorio: "propositoIa = \"lectura_guirnalda_foto\"", enganche: [PYTHON_CENTRAL, PYTHON_IA] },
  { id: "py-ia-lectura-unica", archivo: "src/lib/ia/amaterasu/lectura-unica.ts", patron: /llamarPythonLecturaUnica\(/, que: "lectura única de la foto: el Python solo VALIDA lo que escribió el análisis (sin modelo)", envoltorio: "evento `python` con el cuerpo completo (la visión es el reference-turn, con envolverChatPort)", enganche: [PYTHON_CENTRAL] },
  { id: "py-ia-flux", archivo: "src/lib/ia/kagutsuchi/flux.ts", patron: /llamarPythonFluxGenerate\(/, que: "FLUX vía Python (FLUX_GENERATION_PYTHON)", envoltorio: "auditarGeneracionImagen en generarConSempertexFlux (cubre ambas rutas)", enganche: [PYTHON_CENTRAL, { archivo: "src/lib/ia/kagutsuchi/flux.ts", contiene: /auditarGeneracionImagen\(/ }] },
  { id: "py-ia-chat-stream", archivo: "src/lib/ia/omoikane/chat-python.ts", patron: /llamarPythonChatTurnStream\(/, que: "turno de chat en streaming vía Python", envoltorio: "envolverChatPort en chatOmoikaneDe", enganche: [PYTHON_CENTRAL, CHATPORT_CENTRAL] },
  { id: "py-ia-embedding", archivo: "src/lib/rag/embeddings.ts", patron: /llamarPythonEmbedding\(/, que: "embeddings vía Python", envoltorio: "propositoIa(/embed) = \"embedding\"", enganche: [PYTHON_CENTRAL, PYTHON_IA] },
];

/** Detectores de llamadas crudas. Cualquier línea que coincida en código de servidor debe estar inventariada. */
const DETECTORES: ReadonlyArray<{ id: string; re: RegExp }> = [
  { id: "sdk-gemini-cliente", re: /\bnew\s+GoogleGenAI\s*\(/ },
  { id: "sdk-gemini-llamada", re: /\.models\.(generateContent|generateContentStream|embedContent|generateImages|generateVideos|countTokens|computeTokens)\s*\(/ },
  { id: "sdk-otro-proveedor", re: /from\s+["'](openai|@anthropic-ai\/sdk|@fal-ai\/[\w-]+|replicate|groq-sdk|@mistralai\/[\w-]+|cohere-ai|ollama|@google-cloud\/vertexai|@ai-sdk\/[\w-]+|ai)["']/ },
  { id: "host-proveedor-ia", re: /(queue\.)?fal\.run\b|rest\.alpha\.fal\.ai|generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com|api\.openai\.com|api\.anthropic\.com|api\.replicate\.com|api\.groq\.com|openrouter\.ai/ },
  // Cada llamada a Claude: la del SDK (`client.messages.create/stream`) y la del transporte propio, que tiene la misma forma.
  { id: "llamada-anthropic", re: /\.messages\.(create|stream|countTokens|batches\.create)\s*\(/ },
  { id: "cliente-anthropic", re: /(?<!function\s+)\bcrearClienteAnthropic\s*\(/ },
  { id: "cliente-claude-cli", re: /(?<!function\s+)\bcrearClienteClaudeCli\s*\(/ },
  { id: "proceso-hijo", re: /\b(spawnSync|execFileSync|execSync)\s*\(|from\s+["'](node:)?child_process["']/ },
  { id: "transporte-python", re: /\(input\.fetchImpl\s*\?\?\s*fetch\)|\benv\.PYTHON_BACKEND_URL\b|["'`]\/internal\/v1\// },
  { id: "fabrica-chatport", re: /export\s+(async\s+)?function\s+crearChat\w*\s*\(/ },
  { id: "bucle-herramientas", re: /\bejecutarConversacion(Stream)?\s*\(\s*\{/ },
  { id: "registro-herramientas", re: /(?<!function\s+)\b(crearRegistroHerramientas|protegerHerramientas)\s*\(/ },
  { id: "transcripcion-voz", re: /VOZ_URL/ },
  { id: "python-con-modelo", re: /(?<!function\*?\s+)\bllamarPython(IntentParse|HappieGenerate|ReferenceTurn|PatronReferencia|BouquetReferencia|ConteoReferencia|GuirnaldaReferencia|LecturaUnica|FluxGenerate|ChatTurnStream|Embedding)\s*\(/ },
];

/** Rutas /api del flujo (entrada/salida auditadas con conRegistro). */
const RUTAS_FLUJO: Readonly<Record<string, string>> = {
  "src/app/api/chat/route.ts": "chat clásico (y consultas de la vista guiada a /api/chat)",
  "src/app/api/asistente-guiado/route.ts": "turno de la vista guiada",
  "src/app/api/generate/route.ts": "imagen FLUX, venue, guía de escena",
  "src/app/api/generate/recuperar/route.ts": "recupera la imagen de una solicitud cortada (sin generar otra)",
  "src/app/api/references/analyze/route.ts": "análisis de la foto de referencia (Amaterasu)",
  "src/app/api/guiada-imagen/route.ts": "guarda la imagen generada de la vista guiada",
  "src/app/api/plan-editar/route.ts": "edición del plan (catálogo, Python)",
  "src/app/api/plan-patron/route.ts": "vista previa de patrón (Python)",
  "src/app/api/plan-armado-arco/route.ts": "armado (Python)",
  "src/app/api/plan-armado-arco-organico/route.ts": "armado (Python)",
  "src/app/api/plan-armado-bouquet/route.ts": "armado (Python)",
  "src/app/api/plan-armado-columna/route.ts": "armado (Python)",
  "src/app/api/plan-armado-columna-organica/route.ts": "armado (Python)",
  "src/app/api/plan-armado-guirnalda/route.ts": "armado (Python)",
  "src/app/api/plan-armado-guirnalda-organica/route.ts": "armado (Python)",
  "src/app/api/plan-dibujo-estructura/route.ts": "dibujo de estructura (Python)",
  "src/app/api/plan-idea/route.ts": "plan exacto de una idea de la biblioteca (Python, sin modelo)",
  "src/app/api/cotizacion-profesional/route.ts": "cotización (Python)",
  "src/app/api/catalogo/piezas/route.ts": "búsqueda de piezas del catálogo (vista clásica)",
  "src/app/api/happie/recomendar/route.ts": "Happie (IA)",
  "src/app/api/happie/recomendar-pasos/route.ts": "Happie (IA)",
  "src/app/api/happie/recommend-package/route.ts": "Happie externo (IA)",
  "src/app/api/happie/recommend-packages/route.ts": "Happie externo (IA)",
  "src/app/api/happie/webhook/chat/route.ts": "Happie webhook (IA)",
  "src/app/api/happie/webhook/recommend-package/route.ts": "Happie webhook (IA)",
  "src/app/api/happie/webhook/recommend-packages/route.ts": "Happie webhook (IA)",
  "src/app/api/admin/ordenes/manual/route.ts": "caption de orden con opencode (IA)",
  "src/app/api/admin/ordenes/[numero]/recaption/route.ts": "caption de orden con opencode (IA)",
  "src/app/api/internal/ai/echo/route.ts": "eco Next → Python (diagnóstico)",
  "src/app/api/escena-ia/route.ts": "taller 3D: la IA arma la escena con herramientas (Gemini texto; Claude solo en local)",
  "src/app/api/escena-ia/similitud/route.ts": "taller 3D: criterio de aceptación del refinado (embeddings de imagen con Gemini: foto vs capturas)",
  "src/app/api/escena-desde-foto/route.ts": "taller 3D: foto de una decoración → escena (Gemini visión lee la foto; embedding de imagen para las plantillas)",
  "src/app/api/render-3d-imagen/route.ts": "taller 3D: foto con IA (FLUX)",
  "src/app/api/modulos-render/route.ts": "estudio de módulos: render con IA (FLUX) con caché por clave canónica (REQ-011)",
  "src/app/api/modulos-interpretar/route.ts": "estudio de módulos: pedido en palabras → configuración (Gemini texto, sin imágenes)",
  "src/app/api/voz/transcribir/route.ts": "dictado por voz (REQ-009): Whisper en el VPS, proveedor «whisper-vps»",
  "src/app/api/taller/buscar/route.ts": "taller 3D: búsqueda en la biblioteca (RAG; embedding de la consulta con Gemini)",
  "src/app/api/taller/buscar-foto/route.ts": "taller 3D: búsqueda por foto en la biblioteca (embedding de imagen con Gemini)",
  "src/app/api/guiada/motor/route.ts": "REQ-007: bandera GUIADA_MOTOR (3d|python) con la que se crea un plan de la guiada; la lectura para un plan nuevo queda en decidir(regla:motor_guiada)",
  "src/app/api/taller/hoja-armado/route.ts": "PRO-01: bandera taller_hoja_armado del Taller 3D (lectura con sesión, sin IA)",
  "src/app/api/catalogo/repositorios/route.ts": "REQ-013 fase 5: manifiestos de los repositorios, los que ve el Taller y la bandera de la interfaz por repositorio (lectura con sesión, sin IA)",
  "src/app/api/guiada/motor/plan/route.ts": "REQ-007 fase 2: plan de la guiada armado por el motor 3D (sin modelo ni RAG) y cotizado con Python (lista-materiales); el motivo de cada caída a Python queda en decidir(regla:motor_guiada)",
  "src/app/api/guiada/motor/armada/route.ts": "REQ-007 fase 3: la armada (o el SVG de reserva) del plan 3D para la vista del cliente; solo vuelve a armar la espec firmada, sin modelo, RAG ni Python",
  "src/app/api/guiada/motor/editar/route.ts": "REQ-007 fase 5: los cambios del cliente a un plan del motor 3D (colores, proporciones, tamaños, piezas): aplica la edición a la espec firmada, rearma solo lo que cambió y cotiza con Python (lista-materiales); sin modelo ni RAG; el motivo de cada rechazo queda en decidir(regla:motor_guiada)",
  "src/app/api/guiada/motor/imagen/route.ts": "REQ-007 fase 4: «Ver cómo quedaría» del plan 3D; vuelve a armar la espec firmada y la pasa por FLUX.1 Kontext max (generarConFluxKontext, que audita la generación y registra la telemetría con superficie guiada-3d); sin Python ni modelo de texto; entrada, prompt y salida en el registro",
  "src/app/api/feedback-ia/route.ts": "REQ-010: calificación de un turno de la IA (taller y chat del cliente)",
  "src/app/api/feedback-ia/capturas/route.ts": "REQ-010: captura JPEG antes/después de un turno (almacén S3)",
  "src/app/api/feedback-ia/analisis/route.ts": "REQ-010: análisis de huecos a pedido (resumen opcional con Gemini Flash)",
  "src/app/api/feedback-ia/analisis-cron/route.ts": "REQ-010: análisis semanal de huecos desde un cron (resumen opcional con Gemini Flash)",
};

/** Rutas /api fuera del flujo de decisiones, con el motivo. Una ruta nueva debe clasificarse aquí o arriba. */
const RUTAS_EXCLUIDAS: Readonly<Record<string, string>> = {
  "src/app/api/registro-cliente/route.ts": "es el propio registro",
  "src/app/api/login/route.ts": "autenticación (no registrar credenciales)",
  "src/app/api/ia/salud/route.ts": "estado de configuración, sin decisiones",
  "src/app/api/ia/proveedor/route.ts": "ajuste de proveedor (admin)",
  "src/app/api/catalogo/imagenes/route.ts": "imágenes del catálogo (lectura)",
  "src/app/api/guiada-imagen/[id]/route.ts": "sirve una imagen guardada",
  "src/app/api/laboratorio-referencias/route.ts": "laboratorio deshabilitado",
  "src/app/api/rag/webhooks/shopify/route.ts": "sincronización de catálogo (servidor a servidor)",
  "src/app/api/shopify/sync/route.ts": "sincronización de catálogo (admin)",
  "src/app/api/happie/opciones/route.ts": "opciones estáticas de Happie",
  "src/app/api/productos/route.ts": "CRUD admin",
  "src/app/api/productos/[id]/route.ts": "CRUD admin",
  "src/app/api/decoraciones/route.ts": "CRUD admin",
  "src/app/api/decoraciones/[id]/route.ts": "CRUD admin",
  "src/app/api/admin/arquitectura/route.ts": "CRUD admin",
  "src/app/api/admin/ordenes/route.ts": "CRUD admin",
  "src/app/api/admin/ordenes/[numero]/route.ts": "CRUD admin",
  "src/app/api/admin/ordenes/[numero]/caption/route.ts": "edición manual del caption",
  "src/app/api/admin/ordenes/[numero]/feedback/route.ts": "feedback manual",
  "src/app/api/admin/ordenes/[numero]/foto/route.ts": "sirve una foto",
  "src/app/api/admin/ordenes/catalogo-buscar/route.ts": "búsqueda admin",
  "src/app/api/admin/ordenes/estadisticas/route.ts": "estadísticas admin",
  "src/app/api/feedback-ia/admin/route.ts": "REQ-010: listado y exportación del panel (solo administrador, lectura)",
  "src/app/api/feedback-ia/admin/[id]/route.ts": "REQ-010: detalle de un turno calificado (solo administrador, lectura)",
  "src/app/api/feedback-ia/admin/imagen/route.ts": "REQ-010: sirve una captura del almacén (solo administrador)",
  "src/app/api/feedback-ia/admin/sesion/route.ts": "REQ-010: clave de administrador del panel (autenticación: no registrar credenciales)",
};

/** Código del navegador que llama a rutas del flujo: debe mandar x-conversacion-id. */
const CLIENTES_FLUJO: Readonly<Record<string, string>> = {
  "src/app/page.tsx": "vista clásica: /api/chat, /api/generate, /api/catalogo/piezas (vaciar: limpiarTodo)",
  "src/components/guiado/VistaGuiada.tsx": "vista guiada: /api/asistente-guiado, /api/generate, /api/chat, /api/references/analyze, /api/guiada-imagen (vaciar: vaciar)",
  "src/components/guiado/GraficaMotorGuiada.tsx": "armados /api/plan-armado-*",
  "src/lib/generacion/pedir-imagen.ts": "«Ver cómo quedaría» de la guiada: /api/generate, /api/guiada/motor/imagen (plan 3D) y /api/generate/recuperar",
  "src/components/references/ReferenceAnalysisController.tsx": "/api/references/analyze",
  "src/lib/plan/peticion-armado.ts": "publicar(): /api/plan-armado-*",
  "src/lib/plan/peticion-patron.ts": "publicar(): /api/plan-patron",
  "src/lib/plan/peticion-plan-editar.ts": "/api/plan-editar",
  "src/lib/cotizacion/borrador-profesional.ts": "/api/cotizacion-profesional",
};
const INTERCEPTOR_FETCH: Enganche = { archivo: "src/components/registro/CapturaErroresCliente.tsx", contiene: /instalarCabecerasConversacionEnFetch\(/ };

/**
 * Enganches de la conversación sin los que la auditoría queda partida o sin contexto: cada vista abre su id al montar
 * y lo renueva al vaciar; la ruta guiada se registra como vista «guiada» con su request_id alineado; el Python lee
 * x-conversacion-id y escribe sus llamadas a modelos como JSON.
 */
const ENGANCHES_CONVERSACION: ReadonlyArray<Enganche & { que: string }> = [
  { archivo: "src/components/guiado/VistaGuiada.tsx", contiene: /abrirConversacionGuiada\(/, que: "vista guiada: id de conversación al montar" },
  { archivo: "src/components/guiado/VistaGuiada.tsx", contiene: /vaciarConversacionGuiada\(/, que: "vista guiada: conversación nueva al vaciar" },
  { archivo: "src/components/guiado/VistaGuiada.tsx", contiene: /registrarFallo\("sse\.fallo"|"sse\.fallo"/, que: "vista guiada: fallos del SSE con instantánea" },
  { archivo: "src/app/page.tsx", contiene: /obtenerIdConversacion\("clasica"\)/, que: "vista clásica: id de conversación al montar" },
  { archivo: "src/app/page.tsx", contiene: /nuevaConversacion\("clasica"\)/, que: "vista clásica: conversación nueva al vaciar" },
  { archivo: "src/app/api/asistente-guiado/route.ts", contiene: /conRegistro\([^)]*vista:\s*"guiada"/, que: "ruta guiada con vista «guiada»" },
  { archivo: "src/app/api/asistente-guiado/route.ts", contiene: /contextoActual\(\)\?\.solicitud/, que: "ruta guiada: request_id alineado con la auditoría" },
  { archivo: "services/ai-api/app/registro.py", contiene: /x-conversacion-id/, que: "Python: lee x-conversacion-id" },
  { archivo: "services/ai-api/app/main.py", contiene: /instalar_registro\(/, que: "Python: middleware de registro instalado" },
];

/* ---------- Recorrido ---------- */

function relativo(absoluto: string): string {
  return path.relative(RAIZ, absoluto).split(path.sep).join("/");
}

function listar(carpeta: string, salida: string[] = []): string[] {
  if (!existsSync(carpeta)) return salida;
  for (const nombre of readdirSync(carpeta)) {
    if (nombre === "node_modules" || nombre === "dist" || nombre.startsWith(".")) continue;
    const ruta = path.join(carpeta, nombre);
    if (statSync(ruta).isDirectory()) listar(ruta, salida);
    else if (/\.(ts|tsx)$/.test(nombre) && !/\.test\.tsx?$/.test(nombre)) salida.push(ruta);
  }
  return salida;
}

const cache = new Map<string, string>();
function leer(archivo: string): string {
  let contenido = cache.get(archivo);
  if (contenido === undefined) {
    const absoluto = path.resolve(RAIZ, archivo);
    contenido = existsSync(absoluto) ? readFileSync(absoluto, "utf8") : "";
    cache.set(archivo, contenido);
  }
  return contenido;
}

function cumple(enganche: Enganche): boolean {
  return enganche.contiene.test(leer(enganche.archivo));
}

function esCliente(contenido: string): boolean {
  return /^\s*["']use client["']/.test(contenido);
}

interface Hallazgo {
  archivo: string;
  linea: number;
  texto: string;
  detector: string;
}

function principal(): void {
  const archivos = [
    ...listar(path.join(RAIZ, "src")),
    ...listar(path.join(RAIZ, "packages", "agente-core", "src")),
    ...listar(path.join(RAIZ, "packages", "happie-package-ia", "src")),
    // Solo para probar la propia guardia: una carpeta extra (fuera del repo) que se escanea como código de servidor.
    ...(process.env.REGISTRO_GUARDIA_EXTRA ? listar(path.resolve(process.env.REGISTRO_GUARDIA_EXTRA)) : []),
  ].map(relativo).filter((archivo) => !archivo.startsWith("src/lib/registro/"));

  const sinInventario: Hallazgo[] = [];
  const usados = new Map<string, Hallazgo[]>();
  for (const archivo of archivos) {
    const contenido = leer(archivo);
    if (esCliente(contenido)) continue;
    contenido.split(/\r?\n/).forEach((linea, indice) => {
      if (/^\s*(\*|\/\/)/.test(linea)) return;
      for (const detector of DETECTORES) {
        if (!detector.re.test(linea)) continue;
        const hallazgo: Hallazgo = { archivo, linea: indice + 1, texto: linea.trim().slice(0, 140), detector: detector.id };
        const punto = INVENTARIO.find((entrada) => entrada.archivo === archivo && entrada.patron.test(linea));
        if (!punto) sinInventario.push(hallazgo);
        else usados.set(punto.id, [...(usados.get(punto.id) ?? []), hallazgo]);
        break;
      }
    });
  }

  const pendientes: string[] = [];
  const obsoletos: string[] = [];
  console.log("INVENTARIO de puntos de IA / proveedores (archivo:línea → envoltorio):\n");
  for (const punto of INVENTARIO) {
    const lineas = usados.get(punto.id) ?? [];
    const envuelto = punto.enganche.every(cumple);
    const estado = !lineas.length ? "OBSOLETO" : envuelto ? "envuelto" : "PENDIENTE";
    if (estado === "PENDIENTE") pendientes.push(punto.id);
    if (estado === "OBSOLETO") obsoletos.push(punto.id);
    console.log(`  [${estado.padEnd(9)}] ${punto.id} — ${punto.que}`);
    console.log(`      ${lineas.map((hallazgo) => `${hallazgo.archivo}:${hallazgo.linea}`).join(", ") || punto.archivo}`);
    console.log(`      → ${punto.envoltorio}`);
    if (!envuelto) console.log(`      falta: ${punto.enganche.filter((enganche) => !cumple(enganche)).map((enganche) => `${enganche.archivo} ∌ ${enganche.contiene.source}`).join("; ")}`);
  }

  console.log("\nRUTAS /api del flujo (conRegistro):");
  const rutas = listar(path.join(RAIZ, "src", "app", "api")).map(relativo).filter((archivo) => archivo.endsWith("/route.ts"));
  const rutasSinClasificar = rutas.filter((ruta) => !(ruta in RUTAS_FLUJO) && !(ruta in RUTAS_EXCLUIDAS));
  for (const [ruta, que] of Object.entries(RUTAS_FLUJO)) {
    if (!rutas.includes(ruta)) {
      obsoletos.push(ruta);
      console.log(`  [OBSOLETO ] ${ruta}`);
      continue;
    }
    const envuelta = /conRegistro\(/.test(leer(ruta));
    if (!envuelta) pendientes.push(ruta);
    console.log(`  [${(envuelta ? "envuelta" : "PENDIENTE").padEnd(9)}] ${ruta} — ${que}`);
  }

  console.log("\nNAVEGADOR → x-conversacion-id:");
  const interceptor = cumple(INTERCEPTOR_FETCH);
  for (const [archivo, que] of Object.entries(CLIENTES_FLUJO)) {
    const listo = interceptor || /cabecerasConversacion\(/.test(leer(archivo));
    if (!leer(archivo)) obsoletos.push(archivo);
    else if (!listo) pendientes.push(archivo);
    console.log(`  [${(listo ? "listo" : "PENDIENTE").padEnd(9)}] ${archivo} — ${que}`);
  }
  if (!interceptor) console.log(`  (alternativa central: ${INTERCEPTOR_FETCH.archivo} con instalarCabecerasConversacionEnFetch())`);

  console.log("\nENGANCHES DE LA CONVERSACIÓN:");
  for (const enganche of ENGANCHES_CONVERSACION) {
    const listo = cumple(enganche);
    if (!listo) pendientes.push(`${enganche.archivo} (${enganche.que})`);
    console.log(`  [${(listo ? "listo" : "PENDIENTE").padEnd(9)}] ${enganche.archivo} — ${enganche.que}`);
  }

  let fallo = false;
  if (sinInventario.length) {
    fallo = true;
    console.error("\n✖ LLAMADAS A IA / PROVEEDORES SIN INVENTARIO NI ENVOLTORIO:");
    for (const hallazgo of sinInventario) console.error(`  ${hallazgo.archivo}:${hallazgo.linea} [${hallazgo.detector}] ${hallazgo.texto}`);
    console.error("  Envuélvela con src/lib/registro (envoltorios.ts) y añádela a INVENTARIO en este archivo.");
  }
  if (rutasSinClasificar.length) {
    fallo = true;
    console.error("\n✖ RUTAS /api SIN CLASIFICAR (añádelas a RUTAS_FLUJO con conRegistro, o a RUTAS_EXCLUIDAS con el motivo):");
    for (const ruta of rutasSinClasificar) console.error(`  ${ruta}`);
  }
  if (ESTRICTO && (pendientes.length || obsoletos.length)) {
    fallo = true;
    console.error(`\n✖ Modo estricto: ${pendientes.length} pendientes y ${obsoletos.length} obsoletos.`);
  }
  console.log(`\nResumen: ${INVENTARIO.length} puntos inventariados, ${pendientes.length} pendientes de envolver, ${obsoletos.length} obsoletos, ${sinInventario.length} sin inventario, ${rutasSinClasificar.length} rutas sin clasificar${ESTRICTO ? " (estricto)" : ""}.`);
  if (fallo) process.exit(1);
  console.log(ESTRICTO ? "[PASS] todo envuelto" : "[PASS] ningún punto nuevo sin inventario (modo no estricto: REGISTRO_GUARDIA_ESTRICTA=0)");
}

principal();
