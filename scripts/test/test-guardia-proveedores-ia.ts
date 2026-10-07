/**
 * GUARDIA: ninguna llamada a un proveedor de IA (ni decisión de un modelo) sin pasar por un envoltorio de
 * src/lib/registro. Sin red ni coste:
 *
 *   npx tsx scripts/test/test-guardia-proveedores-ia.ts             # falla si aparece un punto NO inventariado
 *   npx tsx scripts/test/test-guardia-proveedores-ia.ts --estricto  # además falla con los PENDIENTES (2.ª pasada)
 *
 * Cómo funciona: detecta en el código de servidor (src/, packages/*\/src) las formas crudas de llamar a una IA
 * (SDK de Gemini u otros, hosts de proveedores, procesos hijo, transporte al Python, fábricas de ChatPort,
 * bucles de herramientas, operaciones del Python que ejecutan un modelo). Cada línea detectada debe estar en
 * INVENTARIO con su punto de enganche; el punto está «envuelto» cuando el archivo de enganche contiene el
 * envoltorio. Lo mismo para las rutas /api (conRegistro) y para los fetch del navegador que deben llevar el id
 * de conversación. La segunda pasada debe terminar con `--estricto` en verde y cambiar ESTRICTO_POR_DEFECTO.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ESTRICTO_POR_DEFECTO = false;
const RAIZ = path.resolve(__dirname, "..", "..");
const ESTRICTO = ESTRICTO_POR_DEFECTO || process.argv.includes("--estricto") || process.env.REGISTRO_GUARDIA_ESTRICTA === "1";

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
const PYTHON_CENTRAL: Enganche = { archivo: "src/lib/ia/nucleo/python-adapter.ts", contiene: /crearFetchAuditado\(/ };
const PYTHON_IA: Enganche = { archivo: "src/lib/ia/nucleo/python-adapter.ts", contiene: /propositoIa\s*:/ };
const PYTHON_CONVERSACION: Enganche = { archivo: "src/lib/ia/nucleo/python-adapter.ts", contiene: /x-conversacion-id|cabecerasCorrelacion\(/ };

/** Todas las llamadas a proveedores / decisiones de modelos del servidor, con su enganche propuesto. */
export const INVENTARIO: readonly Punto[] = [
  // ── Gemini directo (@google/genai) ──
  { id: "gemini-cliente", archivo: "src/lib/gemini.ts", patron: /new\s+GoogleGenAI/, que: "cliente compartido getGeminiClient()", envoltorio: "getGeminiClient(proposito) → envolverClienteGemini(cliente, { proposito })", enganche: [GEMINI_CENTRAL] },
  { id: "gemini-parser-intencion", archivo: "src/lib/ia/inari/parse.ts", patron: /\.models\.generateContent\(/, que: "Inari: parser de intención (JSON) cuando INTENT_PARSER_PYTHON está apagado", envoltorio: "getGeminiClient(\"parser_intencion\")", enganche: [GEMINI_CENTRAL] },
  { id: "gemini-traduccion-revision", archivo: "src/app/api/generate/route.ts", patron: /\.models\.generateContent\(/, que: "traducción al inglés de la revisión pedida para FLUX", envoltorio: "getGeminiClient(\"traduccion_revision\")", enganche: [GEMINI_CENTRAL] },
  { id: "gemini-embedding", archivo: "src/lib/rag/embeddings.ts", patron: /\.models\.embedContent\(/, que: "embeddings de consulta/documento (RAG)", envoltorio: "getGeminiClient(\"embedding\")", enganche: [GEMINI_CENTRAL] },
  // ── @sempertex/agente-core (paquete): adaptador Gemini del ChatPort ──
  { id: "agente-core-cliente", archivo: "packages/agente-core/src/gemini/chat.ts", patron: /new\s+GoogleGenAI|export function crearChatGemini/, que: "ChatPort Gemini (chat clásico, guiado, Amaterasu, venue)", envoltorio: "chatDe()/chatOmoikaneDe() → envolverChatPort(port, { proposito })", enganche: [CHATPORT_CENTRAL] },
  { id: "agente-core-turno", archivo: "packages/agente-core/src/gemini/chat.ts", patron: /\.models\.generateContent(Stream)?\(/, que: "turno y turno en streaming del ChatPort Gemini", envoltorio: "envolverChatPort (cubre turno y turnoStream)", enganche: [CHATPORT_CENTRAL] },
  // ── @sempertex/happie-package-ia (paquete) ──
  { id: "happie-gemini", archivo: "packages/happie-package-ia/src/recomendador.ts", patron: /new\s+GoogleGenAI|\.models\.generateContent\(/, que: "Happie: recomendación/extracción estructurada (crearGeneradorGemini y su uso por defecto si `generar` falta)", envoltorio: "pasar SIEMPRE generar: envolverFuncionIa(generador, { proveedor, proposito: \"happie\" })", enganche: [{ archivo: "src/lib/happie/ia-recomendacion.ts", contiene: /envolverFuncionIa\(/ }, { archivo: "src/lib/happie/conversacion-webhook.ts", contiene: /envolverFuncionIa\(/ }] },
  // ── fal / FLUX directo ──
  { id: "fal-flux", archivo: "src/lib/ia/kagutsuchi/flux.ts", patron: /queue\.fal\.run|rest\.alpha\.fal\.ai/, que: "FLUX en fal (cola submit → status → result → descarga)", envoltorio: "generarConSempertexFlux → auditarGeneracionImagen(...); fetchFalAllowed → crearFetchAuditado(fetch, { tipo: \"http\", proveedor: \"fal\", omitir: sondeos de estado })", enganche: [{ archivo: "src/lib/ia/kagutsuchi/flux.ts", contiene: /auditarGeneracionImagen\(/ }, { archivo: "src/lib/ia/kagutsuchi/flux.ts", contiene: /crearFetchAuditado\(/ }] },
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
  // ── Operaciones del Python que ejecutan un modelo (consumidores) ──
  { id: "py-ia-intent-parse", archivo: "src/lib/ia/inari/parse.ts", patron: /llamarPythonIntentParse\(/, que: "parser de intención vía Python", envoltorio: "propositoIa(/ia/intent-parse) = \"parser_intencion\"", enganche: [PYTHON_CENTRAL, PYTHON_IA] },
  { id: "py-ia-happie", archivo: "src/lib/happie/generador-python.ts", patron: /llamarPythonHappieGenerate\(/, que: "Happie vía Python", envoltorio: "envolverFuncionIa en ia-recomendacion/conversacion-webhook (no duplicar en propositoIa)", enganche: [PYTHON_CENTRAL, { archivo: "src/lib/happie/ia-recomendacion.ts", contiene: /envolverFuncionIa\(/ }] },
  { id: "py-ia-reference-turn", archivo: "src/lib/ia/amaterasu/chat-python.ts", patron: /llamarPythonReferenceTurn\(/, que: "turno de Amaterasu vía Python", envoltorio: "envolverChatPort en crearChatTurnoPython", enganche: [PYTHON_CENTRAL, { archivo: "src/lib/ia/amaterasu/chat-python.ts", contiene: /envolverChatPort\(/ }] },
  { id: "py-ia-patron-referencia", archivo: "src/lib/ia/amaterasu/patron-referencia.ts", patron: /llamarPythonPatronReferencia\(/, que: "lectura del patrón de color de la foto (visión en Python)", envoltorio: "propositoIa = \"lectura_patron_foto\"", enganche: [PYTHON_CENTRAL, PYTHON_IA] },
  { id: "py-ia-bouquet-referencia", archivo: "src/lib/ia/amaterasu/bouquet-referencia.ts", patron: /llamarPythonBouquetReferencia\(/, que: "lectura de bouquet de la foto (visión en Python)", envoltorio: "propositoIa = \"lectura_bouquet_foto\"", enganche: [PYTHON_CENTRAL, PYTHON_IA] },
  { id: "py-ia-conteo-referencia", archivo: "src/lib/ia/amaterasu/conteo-referencia.ts", patron: /llamarPythonConteoReferencia\(/, que: "conteo de globos de la foto (visión en Python)", envoltorio: "propositoIa = \"conteo_foto\"", enganche: [PYTHON_CENTRAL, PYTHON_IA] },
  { id: "py-ia-guirnalda-referencia", archivo: "src/lib/ia/amaterasu/guirnalda-referencia.ts", patron: /llamarPythonGuirnaldaReferencia\(/, que: "lectura de guirnalda de la foto (visión en Python)", envoltorio: "propositoIa = \"lectura_guirnalda_foto\"", enganche: [PYTHON_CENTRAL, PYTHON_IA] },
  { id: "py-ia-lectura-unica", archivo: "src/lib/ia/amaterasu/lectura-unica.ts", patron: /llamarPythonLecturaUnica\(/, que: "lectura única de la foto (visión en Python)", envoltorio: "propositoIa = \"lectura_unica_foto\"", enganche: [PYTHON_CENTRAL, PYTHON_IA] },
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
  { id: "proceso-hijo", re: /\b(spawnSync|execFileSync|execSync)\s*\(|from\s+["'](node:)?child_process["']/ },
  { id: "transporte-python", re: /\(input\.fetchImpl\s*\?\?\s*fetch\)|\benv\.PYTHON_BACKEND_URL\b|["'`]\/internal\/v1\// },
  { id: "fabrica-chatport", re: /export\s+(async\s+)?function\s+crearChat\w*\s*\(/ },
  { id: "bucle-herramientas", re: /\bejecutarConversacion(Stream)?\s*\(\s*\{/ },
  { id: "registro-herramientas", re: /(?<!function\s+)\b(crearRegistroHerramientas|protegerHerramientas)\s*\(/ },
  { id: "python-con-modelo", re: /(?<!function\*?\s+)\bllamarPython(IntentParse|HappieGenerate|ReferenceTurn|PatronReferencia|BouquetReferencia|ConteoReferencia|GuirnaldaReferencia|LecturaUnica|FluxGenerate|ChatTurnStream|Embedding)\s*\(/ },
];

/** Rutas /api del flujo (entrada/salida auditadas con conRegistro). */
const RUTAS_FLUJO: Readonly<Record<string, string>> = {
  "src/app/api/chat/route.ts": "chat clásico (y consultas de la vista guiada a /api/chat)",
  "src/app/api/asistente-guiado/route.ts": "turno de la vista guiada",
  "src/app/api/generate/route.ts": "imagen FLUX, venue, guía de escena",
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
};

/** Código del navegador que llama a rutas del flujo: debe mandar x-conversacion-id. */
const CLIENTES_FLUJO: Readonly<Record<string, string>> = {
  "src/app/page.tsx": "vista clásica: /api/chat, /api/generate, /api/catalogo/piezas (vaciar: limpiarTodo)",
  "src/components/guiado/VistaGuiada.tsx": "vista guiada: /api/asistente-guiado, /api/generate, /api/chat, /api/references/analyze, /api/guiada-imagen (vaciar: vaciar)",
  "src/components/guiado/GraficaMotorGuiada.tsx": "armados /api/plan-armado-*",
  "src/components/references/ReferenceAnalysisController.tsx": "/api/references/analyze",
  "src/lib/plan/peticion-armado.ts": "publicar(): /api/plan-armado-*",
  "src/lib/plan/peticion-patron.ts": "publicar(): /api/plan-patron",
  "src/lib/plan/peticion-plan-editar.ts": "/api/plan-editar",
  "src/lib/cotizacion/borrador-profesional.ts": "/api/cotizacion-profesional",
};
const INTERCEPTOR_FETCH: Enganche = { archivo: "src/components/registro/CapturaErroresCliente.tsx", contiene: /instalarCabecerasConversacionEnFetch\(/ };

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
  console.log(ESTRICTO ? "[PASS] todo envuelto" : "[PASS] ningún punto nuevo sin inventario (usa --estricto tras la segunda pasada)");
}

principal();
