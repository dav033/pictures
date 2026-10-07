/**
 * REGISTRO Y AUDITORÍA DEL SERVIDOR (src/lib/registro). Solo tipos: este archivo lo puede importar el
 * navegador (`import type`) sin arrastrar nada de Node.
 *
 * ── Para qué ──────────────────────────────────────────────────────────────────────────────────────
 * 1. Registro general: una línea JSON por evento, para depurar (qué ruta, cuánto tardó, qué falló).
 * 2. Auditoría por conversación: la traza COMPLETA de qué llegó, qué se le mandó a cada IA, qué contestó,
 *    qué herramientas corrieron, qué se decidió, qué se pidió al Python / a fal y qué salió al cliente.
 *    Ninguna decisión de una IA debe quedar sin una línea `llamada_ia` + `respuesta_ia` en el servidor.
 *
 * ── Dónde queda ───────────────────────────────────────────────────────────────────────────────────
 *   <raíz>/general/next-AAAA-MM-DD.jsonl                       (fecha UTC; retención 14 días)
 *   <raíz>/conversaciones/AAAA-MM-DD/<idConversacion>.jsonl    (retención 30 días; tope 25 MB por archivo)
 *   raíz = REGISTRO_DIR, o <DATA_DIR>/registros: local `data/registros`, VPS `/app/data/registros`
 *   (volumen persistente), Vercel `/tmp/demo-decoracion-data/registros` (efímero: allí manda stdout).
 *   Si la raíz no se puede escribir, se degrada a `<os.tmpdir()>/demo-decoracion-registros` y se avisa una
 *   vez con el evento `registro.dir_degradado`; si tampoco, solo stdout. Nunca lanza.
 *   El id de conversación se sanea a [a-zA-Z0-9_-] y ≤64; sin id: `sin-conversacion-<solicitud>`.
 *   Una conversación que cruza la medianoche sigue en el archivo del día en que empezó (mientras el
 *   proceso viva); el lector (`npm run registros`) junta todos los días igualmente.
 *
 * ── Línea general ─────────────────────────────────────────────────────────────────────────────────
 *   {ts, nivel, servicio:"next", entorno, version, evento, solicitud?, conversacion?, vista?, ruta?, ms?, datos?, error?}
 *   `version` = commit del código (12 caracteres; «+local» en desarrollo): ver version.ts.
 *   Cada evento de auditoría deja además aquí un resumen `auditoria.<tipo>` sin cargas grandes.
 *
 * ── Línea de auditoría (archivo de la conversación) ───────────────────────────────────────────────
 *   {ts, seq, tipo, version, solicitud, conversacion, vista?, ruta?, ms?, datos}
 *
 * ── Taxonomía (tipo → campos de `datos`) ──────────────────────────────────────────────────────────
 *   entrada_usuario  metodo, texto (último mensaje del usuario), adjuntos [{imagen:sha256, bytes, mime}],
 *                    estadoCliente (lo que el cliente dice que tiene), cuerpo (petición completa redactada)
 *   llamada_ia       llamada (id que la empareja con su respuesta), proveedor, modelo, proposito
 *                    ("chat_guiado", "chat_clasico", "analisis_foto", "analisis_venue", "parser_intencion",
 *                    "embedding", "traduccion_revision", "caption_flux", "caption_orden", "happie", "juez"…),
 *                    sistema {sha256, caracteres, version?, texto? (solo la 1.ª vez que ese sha aparece en la
 *                    conversación)}, mensajes (cada uno completo la 1.ª vez; después {ref: sha}),
 *                    herramientas (esquemas completos la 1.ª vez; después {nombres, ref}), parametros,
 *                    banderas (banderas de IA y modelos configurados; completas la 1.ª vez, después {ref})
 *   respuesta_ia     llamada, proveedor, modelo, proposito, texto, llamadasHerramientas [{nombre, id, argumentos}],
 *                    motivoFin, bloqueo, tokens {entrada, salida, pensamiento, cacheados}, ms,
 *                    costeEstimadoUsd?, error?, interrumpida?
 *   herramienta      nombre, llamadaId, argumentos, resultado (recortado), ok, ms, error?
 *   decision         quien ("modelo:<nombre>" o "regla:<nombre>"), que, entrada?, resultado, motivo?
 *   python           metodo, ruta, cuerpoEnviado, estado, cuerpoRecibido (cadenas hasta ~200 kB), ms, requestId, error?
 *   http             proveedor, metodo, url (saneada), estado, cuerpoEnviado?, cuerpoRecibido?, ms, error?
 *   imagen           proveedor, endpoint, modelo?, prompt, referencias [{imagen:sha256, bytes, mime, rol}],
 *                    parametros, resultado {url?, imagen?, bytes?, mime?, proveedorRequestId?}, ms, costeEstimadoUsd?
 *   salida           estado, tipoContenido, cuerpo (JSON redactado) | texto + eventos + herramientas + fin
 *                    (flujos SSE), ms
 *   accion_cliente   evento (botón, chip, reintento, fallo de SSE…), datos, sesion, rutaCliente
 *   error            origen, error {nombre, mensaje, pila}, datos?
 *   aviso            motivo (p. ej. "tope_conversacion": a partir de ahí solo hay resúmenes en el general)
 *
 * ── Redacción (obligatoria, en redaccion.ts) ──────────────────────────────────────────────────────
 *   Claves tipo secreto (key, token, secret, password, authorization, cookie, api_key, approval_token,
 *   x-fal-key, signature…) → "[oculto]"; valores de secretos del entorno y "Bearer …"/"Key …" en cualquier
 *   texto → "[oculto]"; URLs con ?key=/token=/sig= y usuario:clave@ saneadas; data URLs y base64 →
 *   {imagen: sha256, bytes, mime?}; cadenas > 20 000 caracteres (auditoría) o > 2 000 (general) recortadas
 *   con marca; circulares, profundidad, claves y elementos acotados; process.env nunca se serializa.
 *
 * ── Variables de entorno (todas opcionales) ───────────────────────────────────────────────────────
 *   REGISTRO_ACTIVO (1/0; por defecto solo dentro de Next: los scripts de tsx no registran),
 *   REGISTRO_VERSION (commit; si no, VERCEL_GIT_COMMIT_SHA, version-codigo.json o .git), REGISTRO_DIR, REGISTRO_ENTORNO (local|vps|vercel), REGISTRO_NIVEL_ARCHIVO (debug), REGISTRO_NIVEL_STDOUT
 *   (info), REGISTRO_RETENCION_GENERAL_DIAS (14), REGISTRO_RETENCION_CONVERSACIONES_DIAS (30),
 *   REGISTRO_TOPE_GENERAL_MB_DIA (200), REGISTRO_TOPE_CONVERSACION_MB (25), REGISTRO_ARCHIVOS=0 (solo
 *   stdout), REGISTRO_AUDITORIA_STDOUT=1 (copia la traza completa a stdout; activo por defecto en Vercel).
 *
 * ── Dónde está enganchado (segunda pasada; la guardia scripts/test/test-guardia-proveedores-ia.ts lo exige) ──
 *   Gemini directo (getGeminiClient), ChatPort (chatDe/chatOmoikaneDe, Amaterasu vía Python), Happie, fal/FLUX,
 *   transporte al Python (crearFetchAuditado + x-conversacion-id), captions de órdenes (opencode), herramientas de
 *   los bucles, conRegistro en las rutas del flujo y decidir(...) en las reglas deterministas. El navegador manda
 *   x-conversacion-id en todo fetch a /api/* (instalarCabecerasConversacionEnFetch en CapturaErroresCliente) y la
 *   vista guiada registra sus acciones y fallos con una instantánea del estado (components/guiado/registro-guiado.ts).
 *   El Python (services/ai-api/app/registro.py) escribe sus propias líneas JSON con el mismo conversacion_id.
 *   Módulos que también cargan scripts de tsx sin --conditions=react-server importan ./servidor.ts (sin server-only).
 *
 * ── Leerlo ────────────────────────────────────────────────────────────────────────────────────────
 *   npm run registros -- --ayuda      (scripts/ops/ver-registros.ts: local, VPS por ssh, Vercel, Python)
 *   npm run registros -- conversaciones --origen local --conversacion <id>   (intercala las líneas «py:» del Python local)
 *   npm run registros -- --origen python-local --conversacion <id>
 */

export type NivelRegistro = "debug" | "info" | "warn" | "error";
export type EntornoRegistro = "local" | "vps" | "vercel";

export interface ContextoRegistro {
  /** Id de la petición HTTP (x-request-id o uno nuevo). */
  solicitud: string;
  /** Id de conversación ya saneado. */
  conversacion?: string;
  /** clasica | guiada | admin | happie | … */
  vista?: string;
  /** Ruta lógica (p. ej. "/api/asistente-guiado"). */
  ruta?: string;
  /** Date.now() al abrir el contexto, para medir ms. */
  inicio: number;
}

export interface ErrorSerializado {
  nombre: string;
  mensaje: string;
  pila?: string;
  codigo?: string;
  causa?: ErrorSerializado | string;
  extra?: Record<string, unknown>;
}

export interface LineaGeneral {
  ts: string;
  nivel: NivelRegistro;
  servicio: "next";
  entorno: EntornoRegistro;
  /** Commit del código que escribió la línea (ver version.ts). */
  version?: string;
  evento: string;
  solicitud?: string;
  conversacion?: string;
  vista?: string;
  ruta?: string;
  ms?: number;
  datos?: unknown;
  error?: ErrorSerializado;
}

export interface LineaAuditoria {
  ts: string;
  seq: number;
  tipo: TipoAuditoria;
  /** Commit del código que escribió la línea (ver version.ts). */
  version?: string;
  solicitud: string;
  conversacion: string;
  vista?: string;
  ruta?: string;
  ms?: number;
  datos: unknown;
}

export interface TokensIa {
  entrada?: number;
  salida?: number;
  pensamiento?: number;
  cacheados?: number;
  promptHerramientas?: number;
}

export interface LlamadaHerramientaAuditada {
  nombre: string;
  id?: string;
  argumentos?: unknown;
}

export interface DatosEntradaUsuario {
  metodo?: string;
  texto?: string;
  adjuntos?: unknown[];
  estadoCliente?: unknown;
  cuerpo?: unknown;
}

export interface DatosLlamadaIa {
  llamada: string;
  proveedor: string;
  modelo?: string;
  proposito: string;
  sistema?: { sha256: string; caracteres: number; version?: string; texto?: string };
  mensajes?: unknown[];
  herramientas?: unknown;
  parametros?: Record<string, unknown>;
  /** Banderas y modelos configurados al llamar: completos la 1.ª vez por conversación, después {ref: sha}. */
  banderas?: unknown;
}

export interface DatosRespuestaIa {
  llamada: string;
  proveedor: string;
  modelo?: string;
  proposito: string;
  texto?: string;
  llamadasHerramientas?: LlamadaHerramientaAuditada[];
  motivoFin?: string;
  bloqueo?: string;
  tokens?: TokensIa;
  ms: number;
  costeEstimadoUsd?: number;
  interrumpida?: boolean;
  error?: ErrorSerializado;
  /** Respuesta estructurada u otros campos que no caben arriba (ya redactados). */
  crudo?: unknown;
}

export interface DatosHerramienta {
  nombre: string;
  llamadaId?: string;
  argumentos?: unknown;
  resultado?: unknown;
  ok?: boolean;
  ms: number;
  error?: ErrorSerializado;
}

export interface DatosDecision {
  /** "modelo:<nombre>" o "regla:<nombre>". */
  quien: string;
  que: string;
  entrada?: unknown;
  resultado: unknown;
  motivo?: string;
}

export interface DatosPython {
  metodo: string;
  ruta: string;
  cuerpoEnviado?: unknown;
  estado?: number;
  cuerpoRecibido?: unknown;
  ms: number;
  msCuerpo?: number;
  requestId?: string;
  error?: ErrorSerializado;
}

export interface DatosHttp {
  proveedor: string;
  metodo: string;
  url: string;
  estado?: number;
  cuerpoEnviado?: unknown;
  cuerpoRecibido?: unknown;
  ms: number;
  msCuerpo?: number;
  error?: ErrorSerializado;
}

export interface ReferenciaImagenAuditada {
  base64?: string;
  mime?: string;
  rol?: string;
  id?: string;
  url?: string;
}

export interface DatosImagen {
  proveedor: string;
  endpoint?: string;
  modelo?: string;
  prompt?: string;
  referencias?: unknown[];
  parametros?: Record<string, unknown>;
  resultado?: { url?: string; imagen?: unknown; bytes?: number; mime?: string; proveedorRequestId?: string };
  ms: number;
  costeEstimadoUsd?: number;
  error?: ErrorSerializado;
}

export interface DatosSalida {
  estado?: number;
  tipoContenido?: string;
  cuerpo?: unknown;
  texto?: string;
  eventos?: Record<string, number>;
  herramientas?: unknown[];
  fin?: unknown;
  errores?: unknown[];
  bytes?: number;
  ms?: number;
  cancelada?: boolean;
}

export interface DatosAccionCliente {
  evento: string;
  datos?: unknown;
  sesion?: string;
  rutaCliente?: string;
}

export interface DatosErrorAuditoria {
  origen: string;
  error: ErrorSerializado | unknown;
  datos?: unknown;
}

export interface DatosAviso {
  motivo: string;
  mensaje?: string;
  datos?: unknown;
}

export interface MapaAuditoria {
  entrada_usuario: DatosEntradaUsuario;
  llamada_ia: DatosLlamadaIa;
  respuesta_ia: DatosRespuestaIa;
  herramienta: DatosHerramienta;
  decision: DatosDecision;
  python: DatosPython;
  http: DatosHttp;
  imagen: DatosImagen;
  salida: DatosSalida;
  accion_cliente: DatosAccionCliente;
  error: DatosErrorAuditoria;
  aviso: DatosAviso;
}

export type TipoAuditoria = keyof MapaAuditoria;

export const TIPOS_AUDITORIA: readonly TipoAuditoria[] = [
  "entrada_usuario", "llamada_ia", "respuesta_ia", "herramienta", "decision", "python", "http", "imagen",
  "salida", "accion_cliente", "error", "aviso",
];

/** Lo que el navegador manda a POST /api/registro-cliente (validado con Zod en la ruta). */
export interface CargaEventoCliente {
  evento: string;
  nivel?: NivelRegistro;
  tipo?: "accion" | "error" | "evento";
  datos?: Record<string, unknown>;
  idConversacion?: string;
  vista?: string;
  ruta?: string;
  sesion?: string;
  ts?: string;
  /** Eventos descartados por el límite por minuto desde el último envío. */
  suprimidos?: number;
}

export const CABECERA_SOLICITUD = "x-request-id";
export const CABECERA_CONVERSACION = "x-conversacion-id";
export const CABECERA_VISTA = "x-vista";
