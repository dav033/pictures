"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Lock } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ETIQUETA_FORMATO_PROMPT, esSeleccionFormatoPrompt, FORMATO_PROMPT_AUTOMATICO, OPCIONES_FORMATO_PROMPT, promptFormatParaGenerar, type SeleccionFormatoPrompt } from "@/lib/lora/formato-prompt-cliente";
import { CREATIVIDAD_POR_DEFECTO, type NivelCreatividad } from "@/lib/ia/escena/creatividad";
import { DecoracionCard } from "@/components/DecoracionCard";
import { Lightbox } from "@/components/Lightbox";
import { PromptModal } from "@/components/PromptModal";
import { Markdown } from "@/components/Markdown";
import { ProductoCard } from "@/components/ProductoCard";
import { TarjetaCotizacion } from "@/components/TarjetaCotizacion";
import { TarjetaPlanDecoracion } from "@/components/TarjetaPlanDecoracion";
import { ReferenceAnalysisController } from "@/components/references/ReferenceAnalysisController";
import type { ReferenceDraft } from "@/components/references/ReferenceReviewPanel";
import { PasosAsistente } from "@/components/propuesta";
import { useSeleccion } from "@/lib/estado/seleccion";
import type { Cotizacion } from "@/lib/cotizacion/motor";
import type { Imagen, PeticionImagen } from "@/lib/ia/nucleo/tipos";
import type { ReferenceBlueprintV2 } from "@/lib/ia/referencia/reference-blueprint";
import type { LoraModeSlug } from "@/lib/lora/schema";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import type { ItemRechazado, ItemValidado } from "@/lib/rag/chat/validar";
import type { Faceta, FiltrosCatalogo } from "@/lib/shopify/consultas";
import type { Brief, DecoracionConProductos, Producto } from "@/lib/types";
import { classifyGenerationIds, normalizeGenerationSources } from "@/lib/generacion/provenance";

const DEFAULT_LORA_MODE: LoraModeSlug = process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_LORA_MODE === "training_2" ? "training_2" : "training_1";
import { ChatSseEventV1Schema } from "@/lib/ia/contracts/chat-v1";
import { CATALOGO_ERRORES_UI_V1, construirUiErrorV1, leerUiErrorV1, type AccionUiV1, type UiErrorV1 } from "@/lib/ia/contracts/ui-error-v1";
import { AvisoError } from "@/components/errores/AvisoError";
import { useModoVista } from "@/lib/estado/modo-vista";
import { abrirPromptAutomaticamente, usarLoraEfectivo } from "@/lib/estado/modo-vista-reglas";
import { aplicarEventoHerramienta, cerrarPasos, type PasoAsistente } from "@/lib/estado/pasos-asistente";
import { contextoEventoConversacion } from "@/lib/estado/contexto-evento";
import { crearEsperaAnalisis, type EstadoAnalisisReferencia } from "@/lib/estado/espera-analisis";
import { adjuntosParaGeneracion } from "@/lib/estado/generacion-adjuntos";
import { aligerarAdjuntos, claveImagen, imagenesSinMiniatura, type AdjuntosTurno } from "@/lib/estado/persistencia-adjuntos";
import { respetarReintentable, uiErrorDesdeEventoChat, type OrigenError } from "@/lib/estado/estado-error";
import { mensajeErrorCliente } from "@/lib/estado/mensaje-error-cliente";
import {
  CLAVE_GENERACIONES,
  generacionParaRestaurar,
  leerGeneraciones,
  REDUCCIONES_IMAGEN_GENERADA,
  elegirImagenReducida,
  registrarGeneracion,
  registrarVistaPreviaNoDisponible,
  serializarGeneraciones,
  sinImagenes,
} from "@/lib/estado/persistencia-generacion";
import { creatividadGuardada } from "@/lib/estado/persistencia-creatividad";
import { imagenDeFotoEjemplo, type FotoEjemplo } from "@/lib/referencias-ejemplo/manifiesto";
import { CabeceraApp } from "@/components/ui/shell/CabeceraApp";
import { Compositor } from "@/components/ui/shell/Compositor";
import { EsperaAsistente } from "@/components/ui/shell/EsperaAsistente";
import { CargaImagen } from "@/components/propuesta/CargaImagen";
import { coloresCliente } from "@/lib/plan/presentacion-cliente";
import { DialogoEjemplos, GaleriaEjemplos } from "@/components/ui/shell/GaleriaEjemplos";
import { HojaSeleccion } from "@/components/ui/shell/HojaSeleccion";
import { volarFoto } from "@/components/ui/shell/vuelo-foto";

type ProveedorId = "gemini";
type SelectorIA = ProveedorId | "lora";

const NOMBRE_PROVEEDOR: Record<ProveedorId, string> = {
  gemini: "Gemini 3.6 Flash / Nano Banana 2",
};

const NOMBRE_SELECTOR: Record<SelectorIA, string> = {
  ...NOMBRE_PROVEEDOR,
  lora: "LoRA Sempertex",
};

type GeneracionVisible = {
  modo: "gemini" | "lora";
  solicitado: SelectorIA;
  etiqueta: string;
  prompts: Array<{ label: string; prompt: string }>;
};

type Mensaje = {
  /** Estable por mensaje (no el índice del array) — necesario para que
   * Motion pueda animar entradas/salidas de la lista de forma confiable. */
  id: string;
  role: "user" | "assistant";
  content: string;
  productos?: Producto[];
  decoraciones?: DecoracionConProductos[];
  categorias?: Faceta[];
  /** Filtros que produjeron `categorias` (ocasión, colores…) — se reusan al navegar a un tipo puntual sin pasar por la IA. */
  categoriasFiltros?: FiltrosCatalogo;
  plan?: PlanResuelto;
  /** Brief del evento `fin` de esta respuesta: la cabecera distingue si cambió después de la última propuesta. */
  brief?: Brief;
  cotizacion?: Cotizacion;
  referenceBlueprint?: ReferenceBlueprintV2;
  /** Debug: JSON crudo que usó el análisis de imágenes de referencia. Va
   * aparte del `content` markdown (que no interpreta HTML) para poder
   * mostrarlo colapsado sin reventar el layout del chat. */
  analisisReferencias?: unknown;
  /** Piezas ya validadas contra la DB real (plan Fase 4/6) — se muestran con
   * foto y link a la tienda para poder verificar que el modelo no inventó
   * nada, en vez de confiar a ciegas en la tabla de texto que redacta. */
  ragValidados?: ItemValidado[];
  /** Fase 3.11: piezas que el modelo propuso pero el backend descartó (no
   * estaban en la whitelist recuperada, variante agotada, etc.). El backend
   * ya calcula esto — antes se recibía en el SSE y se tiraba sin mostrarlo,
   * así que una sustitución o un descarte podía pasar sin que el cliente lo
   * viera nunca (viola "nunca sustituir en silencio"). */
  ragRechazados?: ItemRechazado[];
  /**
   * Fotos del turno que produjo este mensaje (iteración 4): miniatura en el
   * mensaje del cliente y recortes por pieza en la propuesta. El estado de
   * adjuntos del compositor puede cambiar después, así que se copian aquí al
   * enviar. En sessionStorage solo va una miniatura liviana de las más
   * recientes (src/lib/estado/persistencia-adjuntos.ts).
   */
  adjuntos?: AdjuntosTurno;
  /** Pasos en vivo del asistente para este turno (eventos SSE `herramienta`). */
  pasos?: PasoAsistente[];
};

/** Una foto restaurada de sessionStorage ya viene como data URL (su miniatura). */
function dataUrl(imagen: { base64: string; mime: string }): string {
  return imagen.base64.startsWith("data:") ? imagen.base64 : `data:${imagen.mime};base64,${imagen.base64}`;
}

/** Copia liviana de los adjuntos del turno; los ids siguen el orden que usa /api/references/analyze (REF_01…). */
function adjuntosDelTurno(referencias: readonly Imagen[], fotoEspacio: Imagen | null): AdjuntosTurno | undefined {
  if (!referencias.length && !fotoEspacio) return undefined;
  return {
    referencias: referencias.map(({ base64, mime }, indice) => ({ id: `REF_${String(indice + 1).padStart(2, "0")}`, base64, mime })),
    ...(fotoEspacio ? { fotoEspacio: { base64: fotoEspacio.base64, mime: fotoEspacio.mime } } : {}),
  };
}

const SALUDO: Mensaje = {
  id: "saludo",
  role: "assistant",
  content:
    "¡Hola! Soy el asistente de decoración. Cuéntame qué evento estás planeando y te armo una propuesta. En cualquier momento puedes tocar, agregar o quitar piezas tú mismo.",
};

// v2 invalida conversaciones que contienen planes resueltos antes de que
// existiera el límite de sustituciones (por ejemplo R-12→R-24). Reutilizar
// esos objetos haría que la UI siguiera mostrando una cotización que el
// servidor actual ya rechaza.
const CLAVE_CHAT = "demo_chat_v4";
const CLAVE_CHAT_LEGACY = "demo_chat_v1";

const SUGERENCIAS = [
  "Quiero ideas para mi boda en un jardín",
  "XV años estilo glamour en salón",
  "Algo boho en tonos tierra",
];

const LIMITE_INACTIVIDAD_CHAT_MS = 90_000;
/** Espera máxima de un análisis de la foto que no responde antes de enviar el turno sin él (p95 medido: 20 s). Si falla, no se espera. */
const LIMITE_ESPERA_ANALISIS_MS = 45_000;

/** `order` de flexbox para lo que va después de toda la conversación (visualización, errores, análisis sin enviar). */
const ORDEN_AL_FINAL = 1_000_000;

type DatosFin = {
  reply: string;
  brief?: Brief;
  recomendaciones?: Producto[];
  decoraciones?: DecoracionConProductos[];
  categorias?: Faceta[];
  filtrosCategorias?: FiltrosCatalogo;
  cotizacion?: Cotizacion;
  /** Piezas que la IA decidió proponer por su cuenta — dispara /api/generate sin que el cliente haga clic. */
  seleccionIA?: Producto[];
  instruccionIA?: string;
  ragValidados?: ItemValidado[];
  ragRechazados?: ItemRechazado[];
  plan?: PlanResuelto;
  referenceBlueprint?: ReferenceBlueprintV2;
};

type GenerarOverride = {
  ids: string[];
  /** Exact RAG variant ids. Kept separate from legacy/manual catalog ids. */
  ragVariantIds?: string[];
  paquetes?: Record<string, number>;
  instruccion?: string;
  brief?: Brief;
  solicitudUsuario?: string;
  /**
   * Cuando viene de aplicar una cotización editada a mano: `ids` ya es la
   * lista completa y definitiva de piezas (incluye lo que el cliente quitó
   * o reemplazó). Sin este flag, `generar()` reinyecta encima las piezas
   * del último `ragValidados` y las de la selección compartida — exacto lo
   * que se quiere evitar, porque una pieza recién quitada "reaparecería".
   */
  soloIds?: boolean;
  /**
   * Piezas manuales a usar tal cual cuando `soloIds` es true — no se puede
   * derivar de `seleccionados` porque `reemplazarTodo()` (que se llama justo
   * antes) todavía no aplicó su actualización de estado en este mismo tick.
   */
  manualProducts?: Producto[];
  /** Propuesta aprobada. Toda imagen sale de una (ADR-0023, paso 1). */
  plan: PlanResuelto;
  /** Mensaje exacto al que debe volver la cotización final de esta generación. */
  anchorMessageId?: string;
  /** Adjuntos de la propuesta anclada; evita usar fotos de otro turno. */
  adjuntos?: AdjuntosTurno;
  /**
   * El cliente pidió explícitamente "Generar con estilo estándar" desde un
   * aviso de error: este intento no usa LoRA. Nunca se activa solo.
   */
  estiloEstandar?: boolean;
};

type ErrorVisible = { ui: UiErrorV1; origen: OrigenError };

const ACCIONES_POR_ORIGEN: Readonly<Record<OrigenError, ReadonlySet<AccionUiV1>>> = {
  chat: new Set<AccionUiV1>(["reintentar", "ajustar_propuesta", "pedir_nueva_propuesta", "revisar_adjuntos"]),
  generacion: new Set<AccionUiV1>(["reintentar", "generar_estilo_estandar", "revisar_propuesta", "pedir_nueva_propuesta", "ajustar_propuesta", "revisar_adjuntos"]),
  catalogo: new Set<AccionUiV1>(),
  plan: new Set<AccionUiV1>(["revisar_propuesta"]),
};

function errorLocal(code: Parameters<typeof construirUiErrorV1>[0], mensaje: string): UiErrorV1 {
  return construirUiErrorV1(code, { mensaje });
}

function campoTexto(valor: unknown, campo: string): string | undefined {
  if (typeof valor !== "object" || valor === null || !(campo in valor)) return undefined;
  const dato: unknown = (valor as Record<string, unknown>)[campo];
  return typeof dato === "string" && dato.length > 0 ? dato : undefined;
}

/** `retryable` del sobre de error (error.v1); undefined si no viene. */
function campoReintentable(valor: unknown): boolean | undefined {
  if (typeof valor !== "object" || valor === null || !("retryable" in valor)) return undefined;
  const dato: unknown = (valor as Record<string, unknown>).retryable;
  return typeof dato === "boolean" ? dato : undefined;
}

/**
 * Streaming real (§5.4 del plan): parsea a mano los bloques
 * `event: X\ndata: Y\n\n` de la respuesta SSE de /api/chat. No se usa
 * EventSource porque necesita ir por POST con cuerpo JSON, algo que
 * EventSource no soporta.
 */
async function consumirSSE(
  body: ReadableStream<Uint8Array>,
  manejadores: {
    onTexto: (delta: string) => void;
    onHerramienta: (nombre: string, estado: "ejecutando" | "lista", ok?: boolean) => void;
    onFin: (datos: DatosFin) => void;
    onError: (datos: { error?: string; code?: string; causa?: string; request_id?: string; retryable?: boolean }) => void;
    onActividad?: () => void;
  },
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let recibioFinal = false;
  let recibioError = false;

  function procesarBloque(bloque: string) {
    let evento = "message";
    let datosCrudo = "";
    for (const linea of bloque.split("\n")) {
      if (linea.startsWith("event: ")) evento = linea.slice(7);
      else if (linea.startsWith("data: ")) datosCrudo += linea.slice(6);
    }
    if (!datosCrudo) return;
    const datos = JSON.parse(datosCrudo) as unknown;
    if (recibioFinal || recibioError) return;
    const eventoValidado = ChatSseEventV1Schema.safeParse(datos);
    if (!eventoValidado.success || eventoValidado.data.type !== evento) {
      throw new Error("El servidor devolvió un evento SSE inválido.");
    }
    const datosValidados = eventoValidado.data;
    manejadores.onActividad?.();
    if (datosValidados.type === "texto") manejadores.onTexto(datosValidados.delta);
    else if (datosValidados.type === "herramienta") manejadores.onHerramienta(datosValidados.nombre, datosValidados.estado, datosValidados.ok);
    else if (datosValidados.type === "fin") {
      recibioFinal = true;
      manejadores.onFin(datosValidados);
    } else if (datosValidados.type === "error") {
      recibioError = true;
      manejadores.onError(datosValidados);
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let indice: number;
    while ((indice = buffer.indexOf("\n\n")) !== -1) {
      procesarBloque(buffer.slice(0, indice));
      buffer = buffer.slice(indice + 2);
    }
  }
  if (!recibioFinal && !recibioError) throw new Error("El asistente cerró la respuesta antes de terminar.");
}

// Debe coincidir con LIMITE_REFERENCIAS_CLIENTE en src/app/api/generate/route.ts.
const LIMITE_REFERENCIAS_CLIENTE = 3;

const ASPECTOS_SOPORTADOS: { valor: PeticionImagen["aspecto"]; razon: number }[] = [
  { valor: "3:2", razon: 3 / 2 },
  { valor: "1:1", razon: 1 },
  { valor: "2:3", razon: 2 / 3 },
  { valor: "16:9", razon: 16 / 9 },
];

/** Mapea una proporción real (ancho/alto) al aspecto soportado más cercano, comparando razones en escala logarítmica (así 3:2 y 2:3 no se confunden solo por estar "cerca" en valor absoluto). */
function aspectoDe(ancho: number, alto: number): PeticionImagen["aspecto"] {
  const razon = ancho / alto;
  let mejor = ASPECTOS_SOPORTADOS[0];
  let mejorDistancia = Infinity;
  for (const candidato of ASPECTOS_SOPORTADOS) {
    const distancia = Math.abs(Math.log(razon / candidato.razon));
    if (distancia < mejorDistancia) {
      mejorDistancia = distancia;
      mejor = candidato;
    }
  }
  return mejor.valor;
}

const TAMANO_MAX_ARCHIVO = 20 * 1024 * 1024; // 20MB crudos — generoso para fotos de celular, evita colgar canvas con archivos absurdos.

/**
 * Convierte un archivo subido a un `Imagen` liviano para mandar por JSON:
 * respeta la rotación EXIF de fotos de celular, reescala al máximo indicado
 * y siempre normaliza a JPEG (tamaño predecible sin importar el formato de
 * origen). Lanza con mensaje legible si el archivo no es una imagen válida.
 */
async function redimensionarImagen(
  file: File,
  maxDim: number,
  calidad: number,
): Promise<Imagen & { ancho: number; alto: number }> {
  // Fotos de iPhone salen en HEIC/HEIF por defecto — ni Chrome ni Firefox en
  // Windows/Android lo decodifican de forma confiable vía createImageBitmap
  // (a veces ni siquiera lanza error, solo produce un bitmap vacío/negro en
  // silencio). El MIME también puede llegar vacío en vez de "image/heic" si
  // el sistema no tiene el codec registrado, así que se revisa también la
  // extensión del archivo para dar un mensaje útil en vez de un fallo mudo.
  const esHeic = /\.(heic|heif)$/i.test(file.name) || /^image\/hei[cf]/i.test(file.type);
  if (esHeic) {
    throw new Error(
      `"${file.name}" está en formato HEIC/HEIF (típico de iPhone) y no se puede leer en este navegador. Expórtala como JPEG o PNG antes de subirla.`,
    );
  }
  if (!file.type.startsWith("image/")) {
    throw new Error(`"${file.name}" no es una imagen.`);
  }
  if (file.size > TAMANO_MAX_ARCHIVO) {
    throw new Error(`"${file.name}" pesa demasiado (máximo 20MB).`);
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(`No se pudo leer "${file.name}" — ¿es una imagen válida?`);
  }
  if (bitmap.width === 0 || bitmap.height === 0) {
    bitmap.close();
    throw new Error(`"${file.name}" se leyó vacía o corrupta — prueba exportarla de nuevo como JPEG o PNG.`);
  }

  try {
    const escala = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const ancho = Math.round(bitmap.width * escala);
    const alto = Math.round(bitmap.height * escala);

    const canvas = document.createElement("canvas");
    canvas.width = ancho;
    canvas.height = alto;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Este navegador no pudo procesar la imagen. Prueba con otro navegador.");
    ctx.drawImage(bitmap, 0, 0, ancho, alto);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("No se pudo procesar la imagen."))),
        "image/jpeg",
        calidad,
      );
    });

    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = () => reject(new Error("No se pudo leer la imagen procesada."));
      reader.readAsDataURL(blob);
    });

    return { base64, mime: "image/jpeg", ancho, alto, originalAncho: bitmap.width, originalAlto: bitmap.height };
  } finally {
    bitmap.close();
  }
}

/**
 * Recorta al centro para que la imagen coincida EXACTO con uno de los 4
 * aspectos que soportan los proveedores, en vez de mandarla con su
 * proporción real y dejar que el modelo de edición decida cómo encajarla.
 * Sin este paso, una foto de celular en 4:3 se manda "tal cual" hacia un
 * lienzo 3:2 — el desajuste de proporción es una fuente real de distorsión
 * de perspectiva en la imagen generada (el modelo tiene que estirar o
 * recortar el espacio real para llenar un lienzo con otra forma).
 */
async function recortarAlAspecto(
  base64: string,
  mime: string,
  aspecto: PeticionImagen["aspecto"],
): Promise<{ base64: string; ancho: number; alto: number }> {
  const bitmap = await createImageBitmap(await (await fetch(`data:${mime};base64,${base64}`)).blob());
  try {
    const razonObjetivo = ASPECTOS_SOPORTADOS.find((a) => a.valor === aspecto)?.razon ?? 3 / 2;
    const razonActual = bitmap.width / bitmap.height;
    let anchoRecorte = bitmap.width;
    let altoRecorte = bitmap.height;
    if (razonActual > razonObjetivo) {
      anchoRecorte = Math.round(bitmap.height * razonObjetivo);
    } else {
      altoRecorte = Math.round(bitmap.width / razonObjetivo);
    }
    const offsetX = Math.floor((bitmap.width - anchoRecorte) / 2);
    const offsetY = Math.floor((bitmap.height - altoRecorte) / 2);

    const canvas = document.createElement("canvas");
    canvas.width = anchoRecorte;
    canvas.height = altoRecorte;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Este navegador no pudo procesar la imagen. Prueba con otro navegador.");
    ctx.drawImage(bitmap, offsetX, offsetY, anchoRecorte, altoRecorte, 0, 0, anchoRecorte, altoRecorte);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo recortar la imagen."))), "image/jpeg", 0.85);
    });
    const base64Recortado = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1]);
      reader.onerror = () => reject(new Error("No se pudo leer la imagen recortada."));
      reader.readAsDataURL(blob);
    });
    return { base64: base64Recortado, ancho: anchoRecorte, alto: altoRecorte };
  } finally {
    bitmap.close();
  }
}

/** Miniatura JPEG liviana (data URL) de una foto del turno, para guardarla con la conversación. */
async function miniaturaImagen(imagen: { base64: string; mime: string }, maxDim = 480, calidad = 0.72): Promise<string> {
  const bitmap = await createImageBitmap(await (await fetch(dataUrl(imagen))).blob());
  try {
    const escala = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * escala));
    canvas.height = Math.max(1, Math.round(bitmap.height * escala));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Sin canvas 2D.");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", calidad);
  } finally {
    bitmap.close();
  }
}

// Guard de generación, a nivel de módulo (una sola vez por pestaña, no por
// instancia de componente). Bug real: adjuntar una referencia y mandar un
// mensaje de chat casi a la vez puede hacer que DOS rutas independientes
// —la respuesta del chat (ve la referencia y confirma su propia selección)
// y el análisis automático de blueprint del panel de referencias— decidan
// generar cada una por su cuenta. `colaGeneracion` encadena ambas sobre la
// MISMA promesa: `.then()` en JavaScript garantiza que la segunda espera a
// que la primera resuelva, sin importar qué tan cerca en el tiempo hayan
// llegado ni por qué canal (stream de chat, efecto de React, clic manual).
let generandoGlobal = false;
let pendienteAutoGlobal: GenerarOverride | null = null;
let colaGeneracion: Promise<void> = Promise.resolve();

export default function Page() {
  // Modo usuario/dev (B1): preferencia de presentación, no un permiso.
  const { modo: modoVista, cambiar: cambiarModoVista } = useModoVista();
  const esModoDev = modoVista === "dev";
  const [mensajes, setMensajes] = useState<Mensaje[]>([SALUDO]);
  const [entrada, setEntrada] = useState("");
  const [brief, setBrief] = useState<Brief>({});
  const [hojaSeleccionAbierta, setHojaSeleccionAbierta] = useState(false);
  // Etiqueta visible de cada foto adjunta (título del ejemplo o nombre del archivo).
  const [etiquetasAdjuntos, setEtiquetasAdjuntos] = useState<Record<string, string>>({});
  // Foto de ejemplo adjunta ahora (id del manifiesto + clave de su imagen procesada).
  const [ejemploElegido, setEjemploElegido] = useState<{ id: string; clave: string } | null>(null);
  const [cargandoEjemplo, setCargandoEjemplo] = useState(false);
  // Claves de las fotos que deben enviar el turno solas al llegar al compositor.
  const envioAutomaticoRef = useRef<string[] | null>(null);
  const [galeriaAbierta, setGaleriaAbierta] = useState(false);
  const {
    ids: seleccion,
    productos: seleccionados,
    estaSeleccionado,
    alternar: alternarSeleccion,
    quitar: quitarSeleccion,
    agregarVarios,
    registrarConocidos,
    limpiar: limpiarSeleccion,
  } = useSeleccion();
  const [imagenes, setImagenes] = useState<string[]>([]);
  const [imagenAmpliada, setImagenAmpliada] = useState<string | null>(null);
  const [ajuste, setAjuste] = useState("");
  const [cargandoChat, setCargandoChat] = useState(false);
  const [generando, setGenerando] = useState(false);
  const [segundosGeneracion, setSegundosGeneracion] = useState(0);
  const [error, setError] = useState<ErrorVisible | null>(null);
  // Último intento de generación, para "Reintentar" y "Generar con estilo
  // estándar" desde el aviso de error. `override` indefinido = clic manual.
  const ultimoIntentoGeneracionRef = useRef<{ override: GenerarOverride } | null>(null);
  const [proveedor, setProveedor] = useState<ProveedorId>("gemini");
  const [selectorIA, setSelectorIA] = useState<SelectorIA>("lora");
  // Formato del prompt LoRA: automático (lo resuelve el servidor por el trigger
  // y no se envía), texto (entrenado), JSON o ambos (dos imágenes para comparar).
  const [formatoPromptLora, setFormatoPromptLora] = useState<SeleccionFormatoPrompt>(FORMATO_PROMPT_AUTOMATICO);
  // Calibración de creatividad 0–5 (src/lib/ia/escena/creatividad.ts): la leen el
  // chat (diseño) y la generación (prompt LoRA). El ref evita cierres viejos
  // en los callbacks que arman las peticiones.
  const [creatividad, setCreatividad] = useState<NivelCreatividad>(CREATIVIDAD_POR_DEFECTO);
  const creatividadRef = useRef<NivelCreatividad>(CREATIVIDAD_POR_DEFECTO);
  const cambiarCreatividad = (nivel: NivelCreatividad) => {
    creatividadRef.current = nivel;
    setCreatividad(nivel);
  };
  const loraModeRef = useRef<LoraModeSlug>(DEFAULT_LORA_MODE);
  // Espejo en estado del ref anterior, solo para lecturas durante el render
  // (p. ej. la tarjeta del plan): un ref no puede leerse ahí sin violar las
  // reglas de React, así que este valor se actualiza junto con el ref.
  const [loraModeParaBadge, setLoraModeParaBadge] = useState<LoraModeSlug>(DEFAULT_LORA_MODE);
  const [proveedoresDisponibles, setProveedoresDisponibles] = useState<ProveedorId[]>(["gemini"]);
  const [cargadoDeStorage, setCargadoDeStorage] = useState(false);
  // Las tarjetas clicables y la propuesta autónoma de la IA conviven siempre
  // en la misma conversación — ya no hay un perfil de conversación que elegir.
  // `seleccionPendiente` marca cuando el cliente tocó/agregó/quitó algo a mano
  // después de ya existir una imagen generada: eso NO regenera solo, muestra
  // el aviso "Regenerar imagen" (decisión explícita, para no gastar
  // generaciones por cada clic accidental).
  const [seleccionPendiente, setSeleccionPendiente] = useState(false);
  // Foto real del espacio (activa modo "editar" en el proveedor) e imágenes
  // de inspiración de estilo — contexto que el cliente aporta. No se
  // persisten en sessionStorage (mismo criterio que `imagenes` generadas:
  // son base64 potencialmente pesados).
  const [fotoEspacio, setFotoEspacio] = useState<(Imagen & { aspecto: PeticionImagen["aspecto"] }) | null>(null);
  const [imagenesReferencia, setImagenesReferencia] = useState<Imagen[]>([]);
  const [referenceDraft, setReferenceDraft] = useState<ReferenceDraft | null>(null);
  // Escenografía de la foto que el cliente apagó (`element_id`s del análisis).
  // Solo decide qué DIBUJA la imagen: no toca el plan, los materiales, la
  // cotización ni `plan_hash`. La escenografía no se vende ni se compra.
  const [escenografiaApagada, setEscenografiaApagada] = useState<string[]>([]);
  // Ciclo del análisis de la foto (onEstado del controlador): el estado pinta
  // las ayudas; `esperaAnalisis` lo lee sin cierres viejos al enviar y generar.
  const [estadoAnalisis, setEstadoAnalisis] = useState<EstadoAnalisisReferencia>("idle");
  const [esperaAnalisis] = useState(() => crearEsperaAnalisis());
  const analizandoFoto = estadoAnalisis === "analyzing";
  const [ultimaImagenGenerada, setUltimaImagenGenerada] = useState<Imagen | null>(null);
  const [ultimaGeneracion, setUltimaGeneracion] = useState<GeneracionVisible | null>(null);
  const [promptModalAbierto, setPromptModalAbierto] = useState(false);
  const [errorAdjuntos, setErrorAdjuntos] = useState<string | null>(null);
  // Espejo siempre-al-día de los dos estados de arriba: `generar()` se
  // dispara desde dentro de un closure de `enviar()` que puede llevar varios
  // segundos abierto (la IA decide y confirma con tool-calling) —
  // si el cliente adjunta una imagen MIENTRAS esa respuesta sigue en curso,
  // ese closure quedó capturado con el estado de ANTES del adjunto y nunca
  // ve el nuevo valor. Un ref no tiene ese problema: es el mismo objeto
  // mutado en el sitio, así que cualquier closure, viejo o nuevo, lee lo
  // último que se le asignó.
  const fotoEspacioRef = useRef<(Imagen & { aspecto: PeticionImagen["aspecto"] }) | null>(null);
  const imagenesReferenciaRef = useRef<Imagen[]>([]);
  const referenceDraftRef = useRef<ReferenceDraft | null>(null);
  const escenografiaApagadaRef = useRef<string[]>([]);
  const briefRef = useRef<Brief>({});
  const solicitudUsuarioRef = useRef("");
  // Ids de la selección compartida (chat + /catalogo) reflejados en la última
  // imagen generada con éxito — se compara contra la selección actual para
  // saber si el cliente agregó/quitó algo a mano y falta pulsar "Regenerar".
  const seleccionRef = useRef<string[]>([]);
  const seleccionGeneradaRef = useRef<string[]>([]);
  // Aspecto de la foto del espacio activa en la sesión — sobrevive a quitar
  // el adjunto (botón "✕") para que revisiones posteriores no vuelvan al
  // default del servidor ("3:2") si el cliente ya generó en otro aspecto.
  // Solo se resetea en `limpiarTodo`.
  const aspectoActivoRef = useRef<PeticionImagen["aspecto"] | undefined>(undefined);
  // Id de la interacción de Gemini que produjo la última imagen — se manda
  // de vuelta en la siguiente revisión (ajuste sobre una imagen ya generada)
  // para que el modelo encadene contexto real, no solo la imagen final.
  const ultimaInteraccionIdRef = useRef<string | undefined>(undefined);
  // Recursos de la generación activa. Se guardan en refs para que la limpieza
  // no dependa del closure de un render viejo: timeout, abort y desmontaje
  // deben dejar la UI en estado idle incluso si la API devuelve 4xx/5xx.
  const generacionAbortRef = useRef<AbortController | null>(null);
  const chatAbortRef = useRef<AbortController | null>(null);
  const generacionIntervalRef = useRef<number | null>(null);
  const paginaMontadaRef = useRef(true);

  const logChat = useRef<HTMLDivElement>(null);
  const entradaRef = useRef<HTMLInputElement>(null);
  const [planAprobadoHash, setPlanAprobadoHash] = useState<string | null>(null);
  // Propuesta aprobada restaurada al recargar cuya imagen no cupo en sessionStorage (D5):
  // se avisa «Ya generaste esta imagen» en vez de volver a ofrecer «Aprobar».
  const [imagenNoGuardadaHash, setImagenNoGuardadaHash] = useState<string | null>(null);
  // Propuesta aprobada cuya imagen no se pudo crear porque la vista previa no está
  // disponible (VISTA_PREVIA_NO_DISPONIBLE, D5 sin foto): tras recargar se muestra
  // ese aviso con la opción de volver a intentarlo, no «Aprobar» otra vez.
  const [vistaPreviaNoDisponibleHash, setVistaPreviaNoDisponibleHash] = useState<string | null>(null);
  const hayPlanEnConversacion = mensajes.some((mensaje) => mensaje.role === "assistant" && Boolean(mensaje.plan));

  useEffect(() => {
    paginaMontadaRef.current = true;
    return () => {
      paginaMontadaRef.current = false;
      generacionAbortRef.current?.abort();
      generacionAbortRef.current = null;
      chatAbortRef.current?.abort();
      chatAbortRef.current = null;
      if (generacionIntervalRef.current !== null) {
        window.clearInterval(generacionIntervalRef.current);
        generacionIntervalRef.current = null;
      }
      // La petición abortada ejecutará su finally; liberar también el guard
      // aquí evita que una pestaña desmontada bloquee una nueva instancia.
      generandoGlobal = false;
    };
  }, []);

  useEffect(() => {
    // En el estado inicial no hay conversación que seguir: bajar hasta el final
    // escondería el título y el compositor detrás de la galería.
    if (!mensajes.some((mensaje) => mensaje.id !== SALUDO.id)) return;
    const reducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Se desplaza el log, no un ancla con `scrollIntoView`: sin `block`, esa
    // API alinea el elemento con el INICIO de todos sus contenedores
    // desplazables, la ventana incluida, así que al llegar una imagen empujaba
    // el documento hasta el tope y dejaba a la vista el hueco que queda bajo el
    // compositor. Mover el contenedor no puede tocar la ventana.
    const log = logChat.current;
    if (log) log.scrollTo({ top: log.scrollHeight, behavior: reducido ? "auto" : "smooth" });
  }, [mensajes, cargandoChat]);

  useEffect(() => {
    fotoEspacioRef.current = fotoEspacio;
  }, [fotoEspacio]);

  useEffect(() => {
    imagenesReferenciaRef.current = imagenesReferencia;
  }, [imagenesReferencia]);


  useEffect(() => {
    referenceDraftRef.current = referenceDraft;
  }, [referenceDraft]);

  useEffect(() => {
    escenografiaApagadaRef.current = escenografiaApagada;
  }, [escenografiaApagada]);

  /** Enciende o apaga un chip de escenografía: todos sus elementos a la vez. */
  const alternarEscenografia = useCallback((elementIds: readonly string[], visible: boolean) => {
    setEscenografiaApagada((previo) => visible
      ? previo.filter((id) => !elementIds.includes(id))
      : [...new Set([...previo, ...elementIds])]);
  }, []);

  useEffect(() => {
    seleccionRef.current = seleccion;
  }, [seleccion]);

  // El cliente tocó una tarjeta, quitó algo del panel, o volvió de /catalogo
  // con la selección compartida cambiada: si ya hay una imagen generada, no
  // se regenera sola — se marca pendiente y aparece el botón "Regenerar
  // imagen". Mientras haya una generación en curso (`generando`), el aviso
  // se oculta en la UI para no competir con la que ya está en marcha.
  useEffect(() => {
    if (imagenes.length === 0) return;
    const cambio =
      seleccion.length !== seleccionGeneradaRef.current.length ||
      seleccion.some((id) => !seleccionGeneradaRef.current.includes(id));
    if (cambio) setSeleccionPendiente(true);
  }, [seleccion, imagenes.length]);

  // Persistencia de la conversación: recargar la página no debe perder el
  // hilo. sessionStorage (no localStorage) a propósito — es una demo por
  // sesión, no algo que deba sobrevivir entre visitas distintas.
  useEffect(() => {
    try {
      sessionStorage.removeItem(CLAVE_CHAT_LEGACY);
      const guardado = sessionStorage.getItem(CLAVE_CHAT);
      if (guardado) {
        const datos = JSON.parse(guardado);
        // eslint-disable-next-line react-hooks/set-state-in-effect -- hidratación desde sessionStorage, solo posible tras montar en cliente
        if (datos.mensajes?.length) setMensajes(datos.mensajes);
        if (datos.brief) {
          briefRef.current = datos.brief;
          setBrief(datos.brief);
        }
        // El siguiente turno se valida con el mismo nivel con el que se armó la conversación.
        const nivelGuardado = creatividadGuardada(datos);
        if (nivelGuardado !== null) {
          creatividadRef.current = nivelGuardado;
          setCreatividad(nivelGuardado);
        }
        // D5: la propuesta aprobada y su imagen (reducida) sobreviven a la recarga.
        const hashes = new Set<string>((Array.isArray(datos.mensajes) ? datos.mensajes : [])
          .map((mensaje: { plan?: { plan_hash?: unknown } }) => mensaje?.plan?.plan_hash)
          .filter((hash: unknown): hash is string => typeof hash === "string"));
        const generacion = generacionParaRestaurar(leerGeneraciones(sessionStorage.getItem(CLAVE_GENERACIONES)), hashes);
        if (generacion) {
          setPlanAprobadoHash(generacion.planHash);
          if (generacion.sinVistaPrevia) {
            setVistaPreviaNoDisponibleHash(generacion.planHash);
          } else if (generacion.imagen) {
            setImagenes([generacion.imagen]);
            const [cabecera, base64] = generacion.imagen.split(",", 2);
            setUltimaImagenGenerada({ base64: base64 ?? "", mime: cabecera!.slice(5, cabecera!.indexOf(";")) || "image/jpeg", id: "PREVIOUS_RESULT", descripcion: "Previous generated result." });
          } else {
            setImagenNoGuardadaHash(generacion.planHash);
          }
        }
      }
    } catch {
      // sessionStorage no disponible — se sigue sin persistencia.
    }
    setCargadoDeStorage(true);
  }, []);

  // Miniaturas ya generadas de las fotos de los turnos (clave → data URL; "" si falló).
  const miniaturasRef = useRef(new Map<string, string>());
  // Última escritura de la conversación: una miniatura que termina tarde vuelve a guardar el estado más nuevo.
  const guardarChatRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!cargadoDeStorage) return;
    const guardar = () => {
      try {
        // Las fotos van como miniaturas livianas y con tope: sessionStorage tiene
        // un límite de pocos MB y un fallo aquí dejaría la conversación sin persistir.
        sessionStorage.setItem(CLAVE_CHAT, JSON.stringify({ mensajes: aligerarAdjuntos(mensajes, miniaturasRef.current), brief, creatividad }));
      } catch {
        try {
          sessionStorage.setItem(CLAVE_CHAT, JSON.stringify({ mensajes: mensajes.map((mensaje) => ({ ...mensaje, adjuntos: undefined })), brief, creatividad }));
        } catch {
          // sessionStorage no disponible — se sigue sin persistencia.
        }
      }
    };
    guardarChatRef.current = guardar;
    guardar();
    const faltantes = imagenesSinMiniatura(mensajes, miniaturasRef.current);
    if (!faltantes.length) return;
    void Promise.all(faltantes.map(async (imagen) => {
      const clave = claveImagen(imagen);
      miniaturasRef.current.set(clave, "");
      try {
        miniaturasRef.current.set(clave, await miniaturaImagen(imagen));
      } catch {
        // Sin miniatura esa foto no se guarda; la conversación sí.
      }
    })).then(() => guardarChatRef.current?.());
  }, [mensajes, brief, creatividad, cargadoDeStorage]);

  useEffect(() => {
    fetch("/api/ia/salud")
      .then((r) => r.json())
      .then((data) => {
        const disponibles = (data.proveedores ?? [])
          .filter((p: { disponible: boolean }) => p.disponible)
          .map((p: { id: ProveedorId }) => p.id);
        if (disponibles.length) {
          setProveedoresDisponibles(disponibles);
          setProveedor(data.predeterminado ?? disponibles[0]);
          // No pisar `selectorIA` acá: este endpoint solo conoce proveedores
          // Gemini (`ProveedorId`), nunca "lora" — sobrescribirlo en cada
          // carga volvía a Gemini el default real (LoRA) sin que el usuario
          // lo pidiera.
        }
      })
      .catch(() => {});
  }, []);

  async function cambiarSelector(nuevo: SelectorIA) {
    setSelectorIA(nuevo);
    if (nuevo === "lora") {
      setMensajes((previos) => [
        ...previos,
        {
          id: crypto.randomUUID(),
          role: "assistant",
            content: "Listo: las imágenes se crearán con el estilo Sempertex. Seguimos conversando igual.",
        },
      ]);
      return;
    }
    if (nuevo === proveedor) return;
    setProveedor(nuevo);
    try {
      await fetch("/api/ia/proveedor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proveedor: nuevo, alcance: "cliente" }),
      });
    } catch {
      // El cambio sigue aplicando por el override en cada request aunque falle la cookie.
    }
    setMensajes((previos) => [
      ...previos,
      {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Cambiado a ${NOMBRE_PROVEEDOR[nuevo]}. Sigo con el mismo contexto.`,
      },
    ]);
  }

  function finalizarUltimoMensaje(datos: DatosFin, adjuntosTurno?: AdjuntosTurno) {
    const briefActualizado = datos.brief ?? {};
    briefRef.current = briefActualizado;
    setBrief(briefActualizado);
    const recomendaciones: Producto[] = datos.recomendaciones ?? [];
    const decoracionesRecomendadas: DecoracionConProductos[] = datos.decoraciones ?? [];
    registrarConocidos(recomendaciones);
    for (const d of decoracionesRecomendadas) registrarConocidos(d.productos);

    const seleccionIA = datos.seleccionIA ?? [];

    if (seleccionIA.length > 0) {
      registrarConocidos(seleccionIA);
      // La IA propuso y confirmó su propia selección — sigue siendo la base
      // canónica si la página se recarga mientras se analiza una referencia.
      agregarVarios(seleccionIA);
      // La IA acaba de decidir: la imagen que está por generarse ya va a
      // reflejar esta selección, así que no hace falta pedir "Regenerar".
      setSeleccionPendiente(false);
    }

    setMensajes((previos) => {
      const copia = [...previos];
      const pasosTurno = copia[copia.length - 1].pasos;
      copia[copia.length - 1] = {
        id: copia[copia.length - 1].id,
        role: "assistant",
        content: datos.reply,
        pasos: pasosTurno?.length ? cerrarPasos(pasosTurno) : undefined,
        // Las fotos del turno acompañan a la propuesta (recortes por pieza).
        adjuntos: datos.plan ? adjuntosTurno : undefined,
        productos: recomendaciones.length ? recomendaciones : undefined,
        decoraciones: decoracionesRecomendadas.length ? decoracionesRecomendadas : undefined,
        categorias: datos.categorias?.length ? datos.categorias : undefined,
        categoriasFiltros: datos.categorias?.length ? datos.filtrosCategorias : undefined,
        referenceBlueprint: datos.referenceBlueprint ?? (datos.plan ? referenceDraftRef.current?.blueprint : undefined),
        plan: datos.plan,
        brief: datos.brief,
        // En modo plan la cotización preliminar pertenece al mismo mensaje que
        // contiene el blueprint y el plan; la imagen final lo actualiza ahí.
        cotizacion: seleccionIA.length ? undefined : datos.cotizacion ?? undefined,
        ragValidados: datos.ragValidados?.length ? datos.ragValidados : undefined,
        ragRechazados: datos.ragRechazados?.length ? datos.ragRechazados : undefined,
      };
      return copia;
    });
    if (datos.plan) setPlanAprobadoHash(null);
  }

  /**
   * Pieza que el cliente trae de fuera del catálogo (algo que ya tiene, o que
   * no está en Shopify): entra a la selección con un id propio para no
   * chocar con ids reales, y la descripción es lo único que la IA usa para
   * dibujarla, así que si el cliente no la llena se cae de vuelta al nombre.
   */
  function agregarPiezaManual(pieza: { nombre: string; descripcion: string; precio: number }) {
    agregarVarios([
      {
        id: `manual-${crypto.randomUUID()}`,
        nombre: pieza.nombre,
        categoria: "Personalizado",
        estilos: [],
        colores: [],
        descripcion: pieza.descripcion || pieza.nombre,
        precio: pieza.precio,
      },
    ]);
  }

  /**
   * Navegación directa por tipo de producto: el cliente ya eligió un tipo
   * tocando un chip con conteo real, así que no tiene sentido gastar un turno
   * de IA solo para traer la lista — se pide directo al catálogo. El chat de
   * texto sigue disponible para preguntarle algo puntual al modelo si quiere.
   */
  async function navegarCategoria(filtros: FiltrosCatalogo | undefined, categoria: Faceta) {
    if (cargandoChat) return;
    setError(null);
    setCargandoChat(true);
    setMensajes((previos) => [...previos, { id: crypto.randomUUID(), role: "user", content: categoria.etiqueta }]);

    try {
      const res = await fetch("/api/catalogo/piezas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(filtros ?? {}), categorias: [categoria.valor], limite: 20 }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError({ ui: leerUiErrorV1(data) ?? errorLocal("SERVICIO_NO_DISPONIBLE", campoTexto(data, "error") ?? `catalogo/piezas HTTP ${res.status}`), origen: "catalogo" });
        setMensajes((previos) => previos.slice(0, -1));
        return;
      }
      const productos: Producto[] = data.productos ?? [];
      registrarConocidos(productos);
      setMensajes((previos) => [
        ...previos,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `${categoria.etiqueta}: ${data.total} disponible${data.total === 1 ? "" : "s"}.`,
          productos: productos.length ? productos : undefined,
        },
      ]);
    } catch (reason) {
      setError({ ui: errorLocal("SIN_CONEXION", reason instanceof Error ? reason.message : "fetch catalogo/piezas falló"), origen: "catalogo" });
      setMensajes((previos) => previos.slice(0, -1));
    } finally {
      setCargandoChat(false);
    }
  }

  /**
   * `historialBase` permite reintentar un turno fallido: se reenvía el último
   * mensaje del cliente sobre la conversación anterior a él, sin duplicarlo.
   */
  async function enviar(texto: string, historialBase?: Mensaje[]) {
    if (cargandoChat) return;
    // El chat ya ve las imágenes adjuntas (van en el body más abajo), pero
    // igual necesita algo escrito para tener un mensaje de usuario coherente
    // en el historial. Si el cliente manda solo una imagen sin escribir
    // nada, se genera un mensaje descriptivo automático en vez de bloquear
    // el envío.
    let limpio = texto.trim();
    if (!limpio) {
      const hayEspacio = Boolean(fotoEspacio);
      const hayEstilo = imagenesReferencia.length > 0;
      if (hayEspacio && hayEstilo) limpio = "Adjunto una foto de mi espacio y unas imágenes de referencia de estilo.";
      else if (hayEspacio) limpio = "Adjunto una foto del espacio donde quiero la decoración.";
      else if (hayEstilo) limpio = "Adjunto imágenes de referencia del estilo que busco.";
      else return;
    }
    solicitudUsuarioRef.current = limpio;

    // Propuesta que ya está en pantalla (§7 "editar una propuesta desde el
    // chat"): se ecoa al backend para que el turno pueda ofrecer
    // ajustar_plan_decoracion en vez de solo poder diseñar una nueva. El
    // servidor vuelve a verificar el token firmado — esto es una pista, no
    // una autorización.
    const planVigenteActual = [...(historialBase ?? mensajes)].reverse().find((mensaje) => mensaje.role === "assistant" && mensaje.plan)?.plan;

    // Al reintentar se conservan las fotos del mensaje original; en un envío
    // nuevo son las del compositor en este momento.
    const adjuntosUsuario = historialBase
      ? mensajes.find((mensaje, indice) => indice >= historialBase.length && mensaje.role === "user")?.adjuntos
      : adjuntosDelTurno(imagenesReferencia, fotoEspacio);
    const nuevos: Mensaje[] = [...(historialBase ?? mensajes), { id: crypto.randomUUID(), role: "user", content: limpio, adjuntos: adjuntosUsuario }];
    // Burbuja vacía del asistente desde ya: ahí se va llenando el texto que
    // llega en streaming, en vez de esperar la respuesta completa.
    setMensajes([...nuevos, { id: crypto.randomUUID(), role: "assistant", content: "" }]);
    setEntrada("");
    setCargandoChat(true);
    setError(null);
    // El mensaje ya se ve enviado (burbuja + input limpio + "pensando"); si
    // el análisis de referencias sigue en curso, la espera ocurre aquí,
    // detrás de esa misma burbuja, en vez de con un error que obligue a
    // reenviar el turno. Termina en cuanto el análisis acaba o falla (el turno
    // sale sin plano de la foto y el cliente ve el error del análisis aparte);
    // el límite solo cubre un análisis que no responde.
    if (imagenesReferenciaRef.current.length > 0) await esperaAnalisis.esperar(LIMITE_ESPERA_ANALISIS_MS);
    // Fotos que realmente viajan en este turno (leídas de los refs, igual que el cuerpo).
    const adjuntosTurno = adjuntosDelTurno(imagenesReferenciaRef.current, fotoEspacioRef.current);
    const controlador = new AbortController();
    chatAbortRef.current = controlador;
    let excedioTiempo = false;
    let temporizador: number | undefined;
    const reiniciarLimiteInactividad = () => {
      if (temporizador !== undefined) window.clearTimeout(temporizador);
      temporizador = window.setTimeout(() => {
        excedioTiempo = true;
        controlador.abort();
      }, LIMITE_INACTIVIDAD_CHAT_MS);
    };
    reiniciarLimiteInactividad();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controlador.signal,
        body: JSON.stringify({
          messages: nuevos.map(({ role, content }) => ({ role, content })),
          brief: briefRef.current,
          proveedor,
          loraMode: loraModeRef.current ?? undefined,
          // Leídos de los refs (no del estado directo), mismo criterio que
          // en generar(): garantiza el valor más reciente sin importar
          // cuándo se creó este closure de enviar().
          fotoEspacio: fotoEspacioRef.current
            ? { base64: fotoEspacioRef.current.base64, mime: fotoEspacioRef.current.mime }
            : undefined,
          // El contrato chat.v1 es estricto: solo base64/mime. Las dimensiones
          // que agrega redimensionarImagen hacían fallar la validación (400).
          imagenesReferencia: imagenesReferenciaRef.current.length
            ? imagenesReferenciaRef.current.map(({ base64, mime }) => ({ base64, mime }))
            : undefined,
          // Mismo blueprint que ya produjo el panel de referencias en
          // paralelo (ver ReferenceReviewPanel) — el chat lo usa solo como
          // contexto de composición (plan de integración de referencias
          // visuales, R2); con el modo plan apagado el backend lo ignora.
          referenceBlueprint: referenceDraftRef.current?.blueprint ?? referenceDraft?.blueprint,
          creatividad: creatividadRef.current,
          planVigente: planVigenteActual ?? undefined,
        }),
      });

      const esStream = (res.headers.get("content-type") ?? "").includes("text/event-stream");
      reiniciarLimiteInactividad();

      if (esStream && res.body) {
        let hayError = false;
        await consumirSSE(res.body, {
          onTexto: (delta) => {
            setMensajes((previos) => {
              const copia = [...previos];
              const ultimo = copia[copia.length - 1];
              copia[copia.length - 1] = { ...ultimo, content: ultimo.content + delta };
              return copia;
            });
          },
          onHerramienta: (nombre, estado, ok) => {
            setMensajes((previos) => {
              const copia = [...previos];
              const ultimo = copia[copia.length - 1];
              if (ultimo?.role !== "assistant") return previos;
              copia[copia.length - 1] = { ...ultimo, pasos: aplicarEventoHerramienta(ultimo.pasos ?? [], nombre, estado, ok) };
              return copia;
            });
          },
          onFin: (datos) => finalizarUltimoMensaje(datos, adjuntosTurno),
          onError: (datos) => {
            hayError = true;
            setError({ ui: uiErrorDesdeEventoChat(datos), origen: "chat" });
            // Text the customer already read stays; only an empty bubble goes.
            setMensajes((previos) => {
              const ultimo = previos[previos.length - 1];
              return ultimo?.role === "assistant" && ultimo.content.trim() ? previos : previos.slice(0, -1);
            });
          },
          onActividad: reiniciarLimiteInactividad,
        });
        if (hayError) return;
      } else {
        // Los errores de preparación (por ejemplo, falta de llave) responden JSON.
        const data = await res.json();
        if (!res.ok) {
          const cuerpo: unknown = data;
          setError({
            ui: uiErrorDesdeEventoChat({ code: campoTexto(cuerpo, "code"), error: campoTexto(cuerpo, "error") ?? `chat HTTP ${res.status}`, causa: campoTexto(cuerpo, "causa"), request_id: campoTexto(cuerpo, "request_id"), retryable: campoReintentable(cuerpo) }),
            origen: "chat",
          });
          setMensajes((previos) => previos.slice(0, -1));
          return;
        }
        finalizarUltimoMensaje(data, adjuntosTurno);
      }
    } catch {
      if (controlador.signal.aborted && !excedioTiempo) {
        setMensajes((previos) => previos.slice(0, -1));
        return;
      }
      setError({
        ui: excedioTiempo
          ? errorLocal("TIEMPO_AGOTADO", "El navegador abortó el chat por inactividad del stream.")
          : errorLocal("SIN_CONEXION", "fetch /api/chat falló o el stream se cortó."),
        origen: "chat",
      });
      setMensajes((previos) => previos.slice(0, -1));
    } finally {
      if (temporizador !== undefined) window.clearTimeout(temporizador);
      if (chatAbortRef.current === controlador) chatAbortRef.current = null;
      setCargandoChat(false);
      entradaRef.current?.focus();
    }
  }

  // Foto elegida o subida en la pantalla inicial: el turno sale solo en cuanto
  // la foto está en el compositor. `enviar` espera el análisis detrás de la
  // burbuja del cliente y la propuesta llega sin otro clic (maqueta FotoAnalisis).
  useEffect(() => {
    const pendientes = envioAutomaticoRef.current;
    if (!pendientes || cargandoChat) return;
    if (!pendientes.every((clave) => imagenesReferencia.some((imagen) => claveImagen(imagen) === clave))) return;
    envioAutomaticoRef.current = null;
    void enviar(entrada);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- enviar y entrada se leen al momento de disparar; el ref evita enviar dos veces.
  }, [imagenesReferencia, cargandoChat]);

  /** Recupera tu último mensaje en el input y borra todo lo que vino después, para corregirlo y reenviarlo. */
  function cancelarChat() {
    chatAbortRef.current?.abort();
  }

  function editarUltimoMensaje(indice: number) {
    if (cargandoChat) return;
    setEntrada(mensajes[indice].content);
    setMensajes((previos) => previos.slice(0, indice));
    entradaRef.current?.focus();
  }

  /** Arranca de cero: conversación, brief, selección e imágenes generadas. */
  function limpiarTodo() {
    if (cargandoChat || generando) return;
    setMensajes([SALUDO]);
    briefRef.current = {};
    solicitudUsuarioRef.current = "";
    setBrief({});
    setImagenes([]);
    setReferenceDraft(null);
    referenceDraftRef.current = null;
    setEscenografiaApagada([]);
    escenografiaApagadaRef.current = [];
    setEstadoAnalisis("idle");
    esperaAnalisis.notificar("idle");
    setUltimaImagenGenerada(null);
    setUltimaGeneracion(null);
    setPromptModalAbierto(false);
    setError(null);
    setSeleccionPendiente(false);
    setSelectorIA("lora");
    loraModeRef.current = DEFAULT_LORA_MODE;
    setLoraModeParaBadge(DEFAULT_LORA_MODE);
    setFotoEspacio(null);
    setImagenesReferencia([]);
    setEtiquetasAdjuntos({});
    setEjemploElegido(null);
    setHojaSeleccionAbierta(false);
    setErrorAdjuntos(null);
    aspectoActivoRef.current = undefined;
    ultimaInteraccionIdRef.current = undefined;
    pendienteAutoGlobal = null;
    limpiarSeleccion();
    setPlanAprobadoHash(null);
    setImagenNoGuardadaHash(null);
    setVistaPreviaNoDisponibleHash(null);
    try {
      sessionStorage.removeItem(CLAVE_CHAT);
      sessionStorage.removeItem(CLAVE_CHAT_LEGACY);
      sessionStorage.removeItem(CLAVE_GENERACIONES);
    } catch {
      // sessionStorage no disponible — no hay nada que limpiar ahí.
    }
    entradaRef.current?.focus();
  }

  /**
   * `override` es la selección autónoma que la IA acaba de confirmar — si no
   * viene, es el clic manual (botón "Regenerar imagen" o generación inicial)
   * y se usa la selección del contexto compartido (`seleccionados`). Si ya
   * hay una generación en curso, no se pierde en silencio: se encola en
   * `pendienteAutoGlobal` y el effect de más abajo la dispara en cuanto
   * `generando` se libera.
   */
  async function generar(override: GenerarOverride) {
    if (imagenesReferenciaRef.current.length > 0 && !override?.plan) return;
    // Una regeneración de propuesta debe quedar ligada a sus propias fotos.
    // Si solo sobrevivieron miniaturas tras recargar, no se deben enviar al proveedor.
    const adjuntosAnclados = override.anchorMessageId !== undefined
      ? adjuntosParaGeneracion(override.adjuntos)
      : undefined;
    if (adjuntosAnclados?.tieneMiniaturas) {
      setError({
        ui: errorLocal("ADJUNTO_INVALIDO", "La propuesta conserva solo miniaturas. Vuelve a adjuntar las fotos originales."),
        origen: "generacion",
      });
      return;
    }
    const fotoEspacioParaGenerar = adjuntosAnclados ? adjuntosAnclados.fotoEspacio : fotoEspacioRef.current;
    const imagenesReferenciaParaGenerar = adjuntosAnclados ? adjuntosAnclados.referencias : imagenesReferenciaRef.current;
    const ultimaValidacion = [...mensajes]
      .reverse()
      .find((mensaje) => mensaje.role === "assistant" && mensaje.ragValidados?.length)?.ragValidados ?? [];
    // A RAG variant can remain in the shared selection after a later chat
    // turn validates a different set of variants. Provenance is conversation
    // metadata, not an id-shape guess, so retain every variant validated by
    // an assistant message in this conversation when splitting sources.
    const idsRagValidados = new Set(
      mensajes.flatMap((mensaje) => mensaje.ragValidados ?? []).map((item) => item.variantId),
    );
    // /api/generate resuelve variantes; `productId` del RAG es el producto
    // padre y no sirve para recuperar la foto/precio de la variante elegida.
    const idsDePiezasValidadas = ultimaValidacion.map((item) => item.variantId);
    const paquetesValidados = Object.fromEntries(ultimaValidacion.map((item) => [item.variantId, item.cantidad]));
    // RAG variants may be large numeric-looking ids, but provenance comes
    // from the validated message, never from the shape of an id. Everything
    // else in the shared browser selection remains a legacy productId.
    const seleccionPorFuente = classifyGenerationIds(seleccion, idsRagValidados);
    const idsSeleccionLegacy = seleccionPorFuente.productIds;
    // A confirmed size plan is authoritative: stale shared selections from
    // older chat turns must not re-enter as legacy productIds or extra RAG
    // variants during image generation.
    const idsBaseLegacy = override?.plan ? [] : [...idsSeleccionLegacy, ...(override?.ids ?? [])];
    const idsBaseRag = override?.plan
      ? override.plan.compras.map((compra) => compra.variant_id)
      : [...idsDePiezasValidadas, ...(override?.ragVariantIds ?? [])];
    // Con cotización existente, referencias solo definen composición. No
    // añaden sustitutos genéricos que desplacen las piezas reales cotizadas.
    //
    // `soloIds` (cotización editada a mano, ver `aplicarCotizacionEditada`):
    // `override.ids` ya es la lista completa y definitiva — mezclarla con la
    // selección compartida o con el último `ragValidados` reintroduciría
    // justo lo que el cliente acaba de quitar o reemplazar.
    const productIdsAUsar = override?.soloIds
      ? [...new Set(override.ids)]
      : idsBaseLegacy.length > 0
        ? [...new Set(idsBaseLegacy)]
        : [...new Set(override?.ids ?? [])];
    const ragVariantIdsAUsarSinNormalizar = override?.soloIds
      ? [...new Set(override.ragVariantIds ?? [])]
      : [...new Set(idsBaseRag)];
    const fuentesGeneracion = normalizeGenerationSources(productIdsAUsar, ragVariantIdsAUsarSinNormalizar);
    const productIdsGeneracion = fuentesGeneracion.productIds;
    const ragVariantIdsAUsar = fuentesGeneracion.ragVariantIds;
    const idsAUsar = [...new Set([...productIdsGeneracion, ...ragVariantIdsAUsar])];
    const paquetesAUsar = override?.soloIds
      ? { ...(override.paquetes ?? {}) }
      : { ...paquetesValidados, ...Object.fromEntries(seleccionados.map((producto) => [producto.id, producto.paquetes ?? 1])), ...(override?.paquetes ?? {}) };
    // Piezas "agregadas a mano" no existen en el catálogo real: /api/generate
    // solo puede validar/resolver ids de catálogo, así que viajan aparte con
    // sus datos completos en vez de como un id que el servidor no encontraría.
    const idsCatalogo = productIdsGeneracion.filter((id) => !id.startsWith("manual-"));
    const productosManuales = override?.soloIds
      ? override.manualProducts ?? []
      : seleccionados.filter((producto) => producto.id.startsWith("manual-") && idsAUsar.includes(producto.id));
    const briefAUsar = override?.brief ?? briefRef.current;
    const solicitudUsuario = override?.solicitudUsuario ?? solicitudUsuarioRef.current;
    if (idsAUsar.length === 0) return;

    // eslint-disable-next-line react-hooks/globals -- deliberado: encadenar sobre una promesa de módulo es justo lo que garantiza la serialización, ver declaración de colaGeneracion.
    colaGeneracion = colaGeneracion.then(async () => {
      if (generandoGlobal) {
        if (override) pendienteAutoGlobal = override;
        return;
      }
      generandoGlobal = true;
      ultimoIntentoGeneracionRef.current = { override };
      setGenerando(true);
      setSegundosGeneracion(0);
      setError(null);
      const usarLoraEnIntento = usarLoraEfectivo({
        modo: modoVista,
        selectorLora: selectorIA === "lora",
        estiloEstandarExplicito: Boolean(override?.estiloEstandar),
        hayFotoEspacio: Boolean(fotoEspacioParaGenerar),
        hayReferencias: imagenesReferenciaParaGenerar.length > 0,
        esAjusteDeImagen: Boolean((override?.instruccion ?? ajuste.trim()) && ultimaImagenGenerada),
      });

      const controlador = new AbortController();
      generacionAbortRef.current = controlador;
      const intervalo = window.setInterval(() => {
        setSegundosGeneracion((segundos) => segundos + 1);
      }, 1000);
      generacionIntervalRef.current = intervalo;

      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controlador.signal,
          body: JSON.stringify({
            productIds: idsCatalogo,
            ragVariantIds: ragVariantIdsAUsar.length ? ragVariantIdsAUsar : undefined,
            plan: override?.plan,
            planHash: override?.plan?.plan_hash,
            manualProducts: productosManuales.length ? productosManuales : undefined,
            productQuantities: paquetesAUsar,
            brief: briefAUsar,
            solicitudUsuario,
            instruccion: (override?.instruccion ?? ajuste.trim()) || undefined,
            proveedor,
            usarLora: usarLoraEnIntento,
            // El servidor ya no acepta una llamada LoRA sin modo resuelto
            // (PLAN-COMPOSICION-RICA-V001.md §1.1/§9.2: no hay fallback
            loraMode: usarLoraEnIntento ? loraModeRef.current ?? undefined : undefined,
            promptFormat: promptFormatParaGenerar(formatoPromptLora, usarLoraEnIntento),
            creatividad: creatividadRef.current,
            // Propuestas ancladas usan los adjuntos del mensaje exacto. Los
            // envíos nuevos usan el compositor actual.
            fotoEspacio: fotoEspacioParaGenerar
              ? { base64: fotoEspacioParaGenerar.base64, mime: fotoEspacioParaGenerar.mime }
              : undefined,
            // El panel y el chat analizan las referencias, pero el adaptador
            // LoRA también las necesita cuando usa /edit: el blueprint lleva
            // la composición de forma textual y los píxeles aportan la
            // relación visual que el modelo no puede reconstruir solo con el
            // plan. `/api/generate` limita y etiqueta estas imágenes antes de
            // enviarlas al proveedor.
            imagenesReferencia: imagenesReferenciaParaGenerar.length
              ? imagenesReferenciaParaGenerar
              : undefined,
            aspecto: fotoEspacioRef.current?.aspecto ?? aspectoActivoRef.current,
            blueprint: referenceDraftRef.current?.blueprint ?? referenceDraft?.blueprint,
            // Escenografía que el cliente apagó. Solo cambia lo que dibuja la
            // imagen: el servidor no la cotiza ni la mete en el plan.
            escenografia: escenografiaApagadaRef.current.length
              ? escenografiaApagadaRef.current.map((elementId) => ({ element_id: elementId, visible: false }))
              : undefined,
            previousGeneratedImage:
              (override?.instruccion ?? ajuste.trim()) && ultimaImagenGenerada
                ? ultimaImagenGenerada
                : undefined,
            previousInteractionId:
              (override?.instruccion ?? ajuste.trim()) && ultimaImagenGenerada
                ? ultimaInteraccionIdRef.current
                : undefined,
            revisionInstruction: (override?.instruccion ?? ajuste.trim()) || undefined,
          }),
        });
        const data = await res.json();

        if (!res.ok) {
          // ui-error.v1 es lo único que se muestra al cliente. Si la respuesta
          // no lo trae (ruta aún sin migrar), se muestra un aviso genérico y el
          // texto técnico queda solo en los detalles de modo dev.
          const cuerpo: unknown = data;
          const uiError = leerUiErrorV1(cuerpo);
          // D5 sin foto: la propuesta sí quedó aprobada; se registra con su aviso para que
          // al recargar no vuelva «Aprobar y ver cómo queda» como si nunca se hubiera aprobado.
          if (override?.plan && uiError?.code === "VISTA_PREVIA_NO_DISPONIBLE") {
            setPlanAprobadoHash(override.plan.plan_hash);
            setImagenNoGuardadaHash(null);
            setVistaPreviaNoDisponibleHash(override.plan.plan_hash);
            guardarVistaPreviaNoDisponible(override.plan.plan_hash);
          }
          setError({
            ui: uiError ?? respetarReintentable(errorLocal("ERROR_INTERNO", campoTexto(cuerpo, "error") ?? campoTexto(cuerpo, "message") ?? `generate HTTP ${res.status}`), campoReintentable(cuerpo), "generacion"),
            origen: "generacion",
          });
          return;
        }
        if (override?.plan) {
          const hashAprobado = typeof data.plan?.plan_hash === "string" ? data.plan.plan_hash : override.plan.plan_hash;
          setPlanAprobadoHash(hashAprobado);
          setImagenNoGuardadaHash(null);
          setVistaPreviaNoDisponibleHash(null);
          if (typeof data.imagen === "string") void guardarGeneracionAprobada(hashAprobado, data.imagen);
        }

         const modoGeneracion: GeneracionVisible["modo"] = data.modoImagen === "lora" ? "lora" : "gemini";
         const etiquetaGeneracion = modoGeneracion === "lora" ? "LoRA Sempertex" : "Nano Banana 2 (Gemini)";
        const prompts = typeof data.prompts === "object" && data.prompts !== null
          ? Object.entries(data.prompts as Record<string, unknown>)
              .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
              .map(([label, prompt]) => ({ label, prompt }))
          : typeof data.prompt === "string" && data.prompt.trim().length > 0
            ? [{ label: etiquetaGeneracion, prompt: data.prompt }]
            : [];
        setUltimaGeneracion({ modo: modoGeneracion, solicitado: selectorIA, etiqueta: etiquetaGeneracion, prompts });
        setPromptModalAbierto(abrirPromptAutomaticamente(modoVista, prompts.length > 0));
        ultimaInteraccionIdRef.current = typeof data.interactionId === "string" ? data.interactionId : undefined;
        // Con formato "ambos" llega una segunda imagen (prompt JSON) con la misma semilla.
        const imagenJson = typeof data.imagenAlternativa?.imagen === "string" && data.imagenAlternativa.imagen.startsWith("data:") ? data.imagenAlternativa.imagen : undefined;
        setImagenes((previas) => [data.imagen, ...(imagenJson ? [imagenJson] : []), ...previas]);
        setImagenAmpliada(null);
        // La imagen que se acaba de generar ya refleja la selección actual.
        seleccionGeneradaRef.current = seleccionRef.current;
        setSeleccionPendiente(false);
        if (data.cotizacion) {
          setMensajes((previos) => {
            const indiceAnclado = override?.anchorMessageId
              ? previos.findIndex((mensaje) => mensaje.id === override.anchorMessageId)
              : -1;
            if (override?.anchorMessageId && indiceAnclado < 0) return previos;
            const indiceAsistente = indiceAnclado >= 0
              ? indiceAnclado
              : [...previos].map((mensaje, indice) => ({ mensaje, indice })).reverse().find(({ mensaje }) => mensaje.role === "assistant")?.indice;
            if (indiceAsistente === undefined) {
              return [...previos, { id: crypto.randomUUID(), role: "assistant", content: "La visualización está lista. Esta es la cotización final de los productos usados.", cotizacion: data.cotizacion }];
            }
            const copia = [...previos];
            copia[indiceAsistente] = { ...copia[indiceAsistente], cotizacion: data.cotizacion };
            return copia;
          });
        }
        if (typeof data.imagen === "string" && data.imagen.startsWith("data:")) {
          const [header, base64] = data.imagen.split(",", 2);
          setUltimaImagenGenerada({ base64, mime: header.slice(5, header.indexOf(";")) || "image/png", id: "PREVIOUS_RESULT", descripcion: "Previous generated result." });
        }
        if (data.analisisReferencias?.referencias?.length) {
          setMensajes((previos) => [
            ...previos,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: "Así interpreté tus imágenes de referencia:",
              analisisReferencias: data.analisisReferencias,
            },
          ]);
        }
        setAjuste("");
      } catch (reason) {
        if (controlador.signal.aborted) {
          if (paginaMontadaRef.current) setError({ ui: errorLocal("OPERACION_CANCELADA", "El cliente canceló /api/generate."), origen: "generacion" });
          return;
        }
        setError({ ui: errorLocal("SIN_CONEXION", reason instanceof Error ? reason.message : "fetch /api/generate falló."), origen: "generacion" });
      } finally {
        window.clearInterval(intervalo);
        if (generacionIntervalRef.current === intervalo) generacionIntervalRef.current = null;
        if (generacionAbortRef.current === controlador) generacionAbortRef.current = null;
        generandoGlobal = false;
        if (paginaMontadaRef.current) {
          setGenerando(false);
          setSegundosGeneracion(0);
        }
      }
    });
  }

  /** Texto que se deja listo en el campo del chat; el cliente decide si lo envía. */
  function prepararMensajeChat(texto: string): void {
    setEntrada(texto);
    entradaRef.current?.focus();
  }

  /**
   * Acciones del aviso de error (ui-error.v1). Cada una responde a un clic del
   * cliente; ninguna se dispara sola.
   */
  function ejecutarAccionError(accion: AccionUiV1): void {
    const actual = error;
    if (!actual) return;
    setError(null);
    switch (accion) {
      case "reintentar": {
        if (actual.origen === "generacion") {
          const intento = ultimoIntentoGeneracionRef.current;
          if (intento) generar(intento.override);
          return;
        }
        if (actual.origen === "chat") {
          const indice = mensajes.map((mensaje) => mensaje.role).lastIndexOf("user");
          if (indice >= 0) void enviar(mensajes[indice].content, mensajes.slice(0, indice));
        }
        return;
      }
      case "generar_estilo_estandar": {
        const intento = ultimoIntentoGeneracionRef.current;
        if (intento) generar({ ...(intento.override ?? { ids: [] }), estiloEstandar: true });
        return;
      }
      case "revisar_propuesta": {
        const entradaPlan = [...mensajes].reverse().find((mensaje) => mensaje.role === "assistant" && mensaje.plan);
        if (entradaPlan) document.getElementById(`mensaje-${entradaPlan.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
      case "pedir_nueva_propuesta":
        prepararMensajeChat(actual.ui.code === "ESTILO_REQUIERE_PROPUESTA"
          ? "Arma una propuesta de decoración con las piezas que elegí."
          : "¿Puedes armar de nuevo la propuesta con el catálogo actual?");
        return;
      case "ajustar_propuesta":
        prepararMensajeChat(actual.ui.code === "PRESUPUESTO_EXCEDIDO"
          ? "Ajusta la propuesta para que quede dentro de mi presupuesto."
          : "Ajusta la propuesta, por favor.");
        return;
      case "revisar_adjuntos":
        document.getElementById("adjuntos-cliente")?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
    }
  }

  /**
   * D5: guarda la aprobación de `planHash` enseguida y luego una versión
   * reducida de la imagen si cabe en el presupuesto. Si sessionStorage la
   * rechaza, queda la aprobación sin imágenes (al recargar: «Ya generaste
   * esta imagen»).
   */
  async function guardarGeneracionAprobada(planHash: string, imagen: string): Promise<void> {
    const escribir = (imagenReducida: string | null | undefined) => {
      try {
        const previas = leerGeneraciones(sessionStorage.getItem(CLAVE_GENERACIONES));
        const siguientes = registrarGeneracion(previas, planHash, imagenReducida, Date.now());
        try {
          sessionStorage.setItem(CLAVE_GENERACIONES, serializarGeneraciones(siguientes));
        } catch {
          sessionStorage.setItem(CLAVE_GENERACIONES, serializarGeneraciones(sinImagenes(siguientes)));
        }
      } catch {
        // sessionStorage no disponible — la aprobación vive solo en memoria.
      }
    };
    // La aprobación primero (la imagen anterior de otro intento no aplica a esta generación).
    escribir(null);
    let reducida: string | null = null;
    for (const { maxDim, calidad } of REDUCCIONES_IMAGEN_GENERADA) {
      try {
        reducida = elegirImagenReducida([await miniaturaImagen({ base64: imagen, mime: "image/png" }, maxDim, calidad)]);
      } catch {
        break;
      }
      if (reducida) break;
    }
    if (reducida) escribir(reducida);
  }

  /** D5 sin foto: aprobación registrada con el aviso de vista previa no disponible, por plan_hash. */
  function guardarVistaPreviaNoDisponible(planHash: string): void {
    try {
      const previas = leerGeneraciones(sessionStorage.getItem(CLAVE_GENERACIONES));
      sessionStorage.setItem(CLAVE_GENERACIONES, serializarGeneraciones(registrarVistaPreviaNoDisponible(previas, planHash)));
    } catch {
      // sessionStorage no disponible — la aprobación vive solo en memoria.
    }
  }

  /** «Ya generaste esta imagen» o «vista previa no disponible»: el cliente decide volver a intentarlo (nueva generación). */
  function regenerarImagenAprobada(planHash: string | null): void {
    const entrada = [...mensajes].reverse().find((mensaje) => mensaje.role === "assistant" && mensaje.plan?.plan_hash === planHash);
    if (!entrada?.plan) return;
    aprobarPlan(entrada.plan, entrada.id);
  }

  function aprobarPlan(plan: PlanResuelto, messageId?: string): void {
    if (plan.comercial.estado === "PRESUPUESTO_EXCEDIDO" || plan.sin_cobertura.length > 0 || generando || generandoGlobal) return;
    const mensajeAnclado = messageId
      ? mensajes.find((mensaje) => mensaje.id === messageId && mensaje.role === "assistant" && mensaje.plan?.plan_hash === plan.plan_hash)
      : undefined;
    if (messageId && !mensajeAnclado) {
      setError({ ui: errorLocal("ADJUNTO_INVALIDO", "No pude recuperar las fotos de esta propuesta. Vuelve a adjuntarlas."), origen: "plan" });
      return;
    }
    generar({
      ids: [],
      ragVariantIds: plan.compras.map((compra) => compra.variant_id),
      plan,
      brief: briefRef.current,
      solicitudUsuario: solicitudUsuarioRef.current,
      anchorMessageId: messageId,
      adjuntos: mensajeAnclado?.adjuntos,
    });
    // Approving used to leave the customer where they were while the image was
    // made at the end of the thread. Take them to it once the block exists.
    window.setTimeout(() => {
      const reducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      document.querySelector("[data-testid='bloque-visualizacion']")?.scrollIntoView({ behavior: reducido ? "auto" : "smooth", block: "start" });
    }, 350);
  }

  function actualizarPlanEnMensaje(mensajeId: string, plan: PlanResuelto, cotizacion?: Cotizacion): void {
    setPlanAprobadoHash(null);
    setMensajes((previos) => previos.map((mensaje) => mensaje.id === mensajeId ? { ...mensaje, plan, cotizacion: cotizacion ?? mensaje.cotizacion } : mensaje));
  }


  // Dispara la generación automática que quedó encolada mientras otra seguía
  // en curso (ver el guard de `generando` dentro de `generar`).
  useEffect(() => {
    if (generando || analizandoFoto || hayPlanEnConversacion) return;
    const pendiente = pendienteAutoGlobal;
    if (!pendiente) return;
    // eslint-disable-next-line react-hooks/globals -- deliberado: consumir la cola encolada por generar(), ver declaración de pendienteAutoGlobal.
    pendienteAutoGlobal = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberado: disparar el trabajo ya encolado cuando se libera la generación.
    generar(pendiente);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- generar se recrea cada render; pendienteAutoGlobal ya evita relanzar dos veces.
  }, [generando, analizandoFoto, hayPlanEnConversacion]);

  function elegirDecoracion(decoracion: DecoracionConProductos) {
    agregarVarios(decoracion.productos);
  }

  async function subirFotoEspacio(file: File) {
    setErrorAdjuntos(null);
    try {
      const { base64, mime, ancho, alto, originalAncho, originalAlto } = await redimensionarImagen(file, 1600, 0.82);
      const aspecto = aspectoDe(ancho, alto);
      const recorte = await recortarAlAspecto(base64, mime, aspecto);
      setFotoEspacio({
        base64: recorte.base64,
        mime,
        ancho: recorte.ancho,
        alto: recorte.alto,
        originalAncho,
        originalAlto,
        aspecto,
      });
      // Se preserva aunque luego se quite el adjunto con el botón "✕": las
      // revisiones posteriores de la misma sesión deben seguir usando el
      // mismo lienzo que ya se generó, no volver al default del servidor.
      aspectoActivoRef.current = aspecto;
    } catch (e) {
      setErrorAdjuntos(mensajeErrorCliente(e, "No se pudo procesar la foto del espacio."));
    }
  }

  async function subirImagenesReferencia(files: FileList) {
    setErrorAdjuntos(null);
    const disponibles = LIMITE_REFERENCIAS_CLIENTE - imagenesReferencia.length;
    const lista = Array.from(files);
    const aProcesar = lista.slice(0, disponibles);
    if (lista.length > aProcesar.length) {
      setErrorAdjuntos(`Solo se usarán ${LIMITE_REFERENCIAS_CLIENTE} imágenes de referencia como máximo.`);
    }
    try {
      const procesadas = await Promise.all(aProcesar.map((f) => redimensionarImagen(f, 1800, 0.9)));
      setEtiquetasAdjuntos((previas) => ({ ...previas, ...Object.fromEntries(procesadas.map((imagen, indice) => [claveImagen(imagen), aProcesar[indice]!.name])) }));
      if (!mensajes.some((mensaje) => mensaje.id !== SALUDO.id)) envioAutomaticoRef.current = procesadas.map(claveImagen);
      setImagenesReferencia((previas) => [...previas, ...procesadas]);
    } catch (e) {
      setErrorAdjuntos(mensajeErrorCliente(e, "No se pudo procesar alguna imagen de referencia."));
    }
  }

  function quitarImagenReferencia(indice: number) {
    const quitada = imagenesReferencia[indice];
    setImagenesReferencia((previas) => previas.filter((_, i) => i !== indice));
    if (quitada && ejemploElegido?.clave === claveImagen(quitada)) setEjemploElegido(null);
  }

  /**
   * Foto de ejemplo de la galería: se adjunta como imagen de referencia con el
   * mismo redimensionado que una subida, vuela hasta su chip y el análisis
   * arranca solo (ReferenceAnalysisController reacciona a las referencias).
   * Reemplaza otra foto de ejemplo ya elegida en vez de acumularlas.
   */
  async function elegirEjemplo(foto: FotoEjemplo, miniatura: HTMLImageElement | null) {
    if (cargandoEjemplo || cargandoChat) return;
    setErrorAdjuntos(null);
    setCargandoEjemplo(true);
    try {
      const imagen = await imagenDeFotoEjemplo(foto);
      const clave = claveImagen(imagen);
      setEtiquetasAdjuntos((previas) => ({ ...previas, [clave]: foto.titulo }));
      const claveAnterior = ejemploElegido?.clave;
      setImagenesReferencia((previas) => {
        const sinEjemploAnterior = previas.filter((previa) => claveImagen(previa) !== claveAnterior);
        return [...sinEjemploAnterior, imagen].slice(-LIMITE_REFERENCIAS_CLIENTE);
      });
      setEjemploElegido({ id: foto.id, clave });
      if (!mensajes.some((mensaje) => mensaje.id !== SALUDO.id)) envioAutomaticoRef.current = [clave];
      setGaleriaAbierta(false);
      window.requestAnimationFrame(() => {
        const chips = document.querySelectorAll("[data-adjunto='referencia'] img");
        volarFoto(miniatura, chips[chips.length - 1] ?? null);
      });
      entradaRef.current?.focus();
    } catch (e) {
      setErrorAdjuntos(mensajeErrorCliente(e, "No se pudo cargar la foto de ejemplo."));
    } finally {
      setCargandoEjemplo(false);
    }
  }

  const planActualEntry = [...mensajes].reverse().find((mensaje) => mensaje.role === "assistant" && mensaje.plan);
  const planActual = planActualEntry?.plan;
  const planActualAprobado = Boolean(planActual && planAprobadoHash === planActual.plan_hash);
  // The balloon inflating while the image is made is one of the proposal's own colors.
  const coloresPlanActual = planActual ? [...new Set(planActual.estructuras.flatMap((estructura) => coloresCliente(estructura.lineas).map((muestra) => muestra.fondo)))] : [];
  const ultimoIndiceUsuario = mensajes.map((m) => m.role).lastIndexOf("user");
  // Estado inicial (maqueta EstadoInicial): todavía no hay turno del cliente.
  const enInicio = !mensajes.some((mensaje) => mensaje.id !== SALUDO.id);
  const contexto = contextoEventoConversacion(mensajes, brief);
  // C2: con una propuesta en la conversación, el plan es la selección; la lista manual solo en dev.
  const seleccionDisponible = esModoDev || !hayPlanEnConversacion;
  const referenciasVisibles = imagenesReferencia.map((imagen, indice) => ({
    src: dataUrl(imagen),
    etiqueta: etiquetasAdjuntos[claveImagen(imagen)] ?? `Foto de referencia ${indice + 1}`,
  }));

  function aplicarAjusteSobrePropuesta() {
    if (!planActual || !planActualAprobado || !ajuste.trim()) return;
    generar({
      ids: [],
      ragVariantIds: planActual.compras.map((compra) => compra.variant_id),
      plan: planActual,
      brief: briefRef.current,
      solicitudUsuario: solicitudUsuarioRef.current,
      instruccion: ajuste.trim(),
      anchorMessageId: planActualEntry?.id,
      adjuntos: planActualEntry?.adjuntos,
    });
  }

  // El análisis de la foto va en la conversación, justo después del mensaje
  // que la envió (maqueta FotoAnalisis); si la foto aún no se envió, queda al
  // final, pegado al compositor y a su chip (hallazgo #23). Se ubica con
  // `order` de flexbox para que el componente no cambie de lugar en el árbol:
  // moverlo lo volvería a montar y repetiría el análisis.
  const claveReferenciaActual = imagenesReferencia[0] ? claveImagen(imagenesReferencia[0]) : null;
  const indiceMensajeConFoto = claveReferenciaActual
    ? mensajes.findLastIndex((mensaje) => mensaje.role === "user" && mensaje.adjuntos?.referencias.some((imagen) => claveImagen(imagen) === claveReferenciaActual))
    : -1;
  const ordenAnalisis = indiceMensajeConFoto >= 0 ? indiceMensajeConFoto * 2 + 1 : ORDEN_AL_FINAL + 2;
  const analisisFoto = (
    <div style={{ order: ordenAnalisis }} className="w-full min-w-0 text-left empty:hidden" data-testid="analisis-foto-slot">
      <ReferenceAnalysisController
        references={imagenesReferencia}
        proveedor={proveedor}
        onDraft={(draft) => {
          referenceDraftRef.current = draft;
          setReferenceDraft(draft);
          // Otro análisis son otros `element_id`: lo que el cliente apagó en la
          // foto anterior no puede arrastrarse a la nueva.
          setEscenografiaApagada([]);
          escenografiaApagadaRef.current = [];
        }}
        onEstado={(estado) => {
          esperaAnalisis.notificar(estado);
          setEstadoAnalisis(estado);
        }}
        onElegirEjemplo={() => setGaleriaAbierta(true)}
      />
    </div>
  );

  const compositor = (
    <Compositor
      variante={enInicio ? "grande" : "normal"}
      entrada={entrada}
      onEntrada={setEntrada}
      onEnviar={() => void enviar(entrada)}
      cargando={cargandoChat}
      onCancelar={cancelarChat}
      placeholder={
        enInicio
          ? "Ej. cumpleaños de mi mamá en rosa y plateado…"
          : fotoEspacio || imagenesReferencia.length
            ? "Cuéntame qué quieres o solo envía la foto"
            : hayPlanEnConversacion
              ? "Pide un cambio: “más dorado”, “que sea más grande”…"
              : "Cuéntame de tu evento…"
      }
      inputRef={entradaRef}
      fotoEspacio={fotoEspacio ? { src: dataUrl(fotoEspacio), etiqueta: "Foto del espacio" } : null}
      onQuitarFotoEspacio={() => setFotoEspacio(null)}
      referencias={referenciasVisibles}
      onQuitarReferencia={quitarImagenReferencia}
      onArchivoEspacio={(archivo) => void subirFotoEspacio(archivo)}
      onArchivosReferencia={(archivos) => void subirImagenesReferencia(archivos)}
      puedeAgregarReferencia={imagenesReferencia.length < LIMITE_REFERENCIAS_CLIENTE}
      errorAdjuntos={errorAdjuntos}
    />
  );

  return (
    <div className="app-shell">
      <CabeceraApp
        contexto={contexto}
        creatividad={creatividad}
        onCreatividad={cambiarCreatividad}
        modoVista={modoVista}
        onModoVista={cambiarModoVista}
        onLimpiar={limpiarTodo}
        limpiarDeshabilitado={cargandoChat || generando}
        onAbrirSeleccion={seleccionDisponible ? () => setHojaSeleccionAbierta(true) : undefined}
        totalSeleccion={seleccionados.length}
        barraDev={
          <>
            <span className="font-medium text-texto-suave">Dev</span>
            <label htmlFor="selector-modelo" className="sr-only">Modelo para generar imágenes</label>
            <Select value={selectorIA} onValueChange={(v) => cambiarSelector(v as SelectorIA)}>
              <SelectTrigger id="selector-modelo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["gemini"] as ProveedorId[]).map((id) => (
                  <SelectItem key={id} value={id} disabled={!proveedoresDisponibles.includes(id)}>
                    <span className="inline-flex items-center gap-1.5">
                      {!proveedoresDisponibles.includes(id) && <Lock className="size-3" aria-hidden="true" />}
                      {NOMBRE_PROVEEDOR[id]}
                      {!proveedoresDisponibles.includes(id) ? " (sin llave)" : ""}
                    </span>
                  </SelectItem>
                ))}
                <SelectItem value="lora">{NOMBRE_SELECTOR.lora}</SelectItem>
              </SelectContent>
            </Select>
            {selectorIA === "lora" && (
              <>
                <label htmlFor="formato-prompt-lora" className="sr-only">Formato del prompt LoRA</label>
                <Select value={formatoPromptLora} onValueChange={(v) => { if (esSeleccionFormatoPrompt(v)) setFormatoPromptLora(v); }}>
                  <SelectTrigger id="formato-prompt-lora" title="Automático: el servidor elige el formato según el estilo LoRA. Texto: prompt entrenado. JSON: prompt estructurado. Ambos: dos imágenes con la misma semilla (doble costo).">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OPCIONES_FORMATO_PROMPT.map((formato) => (
                      <SelectItem key={formato} value={formato}>
                        {ETIQUETA_FORMATO_PROMPT[formato]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}
          </>
        }
      />

      <main className={`app-main ${enInicio ? "en-inicio" : ""}`}>
        <div
          ref={logChat}
          role="log"
          aria-live="polite"
          aria-label="Conversación con el asistente"
          aria-busy={cargandoChat}
          className="app-log scroll-suave"
        >
          {/* Un solo contenedor para inicio y chat: el análisis de la foto vive
              dentro y no debe volver a montarse al enviar el primer mensaje. */}
          <div className={`app-columna flex flex-col ${enInicio ? "inicio gap-6" : "gap-4"}`}>
            {enInicio && (
              <div style={{ order: 0 }}>
                <h2 className="inicio-titulo entra">¿Qué vamos a decorar?</h2>
                <p className="inicio-subtitulo entra" style={{ animationDelay: "0.1s" }}>
                  Cuéntame tu idea o muéstrame una foto de una decoración que te guste.
                </p>
              </div>
            )}
              <AnimatePresence initial={false}>
                {mensajes.map((m, i) => {
                  // El saludo lo reemplaza el estado inicial.
                  if (m.id === SALUDO.id) return null;
                  const esUltimoStreaming = i === mensajes.length - 1 && m.role === "assistant" && cargandoChat;
                  // El mensaje con el JSON del análisis de referencias es solo de diagnóstico (B2).
                  if (!esModoDev && m.analisisReferencias != null) return null;
                  const fotoMensaje = m.adjuntos?.referencias[0] ?? m.adjuntos?.fotoEspacio;
                  return (
                    <motion.div
                      key={m.id}
                      id={`mensaje-${m.id}`}
                      layout="position"
                      initial={{ opacity: 0, y: 10, filter: "blur(3px)" }}
                      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                      exit={{ opacity: 0, filter: "blur(3px)", transition: { duration: 0.15 } }}
                      transition={{ duration: 0.43, ease: [0.23, 1, 0.32, 1] }}
                      style={{ order: i * 2 }}
                      className="flex min-w-0 flex-col gap-3"
                    >
                      {m.role === "user" ? (
                        <div className="msg-usuario flex-col items-end gap-1">
                          <div className={`msg-usuario-burbuja ${fotoMensaje ? "con-foto" : ""}`} data-testid="mensaje-cliente">
                            {fotoMensaje && (
                              <button
                                type="button"
                                onClick={() => setImagenAmpliada(dataUrl(fotoMensaje))}
                                className="shrink-0 rounded-[0.625rem]"
                                aria-label="Ver la foto adjunta"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element -- miniatura local en base64 */}
                                <img src={dataUrl(fotoMensaje)} alt="" className="msg-usuario-foto" />
                              </button>
                            )}
                            <span className="min-w-0">{m.content}</span>
                          </div>
                          {i === ultimoIndiceUsuario && !cargandoChat && (
                            <button
                              type="button"
                              onClick={() => editarUltimoMensaje(i)}
                              className="text-xs text-texto-suave underline-offset-2 hover:text-acento hover:underline"
                            >
                              Editar y reenviar
                            </button>
                          )}
                        </div>
                      ) : (
                        <>
                          {m.pasos && m.pasos.length > 0 && <PasosAsistente pasos={m.pasos} terminado={!esUltimoStreaming} />}
                          {/* While the photo is being scanned, the scan is the only wait on screen. */}
                          {esUltimoStreaming && !m.content && !m.pasos?.length && !analizandoFoto ? (
                            <EsperaAsistente />
                          ) : m.content ? (
                            <div className="msg-asistente">
                              <Markdown>{m.content}</Markdown>
                            </div>
                          ) : null}
                        </>
                      )}

                      {/* Tarjetas/chips de selección: debajo del mensaje que las trajo. */}
                      {m.decoraciones && (
                        <div className="space-y-2">
                          <p className="text-xs text-texto-suave">
                            {m.decoraciones.length} decoraciones armadas. Elige una para empezar
                          </p>
                          {m.decoraciones.map((d) => (
                            <DecoracionCard key={d.id} decoracion={d} onElegir={elegirDecoracion} />
                          ))}
                        </div>
                      )}

                      {m.categorias && (
                        <div className="flex flex-wrap gap-2">
                          {m.categorias.map((c) => (
                            <button
                              key={c.valor}
                              type="button"
                              onClick={() => navegarCategoria(m.categoriasFiltros, c)}
                              disabled={cargandoChat}
                              className="ui-chip ui-pressable disabled:opacity-40"
                            >
                              {c.etiqueta}: {c.total}
                            </button>
                          ))}
                        </div>
                      )}

                      {m.productos && (
                        <div className="space-y-1.5">
                          <p className="text-xs text-texto-suave">
                            {m.productos.length} piezas disponibles. Toca para seleccionar
                          </p>
                          {m.productos.map((p) => (
                            <ProductoCard
                              key={p.id}
                              producto={p}
                              seleccionado={estaSeleccionado(p.id)}
                              onToggle={() => alternarSeleccion(p)}
                            />
                          ))}
                        </div>
                      )}

                      {m.plan && (
                        <TarjetaPlanDecoracion
                          plan={m.plan}
                          aprobado={planAprobadoHash === m.plan.plan_hash}
                          referenceBlueprint={m.referenceBlueprint}
                          imagenesReferencia={m.adjuntos?.referencias}
                          fotoEspacio={m.adjuntos?.fotoEspacio}
                          generando={generando && m.plan.plan_hash === planActual?.plan_hash}
                          modoDev={esModoDev}
                          onAprobar={m.plan.plan_hash === planActual?.plan_hash ? () => aprobarPlan(m.plan!, m.id) : undefined}
                          onPlanActualizado={m.plan.plan_hash === planActual?.plan_hash ? (plan, cotizacion) => actualizarPlanEnMensaje(m.id, plan, cotizacion) : undefined}
                          escenografiaApagada={escenografiaApagada}
                          onEscenografiaToggle={alternarEscenografia}
                          onPedirAjuste={m.plan.plan_hash === planActual?.plan_hash && !cargandoChat ? (texto) => void enviar(texto) : undefined}
                          loraMode={loraModeParaBadge}
                        />
                      )}
                      {m.cotizacion && (
                        <TarjetaCotizacion
                          cotizacion={m.cotizacion}
                          referenceBlueprint={m.referenceBlueprint}
                        />
                      )}

                      {/* Info de debug colapsada por defecto. */}
                      {esModoDev && m.analisisReferencias != null && (
                        <details className="rounded-xl border border-borde-suave bg-superficie px-3 py-2 text-xs text-texto-suave">
                          <summary className="cursor-pointer select-none">Ver JSON de análisis de referencias</summary>
                          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all">
                            {JSON.stringify(m.analisisReferencias, null, 2)}
                          </pre>
                        </details>
                      )}

                      {/* Verificación contra la fuente real (plan G-05): foto real y
                          ficha pública de Shopify para comprobar que no se inventó nada. */}
                      {m.ragValidados && m.ragValidados.length > 0 && (
                        <div className="space-y-1.5 rounded-xl border border-borde-suave bg-superficie p-2">
                          <p className="px-1 text-xs text-texto-suave">Verificar piezas de esta propuesta contra el catálogo real:</p>
                          {m.ragValidados.map((v) => (
                            <div key={v.variantId} className="flex items-center gap-2 rounded-lg p-1">
                              {v.imagen ? (
                                <button
                                  type="button"
                                  onClick={() => setImagenAmpliada(v.imagen!)}
                                  className="shrink-0 rounded-lg"
                                  aria-label={`Ver foto ampliada de ${v.titulo}`}
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={v.imagen} alt={v.titulo} className="size-12 rounded-lg object-cover" />
                                </button>
                              ) : (
                                <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-superficie-2 px-1 text-center text-[10px] font-semibold uppercase tracking-wide text-texto-suave">Sin foto</span>
                              )}
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-xs font-medium text-texto">{v.titulo}</span>
                                <span className="block text-xs text-texto-suave">
                                  {esModoDev ? `${v.sku ? `SKU ${v.sku}` : "sin SKU"} / ` : ""}{v.cantidad} {v.cantidad === 1 ? "paquete" : "paquetes"}
                                </span>
                              </span>
                              {v.handle && (
                                <a
                                  href={`https://www.sempertex.com/products/${v.handle}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="shrink-0 whitespace-nowrap text-xs text-acento underline underline-offset-2"
                                >
                                  Ver en la tienda ↗
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Fase 3.11 (honestidad estructural): una pieza descartada nunca pasa en silencio. */}
                      {m.ragRechazados && m.ragRechazados.length > 0 && (
                        <div className="space-y-1 rounded-xl border border-aviso/30 bg-aviso-suave p-2.5 text-xs text-aviso">
                          {esModoDev ? (
                            <>
                              <p className="font-medium">Piezas descartadas de esta propuesta:</p>
                              {m.ragRechazados.map((r) => (
                                <p key={`${r.productId}:${r.variantId}`}>⚠ {r.variantId}: {r.motivo}</p>
                              ))}
                            </>
                          ) : (
                            // Modo usuario: se avisa sin ids ni motivos técnicos (B2).
                            <p>{m.ragRechazados.length === 1 ? "Una pieza que te propuse ya no está disponible y la quité de la propuesta." : `${m.ragRechazados.length} piezas que te propuse ya no están disponibles y las quité de la propuesta.`}</p>
                          )}
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </AnimatePresence>

              {imagenes.length === 0 && !generando && imagenNoGuardadaHash !== null && imagenNoGuardadaHash === planAprobadoHash && (
                <section aria-label="Visualización" style={{ order: ORDEN_AL_FINAL }} className="ui-card space-y-2 p-4" data-testid="aviso-imagen-ya-generada">
                  <h2 className="text-sm font-semibold">Ya generaste esta imagen</h2>
                  <p className="text-sm text-texto-suave">
                    Aprobaste esta propuesta y su imagen se creó, pero no se pudo guardar en este navegador al recargar la página. Si quieres verla otra vez, puedes volver a crearla.
                  </p>
                  <button type="button" onClick={() => regenerarImagenAprobada(imagenNoGuardadaHash)} disabled={cargandoChat} className="ui-button-secondary ui-pressable">
                    Volver a crear la imagen
                  </button>
                </section>
              )}

              {imagenes.length === 0 && !generando && vistaPreviaNoDisponibleHash !== null && vistaPreviaNoDisponibleHash === planAprobadoHash && error?.ui.code !== "VISTA_PREVIA_NO_DISPONIBLE" && (
                <section aria-label="Visualización" style={{ order: ORDEN_AL_FINAL }} className="ui-card space-y-2 p-4" data-testid="aviso-vista-previa-no-disponible">
                  <h2 className="text-sm font-semibold">Aprobaste esta propuesta</h2>
                  <p className="text-sm text-texto-suave">{CATALOGO_ERRORES_UI_V1.VISTA_PREVIA_NO_DISPONIBLE.mensaje_usuario} Puedes volver a intentar la imagen más tarde.</p>
                  <button type="button" onClick={() => regenerarImagenAprobada(vistaPreviaNoDisponibleHash)} disabled={cargandoChat} className="ui-button-secondary ui-pressable">
                    Volver a intentar la imagen
                  </button>
                </section>
              )}

              {(imagenes.length > 0 || generando) && (
                <section aria-label="Visualización" style={{ order: ORDEN_AL_FINAL }} className="ui-card space-y-3 p-4" data-testid="bloque-visualizacion">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-sm font-semibold">Así quedaría</h2>
                    {esModoDev && ultimaGeneracion && (
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <span className="material-status" title="Proveedor que devolvió esta imagen">
                          Generada con {ultimaGeneracion.etiqueta}
                        </span>
                        {ultimaGeneracion.prompts.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setPromptModalAbierto(true)}
                            className="ui-button-secondary ui-pressable min-h-8 px-3 py-1 text-xs"
                          >
                            Ver prompt usado
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {generando && <CargaImagen segundos={segundosGeneracion} conMarco={imagenes.length === 0} colores={coloresPlanActual} />}

                  {imagenes.map((src, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setImagenAmpliada(src)}
                      className="block w-full cursor-zoom-in overflow-hidden rounded-2xl border border-borde-suave"
                      aria-label={`Ampliar visualización ${imagenes.length - i}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- imagen generada en base64 */}
                      <img src={src} alt={`Visualización ${imagenes.length - i}`} className="w-full transition hover:opacity-95" />
                    </button>
                  ))}

                  {imagenes.length > 0 && (
                    <>
                      <p className="text-xs text-texto-suave">Imagen referencial generada con IA. No es un render contractual.</p>
                      {seleccionPendiente && !generando && !planActual && (
                        <p className="rounded-xl bg-acento-suave px-3 py-2 text-xs font-medium text-acento">
                          Tu selección cambió: regenera para verla reflejada en la imagen.
                        </p>
                      )}
                      {(planActualAprobado || !planActual) && (
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <label htmlFor="ajuste-imagen" className="sr-only">Ajuste para la imagen</label>
                          <input
                            id="ajuste-imagen"
                            value={ajuste}
                            onChange={(e) => setAjuste(e.target.value)}
                            placeholder="Ajuste: “más velas”, “de noche”…"
                            className="ui-input min-w-0 flex-1"
                          />
                          {planActualAprobado ? (
                            <button type="button" onClick={aplicarAjusteSobrePropuesta} disabled={!ajuste.trim() || generando} className="ui-button-primary shrink-0">
                              Aplicar ajuste y regenerar
                            </button>
                          ) : null}
                        </div>
                      )}
                    </>
                  )}
                </section>
              )}

              {error && (
                <div data-testid="estado-error-chat" style={{ order: ORDEN_AL_FINAL + 1 }}>
                  <AvisoError
                    error={error.ui}
                    origen={error.origen}
                    accionesDisponibles={ACCIONES_POR_ORIGEN[error.origen]}
                    onAccion={ejecutarAccionError}
                    onCerrar={() => setError(null)}
                    mostrarDetallesDev={esModoDev}
                  />
                </div>
              )}

              {analisisFoto}
          </div>
        </div>

        <div className={enInicio ? "app-inicio-compositor" : "app-compositor-zona"}>
          <div className="app-columna">
            {!enInicio && seleccionDisponible && seleccionados.length > 0 && (
              <div className="mb-2 flex justify-end">
                <button type="button" onClick={() => setHojaSeleccionAbierta(true)} className="ui-chip ui-pressable inline-flex items-center gap-1.5" data-testid="abrir-seleccion">
                  Tu selección · {seleccionados.length}
                </button>
              </div>
            )}
            {compositor}
          </div>
        </div>

        {enInicio && (
          <div className="app-inicio-extra">
            <div className="app-columna flex flex-col items-center gap-10">
              <ul className="flex flex-wrap justify-center gap-2" aria-label="Ideas para empezar">
                {SUGERENCIAS.map((s) => (
                  <li key={s}>
                    <button type="button" onClick={() => void enviar(s)} className="ui-chip ui-pressable">
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
              <GaleriaEjemplos onElegir={(foto, miniatura) => void elegirEjemplo(foto, miniatura)} elegidaId={ejemploElegido?.id ?? null} deshabilitado={cargandoEjemplo} />
            </div>
          </div>
        )}
      </main>

      <HojaSeleccion
        abierta={hojaSeleccionAbierta && seleccionDisponible}
        onCerrar={() => setHojaSeleccionAbierta(false)}
        seleccionados={seleccionados}
        onQuitar={quitarSeleccion}
        onAgregarManual={agregarPiezaManual}
      />
      <DialogoEjemplos
        abierto={galeriaAbierta}
        onCerrar={() => setGaleriaAbierta(false)}
        onElegir={(foto, miniatura) => void elegirEjemplo(foto, miniatura)}
        elegidaId={ejemploElegido?.id ?? null}
        deshabilitado={cargandoEjemplo || cargandoChat}
      />
      <Lightbox src={imagenAmpliada} open={imagenAmpliada != null} onClose={() => setImagenAmpliada(null)} />
      <PromptModal
        entries={ultimaGeneracion?.prompts ?? []}
        open={esModoDev && promptModalAbierto}
        onClose={() => setPromptModalAbierto(false)}
      />
    </div>
  );
}
