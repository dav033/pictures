"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Search, Calculator, Ruler, PackageSearch, ClipboardCheck, NotebookPen, CheckCircle2, X, AlertCircle, Lock, Plus, Sparkles, ArrowUp, Paperclip, Home, Image as ImageIcon, type LucideIcon } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DecoracionCard } from "@/components/DecoracionCard";
import { ComparacionModelos, type ResultadoComparacion } from "@/components/ComparacionModelos";
import { Lightbox } from "@/components/Lightbox";
import { Markdown } from "@/components/Markdown";
import { ProductoCard } from "@/components/ProductoCard";
import { TarjetaCotizacion } from "@/components/TarjetaCotizacion";
import { TarjetaMedidas } from "@/components/TarjetaMedidas";
import { TarjetaPlanDecoracion } from "@/components/TarjetaPlanDecoracion";
import { GenerationQaSummary } from "@/components/references/GenerationQaSummary";
import { ReferenceAnalysisController } from "@/components/references/ReferenceAnalysisController";
import { ReferencePlanCard } from "@/components/references/ReferencePlanCard";
import type { ReferenceDraft } from "@/components/references/ReferenceReviewPanel";
import { useSeleccion } from "@/lib/estado/seleccion";
import type { LineaBorrador } from "@/lib/estado/borrador-cotizacion";
import type { Cotizacion } from "@/lib/cotizacion/motor";
import type { Imagen, PeticionImagen } from "@/lib/ia/tipos";
import type { ReferenceBlueprintV2 } from "@/lib/ia/reference-blueprint";
import type { ResultadoMedidas } from "@/lib/medidas/geometria";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import type { ItemValidado } from "@/lib/rag/chat/validar";
import type { ImageQaReport } from "@/lib/ia/image-qa";
import type { Faceta, FiltrosCatalogo } from "@/lib/shopify/consultas";
import type { Brief, DecoracionConProductos, Producto } from "@/lib/types";
import { classifyGenerationIds, normalizeGenerationSources } from "@/lib/generacion/provenance";

type ProveedorId = "gemini";
type SelectorIA = ProveedorId | "lora" | "comparar" | "gemini_sin_referencias";

const NOMBRE_PROVEEDOR: Record<ProveedorId, string> = {
  gemini: "Gemini 3.6 Flash / Nano Banana 2",
};

const NOMBRE_SELECTOR: Record<SelectorIA, string> = {
  ...NOMBRE_PROVEEDOR,
  lora: "LoRA Sempertex",
  comparar: "Comparar: Nano Banana 2 + LoRA",
  /** Prueba: aísla si el problema de composición es "falta entrenamiento" o
   * "el texto solo no alcanza ni con un modelo capaz" — mismo Gemini, cero
   * fotos de referencia/producto adjuntas, identidad solo por texto. */
  gemini_sin_referencias: "Gemini sin imágenes (prueba)",
};

type GeneracionVisible = {
  modo: "gemini" | "lora" | "comparar";
  solicitado: SelectorIA;
  etiqueta: string;
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
  medidas?: ResultadoMedidas;
  plan?: PlanResuelto;
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
};

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

// 4 franjas fijas de presupuesto — se guardan como propiedad del brief al
// tocarlas (como un adjunto más), sin mandar un mensaje de chat. `valor` es
// lo que se guarda en `brief.presupuesto`; se muestra igual en "Tu evento".
const ETIQUETAS_BRIEF: Record<keyof Brief, string> = {
  tipo_evento: "Evento",
  espacio: "Espacio",
  invitados: "Invitados",
  colores: "Colores",
  estilo: "Estilo",
  momento_dia: "Momento",
  fecha: "Fecha",
  presupuesto: "Presupuesto",
};

const ETIQUETA_HERRAMIENTA: Record<string, string> = {
  buscar_catalogo: "Buscando en el catálogo…",
  // Con RAG_ENABLED (la config actual) el modelo llama estas variantes, no
  // las de arriba — sin esto la etiqueta nunca se mostraba, siempre caía al
  // "Escribiendo…" genérico.
  buscar_catalogo_rag: "Buscando en el catálogo…",
  buscar_decoraciones: "Buscando paquetes armados…",
  calcular_medidas: "Calculando medidas…",
  cotizar: "Armando la cotización…",
  consultar_disponibilidad: "Revisando disponibilidad…",
  guardar_brief: "Guardando datos del evento…",
  confirmar_seleccion_ia: "Confirmando selección…",
  confirmar_seleccion_rag: "Confirmando selección…",
};

const LIMITE_INACTIVIDAD_CHAT_MS = 90_000;

const ICONO_HERRAMIENTA: Record<string, LucideIcon> = {
  buscar_catalogo: Search,
  buscar_catalogo_rag: Search,
  buscar_decoraciones: PackageSearch,
  calcular_medidas: Ruler,
  cotizar: Calculator,
  consultar_disponibilidad: ClipboardCheck,
  guardar_brief: NotebookPen,
  confirmar_seleccion_ia: CheckCircle2,
  confirmar_seleccion_rag: CheckCircle2,
};

/** Reemplaza el swap de texto plano por un cross-fade con ícono + pulso
 * continuo en la etiqueta — antes era un cambio instantáneo sin ninguna
 * señal visual de que algo sigue en curso. */
function EstadoHerramienta({ herramienta }: { herramienta: string | null }) {
  const etiqueta = (herramienta && ETIQUETA_HERRAMIENTA[herramienta]) ?? "Escribiendo…";
  const Icono = herramienta ? ICONO_HERRAMIENTA[herramienta] : undefined;
  return (
    <AnimatePresence mode="wait">
      <motion.span
        key={etiqueta}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        role="status"
        className="typing-indicator inline-flex items-center gap-1.5 text-sm text-texto-suave"
      >
        {Icono && <Icono className="size-3.5 shrink-0" aria-hidden="true" />}
        <motion.span
          animate={{ opacity: [0.55, 1, 0.55] }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        >
          {etiqueta}
        </motion.span>
        <span className="typing-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </motion.span>
    </AnimatePresence>
  );
}

type DatosFin = {
  reply: string;
  brief?: Brief;
  recomendaciones?: Producto[];
  decoraciones?: DecoracionConProductos[];
  categorias?: Faceta[];
  filtrosCategorias?: FiltrosCatalogo;
  medidas?: ResultadoMedidas;
  cotizacion?: Cotizacion;
  /** Piezas que la IA decidió proponer por su cuenta — dispara /api/generate sin que el cliente haga clic. */
  seleccionIA?: Producto[];
  instruccionIA?: string;
  ragValidados?: ItemValidado[];
  plan?: PlanResuelto;
  referenceBlueprint?: ReferenceBlueprintV2;
};

type GenerarOverride = {
  ids: string[];
  /** Exact RAG variant ids. Kept separate from legacy/manual catalog ids. */
  ragVariantIds?: string[];
  paquetes?: Record<string, number>;
  instruccion?: string;
  automaticOnly?: boolean;
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
  plan?: PlanResuelto;
  /** Mensaje exacto al que debe volver la cotización final de esta generación. */
  anchorMessageId?: string;
};

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
    onHerramienta: (nombre: string, estado: "ejecutando" | "lista") => void;
    onFin: (datos: DatosFin) => void;
    onError: (datos: { error?: string }) => void;
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
    const datos = JSON.parse(datosCrudo);
    manejadores.onActividad?.();
    if (evento === "texto") manejadores.onTexto(datos.delta);
    else if (evento === "herramienta") manejadores.onHerramienta(datos.nombre, datos.estado);
    else if (evento === "fin") {
      recibioFinal = true;
      manejadores.onFin(datos);
    } else if (evento === "error") {
      recibioError = true;
      manejadores.onError(datos);
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
    throw new Error(`"${file.name}" se leyó vacía o corrupta — probá exportarla de nuevo como JPEG o PNG.`);
  }

  try {
    const escala = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const ancho = Math.round(bitmap.width * escala);
    const alto = Math.round(bitmap.height * escala);

    const canvas = document.createElement("canvas");
    canvas.width = ancho;
    canvas.height = alto;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas no disponible.");
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
    if (!ctx) throw new Error("Canvas no disponible.");
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
  const [mensajes, setMensajes] = useState<Mensaje[]>([SALUDO]);
  const [entrada, setEntrada] = useState("");
  const [brief, setBrief] = useState<Brief>({});
  const [agregandoManual, setAgregandoManual] = useState(false);
  const [nombreManual, setNombreManual] = useState("");
  const [descripcionManual, setDescripcionManual] = useState("");
  const [precioManual, setPrecioManual] = useState("");
  const {
    ids: seleccion,
    productos: seleccionados,
    estaSeleccionado,
    alternar: alternarSeleccion,
    quitar: quitarSeleccion,
    agregarVarios,
    reemplazarTodo,
    registrarConocidos,
    limpiar: limpiarSeleccion,
  } = useSeleccion();
  const [imagenes, setImagenes] = useState<string[]>([]);
  const [imagenAmpliada, setImagenAmpliada] = useState<string | null>(null);
  const [ajuste, setAjuste] = useState("");
  const [cargandoChat, setCargandoChat] = useState(false);
  const [herramientaEnCurso, setHerramientaEnCurso] = useState<string | null>(null);
  const [generando, setGenerando] = useState(false);
  const [planDecoracionActivo, setPlanDecoracionActivo] = useState(false);
  const [segundosGeneracion, setSegundosGeneracion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [proveedor, setProveedor] = useState<ProveedorId>("gemini");
  const [selectorIA, setSelectorIA] = useState<SelectorIA>("gemini");
  const [proveedoresDisponibles, setProveedoresDisponibles] = useState<ProveedorId[]>(["gemini"]);
  // Últimas medidas calculadas en el chat: se le pasan al prompt de imagen
  // como referencia de escala (§3.6 del plan) — sin esto, un arco de 3 m
  // sale del mismo tamaño que uno de juguete en la imagen generada.
  const [ultimasMedidas, setUltimasMedidas] = useState<ResultadoMedidas | null>(null);
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
  const [referenceReady, setReferenceReady] = useState(true);
  const [ultimaQa, setUltimaQa] = useState<ImageQaReport | null>(null);
  const [comparacionActual, setComparacionActual] = useState<ResultadoComparacion[]>([]);
  const [ultimaImagenGenerada, setUltimaImagenGenerada] = useState<Imagen | null>(null);
  const [ultimaGeneracion, setUltimaGeneracion] = useState<GeneracionVisible | null>(null);
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
  const referenceReadyRef = useRef(true);
  const referenceDraftRef = useRef<ReferenceDraft | null>(null);
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

  const finChat = useRef<HTMLDivElement>(null);
  const entradaRef = useRef<HTMLInputElement>(null);
  const fotoEspacioInputRef = useRef<HTMLInputElement>(null);
  const referenciasInputRef = useRef<HTMLInputElement>(null);
  const menuAdjuntosRef = useRef<HTMLDivElement>(null);
  const [menuAdjuntosAbierto, setMenuAdjuntosAbierto] = useState(false);
  const referenciaGeneradaRef = useRef<string | null>(null);
  const [planAprobadoHash, setPlanAprobadoHash] = useState<string | null>(null);
  const hayPlanEnConversacion = mensajes.some((mensaje) => mensaje.role === "assistant" && Boolean(mensaje.plan));

  useEffect(() => {
    const reducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    finChat.current?.scrollIntoView({ behavior: reducido ? "auto" : "smooth" });
  }, [mensajes, cargandoChat]);

  useEffect(() => {
    fotoEspacioRef.current = fotoEspacio;
  }, [fotoEspacio]);

  useEffect(() => {
    if (!menuAdjuntosAbierto) return;
    function alClicFuera(evento: MouseEvent) {
      if (!menuAdjuntosRef.current?.contains(evento.target as Node)) setMenuAdjuntosAbierto(false);
    }
    function alEscape(evento: KeyboardEvent) {
      if (evento.key === "Escape") setMenuAdjuntosAbierto(false);
    }
    document.addEventListener("mousedown", alClicFuera);
    document.addEventListener("keydown", alEscape);
    return () => {
      document.removeEventListener("mousedown", alClicFuera);
      document.removeEventListener("keydown", alEscape);
    };
  }, [menuAdjuntosAbierto]);

  useEffect(() => {
    imagenesReferenciaRef.current = imagenesReferencia;
  }, [imagenesReferencia]);

  useEffect(() => {
    referenceReadyRef.current = referenceReady;
  }, [referenceReady]);

  useEffect(() => {
    referenceDraftRef.current = referenceDraft;
  }, [referenceDraft]);

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
        if (datos.ultimasMedidas) setUltimasMedidas(datos.ultimasMedidas);
      }
    } catch {
      // sessionStorage no disponible — se sigue sin persistencia.
    }
    setCargadoDeStorage(true);
  }, []);

  useEffect(() => {
    if (!cargadoDeStorage) return;
    try {
      sessionStorage.setItem(CLAVE_CHAT, JSON.stringify({ mensajes, brief, ultimasMedidas }));
    } catch {
      // idem
    }
  }, [mensajes, brief, ultimasMedidas, cargadoDeStorage]);

  useEffect(() => {
    fetch("/api/ia/salud")
      .then((r) => r.json())
      .then((data) => {
        const disponibles = (data.proveedores ?? [])
          .filter((p: { disponible: boolean }) => p.disponible)
          .map((p: { id: ProveedorId }) => p.id);
        setPlanDecoracionActivo(Boolean(data.planDecoracionActivo));
        if (disponibles.length) {
          setProveedoresDisponibles(disponibles);
          setProveedor(data.predeterminado ?? disponibles[0]);
          setSelectorIA(data.predeterminado ?? disponibles[0]);
        }
      })
      .catch(() => {});
  }, []);

  async function cambiarSelector(nuevo: SelectorIA) {
    setSelectorIA(nuevo);
    if (nuevo === "lora" || nuevo === "comparar" || nuevo === "gemini_sin_referencias") {
      setMensajes((previos) => [
        ...previos,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            nuevo === "comparar"
              ? "Modo comparativo activado: generaré dos imágenes con la misma propuesta — Nano Banana 2 (Gemini) y LoRA Sempertex."
              : nuevo === "gemini_sin_referencias"
                ? "Modo de prueba activado: Gemini generará sin ninguna imagen de referencia adjunta, solo con la descripción de texto. El chat continúa con el proveedor actual."
                : "LoRA Sempertex seleccionado para las imágenes. El chat continúa con el proveedor actual.",
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

  function finalizarUltimoMensaje(datos: DatosFin) {
    const briefActualizado = datos.brief ?? {};
    briefRef.current = briefActualizado;
    setBrief(briefActualizado);
    const recomendaciones: Producto[] = datos.recomendaciones ?? [];
    const decoracionesRecomendadas: DecoracionConProductos[] = datos.decoraciones ?? [];
    registrarConocidos(recomendaciones);
    for (const d of decoracionesRecomendadas) registrarConocidos(d.productos);
    if (datos.medidas) setUltimasMedidas(datos.medidas);

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
      copia[copia.length - 1] = {
        id: copia[copia.length - 1].id,
        role: "assistant",
        content: datos.reply,
        productos: recomendaciones.length ? recomendaciones : undefined,
        decoraciones: decoracionesRecomendadas.length ? decoracionesRecomendadas : undefined,
        categorias: datos.categorias?.length ? datos.categorias : undefined,
        categoriasFiltros: datos.categorias?.length ? datos.filtrosCategorias : undefined,
        medidas: datos.medidas ?? undefined,
        referenceBlueprint: datos.referenceBlueprint,
        plan: datos.plan,
        // En modo plan la cotización preliminar pertenece al mismo mensaje que
        // contiene el blueprint y el plan; la imagen final lo actualiza ahí.
        cotizacion: seleccionIA.length ? undefined : datos.cotizacion ?? undefined,
        ragValidados: datos.ragValidados?.length ? datos.ragValidados : undefined,
      };
      return copia;
    });
    if (datos.plan) setPlanAprobadoHash(null);

    if (seleccionIA.length > 0 && !datos.plan) {
      generar({
        ids: [],
        ragVariantIds: seleccionIA.map((p) => p.id),
        paquetes: Object.fromEntries(seleccionIA.map((p) => [p.id, p.paquetes ?? 1])),
        instruccion: datos.instruccionIA,
        brief: briefActualizado,
        solicitudUsuario: solicitudUsuarioRef.current,
      });
    }
  }

  /**
   * Pieza que el cliente trae de fuera del catálogo (algo que ya tiene, o que
   * no está en Shopify): entra a la selección con un id propio para no
   * chocar con ids reales, y la descripción es lo único que la IA usa para
   * dibujarla, así que si el cliente no la llena se cae de vuelta al nombre.
   */
  function agregarPiezaManual(e: React.FormEvent) {
    e.preventDefault();
    const nombre = nombreManual.trim();
    if (!nombre) return;
    agregarVarios([
      {
        id: `manual-${crypto.randomUUID()}`,
        nombre,
        categoria: "Personalizado",
        estilos: [],
        colores: [],
        descripcion: descripcionManual.trim() || nombre,
        precio: Number(precioManual) || 0,
      },
    ]);
    setNombreManual("");
    setDescripcionManual("");
    setPrecioManual("");
    setAgregandoManual(false);
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
        setError(data.error ?? "No se pudo cargar el catálogo.");
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
    } catch {
      setError("No se pudo contactar al servidor.");
      setMensajes((previos) => previos.slice(0, -1));
    } finally {
      setCargandoChat(false);
    }
  }

  /** El análisis de referencias corre en paralelo y normalmente termina en
   * segundos; en vez de bloquear el envío con un error, el turno se encola
   * aquí mismo y sale apenas `referenceReady` pase a true — al cliente le
   * llega la impresión de que su mensaje ya se está procesando, no de que
   * la app está lenta o rota. */
  function esperarReferenciasListas(): Promise<void> {
    if (referenceReadyRef.current) return Promise.resolve();
    return new Promise((resolve) => {
      const intervalo = window.setInterval(() => {
        if (referenceReadyRef.current) {
          window.clearInterval(intervalo);
          resolve();
        }
      }, 150);
    });
  }

  async function enviar(texto: string) {
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

    const nuevos: Mensaje[] = [...mensajes, { id: crypto.randomUUID(), role: "user", content: limpio }];
    // Burbuja vacía del asistente desde ya: ahí se va llenando el texto que
    // llega en streaming, en vez de esperar la respuesta completa.
    setMensajes([...nuevos, { id: crypto.randomUUID(), role: "assistant", content: "" }]);
    setEntrada("");
    setCargandoChat(true);
    setHerramientaEnCurso(null);
    setError(null);
    // El mensaje ya se ve enviado (burbuja + input limpio + "pensando"); si
    // el análisis de referencias sigue en curso, la espera ocurre aquí,
    // detrás de esa misma burbuja, en vez de con un error que obligue a
    // reenviar el turno.
    if (imagenesReferenciaRef.current.length > 0 && !referenceReadyRef.current) await esperarReferenciasListas();
    const controlador = new AbortController();
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
          // Leídos de los refs (no del estado directo), mismo criterio que
          // en generar(): garantiza el valor más reciente sin importar
          // cuándo se creó este closure de enviar().
          fotoEspacio: fotoEspacioRef.current
            ? { base64: fotoEspacioRef.current.base64, mime: fotoEspacioRef.current.mime }
            : undefined,
          imagenesReferencia: imagenesReferenciaRef.current.length ? imagenesReferenciaRef.current : undefined,
          // Mismo blueprint que ya produjo el panel de referencias en
          // paralelo (ver ReferenceReviewPanel) — el chat lo usa solo como
          // contexto de composición (plan de integración de referencias
          // visuales, R2); con el modo plan apagado el backend lo ignora.
          referenceBlueprint: referenceDraftRef.current?.blueprint ?? referenceDraft?.blueprint,
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
          onHerramienta: (nombre, estado) => {
            setHerramientaEnCurso(estado === "ejecutando" ? nombre : null);
          },
          onFin: finalizarUltimoMensaje,
          onError: (datos) => {
            hayError = true;
            setError(datos.error ?? "Algo salió mal.");
            setMensajes((previos) => previos.slice(0, -1));
          },
          onActividad: reiniciarLimiteInactividad,
        });
        if (hayError) return;
      } else {
        // Los errores de preparación (por ejemplo, falta de llave) responden JSON.
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Algo salió mal.");
          setMensajes((previos) => previos.slice(0, -1));
          return;
        }
        finalizarUltimoMensaje(data);
      }
    } catch {
      setError(excedioTiempo ? "El asistente tardó demasiado en responder. Intenta enviar el mensaje otra vez." : "No se pudo contactar al servidor.");
      setMensajes((previos) => previos.slice(0, -1));
    } finally {
      if (temporizador !== undefined) window.clearTimeout(temporizador);
      setCargandoChat(false);
      setHerramientaEnCurso(null);
      entradaRef.current?.focus();
    }
  }

  /** Recupera tu último mensaje en el input y borra todo lo que vino después, para corregirlo y reenviarlo. */
  function editarUltimoMensaje(indice: number) {
    if (cargandoChat) return;
    setEntrada(mensajes[indice].content);
    setMensajes((previos) => previos.slice(0, indice));
    entradaRef.current?.focus();
  }

  /** Arranca de cero: conversación, brief, medidas, selección e imágenes generadas. */
  function limpiarTodo() {
    if (cargandoChat || generando) return;
    setMensajes([SALUDO]);
    briefRef.current = {};
    solicitudUsuarioRef.current = "";
    setBrief({});
    setUltimasMedidas(null);
    setImagenes([]);
    setReferenceDraft(null);
    referenceDraftRef.current = null;
    setReferenceReady(true);
    referenciaGeneradaRef.current = null;
    setUltimaQa(null);
    setComparacionActual([]);
    setUltimaImagenGenerada(null);
    setUltimaGeneracion(null);
    setError(null);
    setSeleccionPendiente(false);
    setSelectorIA(proveedor);
    setFotoEspacio(null);
    setImagenesReferencia([]);
    setErrorAdjuntos(null);
    aspectoActivoRef.current = undefined;
    ultimaInteraccionIdRef.current = undefined;
    pendienteAutoGlobal = null;
    limpiarSeleccion();
    try {
      sessionStorage.removeItem(CLAVE_CHAT);
      sessionStorage.removeItem(CLAVE_CHAT_LEGACY);
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
  async function generar(override?: GenerarOverride) {
    const automaticIds = referenceDraftRef.current?.autoProductIds ?? referenceDraft?.autoProductIds ?? [];
    if (planDecoracionActivo && imagenesReferenciaRef.current.length > 0 && !override?.plan) return;
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
    const idsBaseLegacy = override?.plan
      ? []
      : override?.automaticOnly ? idsSeleccionLegacy : [...idsSeleccionLegacy, ...(override?.ids ?? [])];
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
        : [...new Set([...(override?.ids ?? []), ...automaticIds])];
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
    if (imagenesReferenciaRef.current.length > 0 && !referenceReady) {
      // eslint-disable-next-line react-hooks/globals -- deliberado: cola de deduplicación de generación en curso, ver declaración de pendienteAutoGlobal.
      pendienteAutoGlobal = { ids: productIdsGeneracion, ragVariantIds: ragVariantIdsAUsar, paquetes: paquetesAUsar, manualProducts: productosManuales, instruccion: (override?.instruccion ?? ajuste.trim()) || undefined, automaticOnly: override?.automaticOnly, brief: briefAUsar, solicitudUsuario };
      return;
    }
    if (idsAUsar.length === 0) return;

    // eslint-disable-next-line react-hooks/globals -- deliberado: encadenar sobre una promesa de módulo es justo lo que garantiza la serialización, ver declaración de colaGeneracion.
    colaGeneracion = colaGeneracion.then(async () => {
      if (generandoGlobal) {
        if (override) pendienteAutoGlobal = override;
        return;
      }
      generandoGlobal = true;
      setGenerando(true);
      setSegundosGeneracion(0);
      setError(null);

      const intervalo = setInterval(() => {
        setSegundosGeneracion((segundos) => segundos + 1);
      }, 1000);

      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
            usarLora: selectorIA === "lora",
            comparar: selectorIA === "comparar",
            sinReferencias: selectorIA === "gemini_sin_referencias",
            medidas: ultimasMedidas ?? undefined,
            // Adjuntos del cliente, leídos de los refs (no del estado
            // directamente): no son de un modo en particular, van en cualquier
            // generación, manual o automática, y deben reflejar lo último que
            // el cliente adjuntó aunque este `generar()` se haya disparado
            // desde un closure de `enviar()` abierto desde antes (ver
            // comentario en la declaración de `fotoEspacioRef`).
            fotoEspacio: fotoEspacioRef.current
              ? { base64: fotoEspacioRef.current.base64, mime: fotoEspacioRef.current.mime }
              : undefined,
            imagenesReferencia: imagenesReferenciaRef.current.length ? imagenesReferenciaRef.current : undefined,
            aspecto: fotoEspacioRef.current?.aspecto ?? aspectoActivoRef.current,
            blueprint: referenceDraftRef.current?.blueprint ?? referenceDraft?.blueprint,
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
          setError(data.error ?? "No se pudo generar la imagen.");
          return;
        }
        if (override?.plan) setPlanAprobadoHash(typeof data.plan?.plan_hash === "string" ? data.plan.plan_hash : override.plan.plan_hash);

        const modoGeneracion: GeneracionVisible["modo"] = data.modoImagen === "comparacion"
          ? "comparar"
          : data.modoImagen === "lora"
            ? "lora"
            : "gemini";
        const etiquetaGeneracion = modoGeneracion === "comparar"
          ? "Nano Banana 2 + LoRA"
          : modoGeneracion === "lora"
            ? "LoRA Sempertex"
            : selectorIA === "gemini_sin_referencias"
              ? "Gemini sin imágenes (prueba)"
              : "Nano Banana 2 (Gemini)";
        setUltimaGeneracion({ modo: modoGeneracion, solicitado: selectorIA, etiqueta: etiquetaGeneracion });
        ultimaInteraccionIdRef.current = typeof data.interactionId === "string" ? data.interactionId : undefined;
        setImagenes((previas) => [data.imagen, ...previas]);
        setImagenAmpliada(data.imagen);
        setComparacionActual(Array.isArray(data.comparacion) ? data.comparacion : []);
        setUltimaQa(data.qa ?? null);
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
      } catch {
        setError("No se pudo contactar al servidor.");
      } finally {
        clearInterval(intervalo);
        generandoGlobal = false;
        setGenerando(false);
      }
    });
  }

  function aprobarPlan(plan: PlanResuelto, messageId?: string): void {
    if (plan.comercial.estado === "PRESUPUESTO_EXCEDIDO" || plan.sin_cobertura.length > 0 || generando || generandoGlobal) return;
    generar({
      ids: [],
      ragVariantIds: plan.compras.map((compra) => compra.variant_id),
      plan,
      brief: briefRef.current,
      solicitudUsuario: solicitudUsuarioRef.current,
      anchorMessageId: messageId,
    });
  }

  function actualizarPlanEnMensaje(mensajeId: string, plan: PlanResuelto, cotizacion?: Cotizacion): void {
    setPlanAprobadoHash(null);
    setMensajes((previos) => previos.map((mensaje) => mensaje.id === mensajeId ? { ...mensaje, plan, cotizacion: cotizacion ?? mensaje.cotizacion } : mensaje));
  }

  /**
   * El cliente confirmó con "Listo" su edición de una cotización (tarjeta →
   * `useBorradorCotizacion`): `lineas` ya son las definitivas, sin lo que
   * quitó y con las cantidades/reemplazos que hizo. Sustituye la selección
   * compartida por esas piezas y regenera la imagen con ellas.
   *
   * Se empuja un mensaje de asistente nuevo (en vez de solo llamar
   * `generar()`, como hace el botón "Regenerar imagen") para que la
   * cotización final que traiga la respuesta tenga un ancla inequívoca:
   * `generar()` la engancha al último mensaje de asistente, y si el cliente
   * edita una tarjeta de un turno viejo, ese último mensaje podría no ser el
   * que se está editando.
   */
  function aplicarCotizacionEditada(lineas: LineaBorrador[]) {
    const productos: Producto[] = lineas
      // Una línea "sin referencia" que el cliente no llegó a reemplazar no
      // tiene una pieza real detrás — no hay nada que mandar a generar.
      .filter((linea): linea is LineaBorrador & { varianteId: string } => !linea.sinReferencia && Boolean(linea.varianteId))
      .map((linea) => ({
        id: linea.varianteId,
        nombre: linea.nombre ?? linea.tamano,
        categoria: linea.categoria ?? "",
        estilos: [],
        colores: linea.colores ?? [],
        descripcion: linea.descripcion ?? linea.nombre ?? linea.tamano,
        precio: linea.precioPaquete ?? 0,
        unidadesPaquete: linea.unidadesPaquete,
        paquetes: linea.paquetes ?? 1,
        tamanoCodigo: linea.tamanoCodigo,
        diamPulg: linea.diamPulg,
        foto: linea.foto,
      }));

    reemplazarTodo(productos);
    // The quote can mix a RAG line retained from an older turn with a legacy
    // replacement from this turn. Provenance belongs to the conversation,
    // not to the card's latest validation payload.
    const ragIds = new Set(
      mensajes.flatMap((mensaje) => mensaje.ragValidados ?? []).map((item) => item.variantId),
    );
    const productosPorFuente = classifyGenerationIds(productos.map((producto) => producto.id), ragIds);
    setMensajes((previos) => [
      ...previos,
      { id: crypto.randomUUID(), role: "assistant", content: "Listo, rehago la visualización con tus cambios." },
    ]);
    generar({
      ids: productosPorFuente.productIds,
      ragVariantIds: productosPorFuente.ragVariantIds,
      paquetes: Object.fromEntries(productos.map((producto) => [producto.id, producto.paquetes ?? 1])),
      manualProducts: productos.filter((producto) => producto.id.startsWith("manual-")),
      soloIds: true,
    });
  }

  // Dispara la generación automática que quedó encolada mientras otra seguía
  // en curso (ver el guard de `generando` dentro de `generar`).
  useEffect(() => {
    if (generando || !referenceReady || hayPlanEnConversacion) return;
    const pendiente = pendienteAutoGlobal;
    if (!pendiente) return;
    // eslint-disable-next-line react-hooks/globals -- deliberado: consumir la cola encolada por generar(), ver declaración de pendienteAutoGlobal.
    pendienteAutoGlobal = null;
    generar(pendiente);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- generar se recrea cada render; pendienteAutoGlobal ya evita relanzar dos veces.
  }, [generando, referenceReady, hayPlanEnConversacion]);

  // El flujo legacy conserva su generación automática por referencias. En el
  // modo plan el único disparador es aprobar el PlanResuelto.
  useEffect(() => {
    if (planDecoracionActivo || !referenceReady || !referenceDraft || !imagenesReferencia.length || generando || cargandoChat || hayPlanEnConversacion) return;
    const key = [
      imagenesReferencia.length,
      ...referenceDraft.blueprint.elements.map((element) => `${element.element_id}:${element.model_decision?.catalog_product_id ?? "omit"}`),
    ].join("|");
    if (referenciaGeneradaRef.current === key) return;
    referenciaGeneradaRef.current = key;
    generar({ ids: referenceDraft.autoProductIds, automaticOnly: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key ref evita relanzar la misma propuesta.
  }, [planDecoracionActivo, referenceReady, referenceDraft, imagenesReferencia.length, generando, cargandoChat, hayPlanEnConversacion]);

  /** No hay progreso real de la API — es un indicador de fase honesto por
   * tiempo transcurrido, no un porcentaje inventado. */
  function faseGeneracion(segundos: number): string {
    if (segundos < 3) return "Preparando referencias…";
    if (segundos < 45) return "Generando la imagen…";
    return "Casi lista, terminando detalles…";
  }

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
      setErrorAdjuntos(e instanceof Error ? e.message : "No se pudo procesar la foto del espacio.");
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
      setImagenesReferencia((previas) => [...previas, ...procesadas]);
    } catch (e) {
      setErrorAdjuntos(e instanceof Error ? e.message : "No se pudo procesar alguna imagen de referencia.");
    }
  }

  function quitarImagenReferencia(indice: number) {
    setImagenesReferencia((previas) => previas.filter((_, i) => i !== indice));
  }

  const entradasBrief = Object.entries(brief).filter(
    ([, v]) => v !== undefined && v !== null && String(v).length > 0,
  );
  const listoParaGenerar = (seleccion.length > 0 || Boolean(referenceDraft?.autoProductIds.length) || (imagenesReferencia.length > 0 && Boolean(referenceDraft?.blueprint))) && referenceReady;
  const planActualEntry = [...mensajes].reverse().find((mensaje) => mensaje.role === "assistant" && mensaje.plan);
  const planActual = planActualEntry?.plan;
  const planActualAprobado = Boolean(planActual && planAprobadoHash === planActual.plan_hash);
  const botonPlanBloqueado = Boolean(planActual && (planActual.comercial.estado === "PRESUPUESTO_EXCEDIDO" || planAprobadoHash === planActual.plan_hash));
  const ultimoIndiceUsuario = mensajes.map((m) => m.role).lastIndexOf("user");

  return (
    <div className="workspace-shell flex flex-1 flex-col">
      <header className="workspace-header material-topbar border-b px-4 py-3 sm:px-6">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="workspace-brand">
              <span className="workspace-mark" aria-hidden="true" />
              <div className="min-w-0">
                <p className="workspace-kicker">Sempertex studio</p>
                <h1 className="workspace-title">Asistente de decoración</h1>
                <p className="workspace-subtitle">De una idea suelta a una escena que puedes imaginar.</p>
              </div>
            </div>
            <div className="workspace-header-actions">
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
                  <SelectItem value="comparar">{NOMBRE_SELECTOR.comparar}</SelectItem>
                  <SelectItem value="gemini_sin_referencias">{NOMBRE_SELECTOR.gemini_sin_referencias}</SelectItem>
                </SelectContent>
              </Select>
              <button
                type="button"
                onClick={limpiarTodo}
                disabled={cargandoChat || generando}
                className="ui-button-ghost px-2 py-2 underline-offset-2 hover:underline disabled:opacity-40"
              >
                Limpiar chat
              </button>
            </div>
          </div>
          <nav aria-label="Herramientas" className="workspace-nav flex flex-wrap items-center gap-x-5 gap-y-1 border-t pt-2">
            <Link href="/catalogo" className="ui-nav-link hover:underline hover:underline-offset-2">
              Explorar catálogo
            </Link>
            <Link href="/laboratorio-referencias" className="ui-nav-link hover:underline hover:underline-offset-2">
              Laboratorio JSON
            </Link>
            <Link href="/admin" className="ui-nav-link hover:underline hover:underline-offset-2">
              Panel de administración
            </Link>
            <Link href="/configuracion-lora" className="ui-nav-link hover:underline hover:underline-offset-2">
              Configuración LoRA
            </Link>
          </nav>
        </div>
      </header>

      <main className="workspace-grid material-main grid flex-1 lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_25rem]">
        {/* Columna de chat */}
        <section className="workspace-stage material-chat flex min-h-[calc(100dvh-13rem)] flex-col lg:min-h-0">
          <div className="workspace-stage-header">
            <div>
              <p className="workspace-stage-kicker">Dirección creativa</p>
              <h2 className="workspace-stage-title">Diseña el ambiente de tu evento.</h2>
              <p className="workspace-stage-copy">
                Cuéntame la ocasión, el espacio y el estilo. Yo conecto la idea con piezas reales del catálogo.
              </p>
            </div>
            <div className="workspace-stage-meta" aria-label="Estado de la conversación">
              <strong>{entradasBrief.length ? "Brief en marcha" : "Listo para empezar"}</strong>
              <span>Curaduría + selección manual</span>
            </div>
          </div>
          <div
            role="log"
            aria-live="polite"
            aria-label="Conversación con el asistente"
            aria-busy={cargandoChat}
            className="workspace-log scroll-suave flex-1 space-y-4 overflow-y-auto px-4 py-6 sm:px-6 lg:min-h-0 lg:px-8"
          >
            {planDecoracionActivo && <ReferenceAnalysisController
               references={imagenesReferencia}
               venue={fotoEspacio}
               proveedor={proveedor}
               eventPalette={brief.colores}
               onDraft={(draft) => {
                 referenceDraftRef.current = draft;
                 setReferenceDraft(draft);
               }}
               onReady={setReferenceReady}
            />}
            <AnimatePresence initial={false}>
            {mensajes.map((m, i) => {
              const esUltimoStreaming = i === mensajes.length - 1 && m.role === "assistant" && cargandoChat;
              return (
              <motion.div
                key={m.id}
                layout="position"
                initial={{ opacity: 0, y: 10, filter: "blur(3px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, filter: "blur(3px)", transition: { duration: 0.15 } }}
                transition={{ duration: 0.43, ease: [0.23, 1, 0.32, 1] }}
                className={`chat-row mx-auto w-full max-w-4xl ${m.role === "user" ? "chat-row-user" : "chat-row-ia"}`}
              >
                <span className="chat-avatar" aria-hidden="true">
                  {m.role === "user" ? <span className="chat-avatar-initial">Tú</span> : <Sparkles className="size-4" />}
                </span>
                <div className="chat-column">
                <div
                  className={
                    m.role === "user"
                      ? "chat-bubble chat-bubble-user ml-auto max-w-[85%] px-4 py-2.5 text-sm text-white"
                      : `chat-bubble chat-bubble-ia max-w-[85%] px-4 py-2.5 text-texto${esUltimoStreaming ? " is-streaming" : ""}`
                  }
                >
                  {m.role === "assistant" ? (
                    esUltimoStreaming && !m.content ? (
                      <EstadoHerramienta herramienta={herramientaEnCurso} />
                    ) : (
                      <Markdown>{m.content}</Markdown>
                    )
                  ) : (
                    m.content
                  )}
                </div>

                {m.role === "user" && i === ultimoIndiceUsuario && !cargandoChat && (
                  <button
                    type="button"
                    onClick={() => editarUltimoMensaje(i)}
                    className="ml-auto mt-1 block text-xs text-texto-suave underline underline-offset-2 hover:text-acento"
                  >
                    Editar y reenviar
                  </button>
                )}

                {/* Tarjetas/chips de selección: siempre aparecen debajo del mensaje que las trajo, sin importar si la IA también armó su propia propuesta en el mismo turno. */}
                {m.decoraciones && (
                  <div className="mt-3 max-w-[85%] space-y-2">
                    <p className="text-xs text-texto-suave">
                      {m.decoraciones.length} decoraciones armadas. Elige una para empezar
                    </p>
                    {m.decoraciones.map((d) => (
                      <DecoracionCard key={d.id} decoracion={d} onElegir={elegirDecoracion} />
                    ))}
                  </div>
                )}

                {m.categorias && (
                  <div className="mt-3 flex max-w-[85%] flex-wrap gap-2">
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
                  <div className="mt-3 max-w-[85%] space-y-1.5">
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

                {m.medidas && <TarjetaMedidas medidas={m.medidas} />}
                {m.referenceBlueprint && <ReferencePlanCard blueprint={m.referenceBlueprint} plan={m.plan} />}
                {m.plan && <TarjetaPlanDecoracion plan={m.plan} aprobado={planAprobadoHash === m.plan.plan_hash} generando={generando && m.plan.plan_hash === planActual?.plan_hash} onAprobar={m.plan.plan_hash === planActual?.plan_hash ? () => aprobarPlan(m.plan!, m.id) : undefined} onPlanActualizado={m.plan.plan_hash === planActual?.plan_hash ? (plan, cotizacion) => actualizarPlanEnMensaje(m.id, plan, cotizacion) : undefined} />}
                {m.cotizacion && (
                  <TarjetaCotizacion
                    cotizacion={m.cotizacion}
                    referenceBlueprint={m.referenceBlueprint}
                    editable={!m.plan && !m.cotizacion.plan_hash && !cargandoChat && !generando}
                    onAplicar={!m.plan && !m.cotizacion.plan_hash ? aplicarCotizacionEditada : undefined}
                  />
                )}

                {/* Colapsado por defecto a propósito: es info de debug, no algo que el
                    cliente necesite ver de entrada — antes se mandaba como bloque de
                    código dentro del mensaje y el JSON grande reventaba el layout. */}
                {m.analisisReferencias != null && (
                  <details className="mt-2 max-w-[85%] rounded-lg border border-borde bg-superficie px-3 py-2 text-xs text-texto-suave">
                    <summary className="cursor-pointer select-none">Ver JSON de análisis de referencias</summary>
                    <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all">
                      {JSON.stringify(m.analisisReferencias, null, 2)}
                    </pre>
                  </details>
                )}

                {/* Verificación contra la fuente real (plan G-05): la tabla de texto
                    que redacta el modelo puede describir mal un producto sin que se
                    note. Esto deja ver la foto real y linkear a la ficha pública de
                    Shopify para comprobar que no se inventó nada. */}
                {m.ragValidados && m.ragValidados.length > 0 && (
                  <div className="mt-2 max-w-[85%] space-y-1.5 rounded-lg border border-borde bg-superficie p-2">
                    <p className="text-xs text-texto-suave">Verificar piezas de esta propuesta contra el catálogo real:</p>
                    {m.ragValidados.map((v) => (
                      <div key={v.variantId} className="flex items-center gap-2 rounded-lg p-1">
                        {v.imagen ? (
                          <button
                            type="button"
                            onClick={() => setImagenAmpliada(v.imagen!)}
                            className="shrink-0"
                            title="Ver foto ampliada"
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
                            {v.sku ? `SKU ${v.sku}` : "sin SKU"} / {v.cantidad} paq.
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
                </div>
              </motion.div>
              );
            })}
            </AnimatePresence>

            {mensajes.length === 1 && (
              <div className="quick-start pt-1">
                {SUGERENCIAS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => enviar(s)}
                    className="quick-action ui-pressable"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            <div ref={finChat} />
          </div>

          {error && (
            <p className="ui-alert mx-4 mb-2 sm:mx-6 lg:mx-8">
              {error}
            </p>
          )}

          {errorAdjuntos && (
            <p className="ui-alert mx-4 mb-2 sm:mx-6 lg:mx-8">
              {errorAdjuntos}
            </p>
          )}

          {/* Adjuntos del cliente: aportan contexto en ambos modos. */}
          <div className="workspace-attachments mx-auto flex w-full max-w-4xl flex-wrap items-center gap-2 px-4 pb-2 sm:px-6 lg:px-8">
            <input
              ref={fotoEspacioInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) subirFotoEspacio(file);
                e.target.value = "";
              }}
            />
            <input
              ref={referenciasInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) subirImagenesReferencia(e.target.files);
                e.target.value = "";
              }}
            />

            <AnimatePresence mode="wait" initial={false}>
              {fotoEspacio && (
                <motion.span
                  key="foto-espacio-adjunta"
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.85 }}
                  transition={{ duration: 0.15 }}
                  className="flex items-center gap-1.5 rounded-full border border-borde bg-superficie py-1 pl-1 pr-2 text-xs text-texto"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`data:${fotoEspacio.mime};base64,${fotoEspacio.base64}`}
                    alt="Foto del espacio"
                    className="h-6 w-6 rounded-full object-cover"
                  />
                  Foto del espacio
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => setFotoEspacio(null)}
                        aria-label="Quitar foto del espacio"
                        className="ui-pressable rounded-full px-1 text-texto-suave hover:text-acento"
                      >
                        <X className="size-3" aria-hidden="true" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Quitar foto del espacio</TooltipContent>
                  </Tooltip>
                </motion.span>
              )}
            </AnimatePresence>

            <AnimatePresence initial={false}>
              {imagenesReferencia.map((img, i) => (
                <motion.span
                  key={img.base64.slice(0, 40)}
                  layout
                  initial={{ opacity: 0, scale: 0.85 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.85 }}
                  transition={{ duration: 0.15 }}
                  className="flex items-center gap-1.5 rounded-full border border-borde bg-superficie py-1 pl-1 pr-2 text-xs text-texto"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`data:${img.mime};base64,${img.base64}`}
                    alt={`Referencia ${i + 1}`}
                    className="h-6 w-6 rounded-full object-cover"
                  />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => quitarImagenReferencia(i)}
                        aria-label={`Quitar imagen de referencia ${i + 1}`}
                        className="ui-pressable rounded-full px-1 text-texto-suave hover:text-acento"
                      >
                        <X className="size-3" aria-hidden="true" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Quitar imagen de referencia {i + 1}</TooltipContent>
                  </Tooltip>
                </motion.span>
              ))}
            </AnimatePresence>
           </div>

           {planActual && (
             <div className="workspace-plan-action-dock" aria-label="Acción del plan">
               <div className="mx-auto w-full max-w-4xl">
                 <button
                   type="button"
                   data-testid="aprobar-generar-plan-sticky"
                    onClick={() => aprobarPlan(planActual, planActualEntry?.id)}
                   disabled={planActualAprobado || generando || planActual.comercial.estado === "PRESUPUESTO_EXCEDIDO" || planActual.sin_cobertura.length > 0}
                   aria-busy={generando}
                   className="ui-button-primary ui-pressable w-full disabled:opacity-60"
                 >
                   {generando ? "Generando…" : planActualAprobado ? "Aprobación registrada" : planActual.sin_cobertura.length > 0 ? "Completa las piezas sin cobertura" : "Aprobar y generar imagen"}
                 </button>
               </div>
             </div>
           )}

           <form
            onSubmit={(e) => {
              e.preventDefault();
              enviar(entrada);
            }}
            className="workspace-composer chat-composer shrink-0 border-t border-borde px-4 py-3 sm:px-6 lg:px-8"
          >
            <div className={`chat-composer-pill mx-auto flex w-full max-w-4xl items-center gap-2 ${cargandoChat ? "is-busy" : ""}`}>
              <div ref={menuAdjuntosRef} className="relative shrink-0">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setMenuAdjuntosAbierto((abierto) => !abierto)}
                      aria-haspopup="menu"
                      aria-expanded={menuAdjuntosAbierto}
                      aria-label="Adjuntar imagen"
                      className="ui-pressable flex size-9 items-center justify-center rounded-full text-texto-suave hover:text-acento"
                    >
                      <Paperclip className="size-4" aria-hidden="true" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Adjuntar imagen</TooltipContent>
                </Tooltip>
                {menuAdjuntosAbierto && (
                  <div role="menu" className="absolute bottom-full left-0 z-10 mb-2 w-52 overflow-hidden rounded-lg border border-borde bg-superficie shadow-lg">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        fotoEspacioInputRef.current?.click();
                        setMenuAdjuntosAbierto(false);
                      }}
                      className="ui-pressable flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-texto hover:bg-superficie-2"
                    >
                      <Home className="size-4 text-texto-suave" aria-hidden="true" />
                      Foto de tu espacio
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={imagenesReferencia.length >= LIMITE_REFERENCIAS_CLIENTE}
                      onClick={() => {
                        referenciasInputRef.current?.click();
                        setMenuAdjuntosAbierto(false);
                      }}
                      className="ui-pressable flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-texto hover:bg-superficie-2 disabled:opacity-50"
                    >
                      <ImageIcon className="size-4 text-texto-suave" aria-hidden="true" />
                      Imagen de referencia
                    </button>
                  </div>
                )}
              </div>
              <input
                ref={entradaRef}
                name="mensaje"
                autoComplete="off"
                value={entrada}
                onChange={(e) => setEntrada(e.target.value)}
                placeholder={
                  fotoEspacio || imagenesReferencia.length
                    ? "Cuéntame de tu evento… (o solo pulsa Enviar con la imagen adjunta)"
                    : "Cuéntame de tu evento…"
                }
                aria-label="Escribe tu mensaje"
                className="chat-composer-input min-w-0 flex-1 text-sm text-texto outline-none placeholder:text-texto-suave"
              />
              <button
                type="submit"
                disabled={cargandoChat || (!entrada.trim() && !fotoEspacio && imagenesReferencia.length === 0)}
                // El texto se oculta por CSS bajo 480px y quedaría un botón
                // solo-ícono sin nombre accesible.
                aria-label="Enviar"
                className="chat-send ui-pressable shrink-0"
              >
                <span className="chat-send-label">Enviar</span>
                <ArrowUp className="size-4 shrink-0" aria-hidden="true" />
              </button>
            </div>
          </form>
        </section>

        {/* Panel lateral */}
        <aside aria-label="Panel de salida" className="workspace-sidebar scroll-suave space-y-5 border-t border-borde px-4 py-5 sm:px-6 lg:min-h-0 lg:border-l lg:border-t-0">
          {!planDecoracionActivo && <ReferenceAnalysisController
            references={imagenesReferencia}
            venue={fotoEspacio}
            proveedor={proveedor}
            eventPalette={brief.colores}
            onDraft={(draft) => {
              referenceDraftRef.current = draft;
              setReferenceDraft(draft);
            }}
            onReady={setReferenceReady}
          />}
          <div className="workspace-sidebar-pinned space-y-5">
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-texto-suave">
              Tu evento
            </h2>
            {entradasBrief.length === 0 ? (
              <p className="text-xs text-texto-suave">
                Se va llenando conforme platicas con el asistente.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {entradasBrief.map(([k, v]) => (
                  <span
                    key={k}
                    className="rounded-full border border-borde bg-superficie px-2.5 py-1 text-xs text-texto"
                  >
                    <span className="text-texto-suave">
                      {ETIQUETAS_BRIEF[k as keyof Brief] ?? k}:
                    </span>{" "}
                    {Array.isArray(v) ? v.join(", ") : String(v)}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-texto-suave">
                  Selección ({seleccionados.length})
                </h2>
                <button
                  type="button"
                  onClick={() => setAgregandoManual((v) => !v)}
                  className="flex shrink-0 items-center gap-1 text-xs font-medium text-acento hover:underline"
                >
                  <Plus className="size-3" aria-hidden="true" />
                  Agregar a mano
                </button>
              </div>
              <AnimatePresence initial={false}>
                {agregandoManual && (
                  <motion.form
                    onSubmit={agregarPiezaManual}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                    className="mb-2 space-y-2 overflow-hidden rounded-xl border border-borde bg-superficie p-3"
                  >
                    <input
                      value={nombreManual}
                      onChange={(e) => setNombreManual(e.target.value)}
                      placeholder="Nombre de la pieza"
                      required
                      autoFocus
                      className="w-full rounded-lg border border-borde bg-fondo px-2.5 py-1.5 text-xs text-texto outline-none focus:border-acento"
                    />
                    <textarea
                      value={descripcionManual}
                      onChange={(e) => setDescripcionManual(e.target.value)}
                      placeholder="Descripción visual (para que la IA la dibuje)"
                      rows={2}
                      className="w-full resize-none rounded-lg border border-borde bg-fondo px-2.5 py-1.5 text-xs text-texto outline-none focus:border-acento"
                    />
                    <input
                      value={precioManual}
                      onChange={(e) => setPrecioManual(e.target.value)}
                      type="number"
                      min={0}
                      placeholder="Precio (opcional)"
                      className="w-full rounded-lg border border-borde bg-fondo px-2.5 py-1.5 text-xs text-texto outline-none focus:border-acento"
                    />
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setAgregandoManual(false)}
                        className="rounded-lg px-2.5 py-1.5 text-xs text-texto-suave hover:text-texto"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        className="rounded-lg bg-acento px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90"
                      >
                        Agregar
                      </button>
                    </div>
                  </motion.form>
                )}
              </AnimatePresence>
              {seleccionados.length === 0 ? (
                <p className="text-xs text-texto-suave">
                  Pide recomendaciones en el chat y elige las piezas que te gusten.
                </p>
              ) : (
                <ul className="space-y-1">
                  <AnimatePresence initial={false}>
                    {seleccionados.map((p) => (
                      <motion.li
                        key={p.id}
                        layout
                        initial={{ opacity: 0, x: 8 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 8, transition: { duration: 0.12 } }}
                        transition={{ duration: 0.2, ease: "easeOut" }}
                        className="flex items-center gap-2 text-xs text-texto"
                      >
                        <span aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded-full bg-superficie-2 text-[10px] font-semibold uppercase text-texto-suave">
                          {p.nombre.slice(0, 1)}
                        </span>
                        <span className="flex-1 truncate">{p.nombre}</span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => quitarSeleccion(p.id)}
                              aria-label={`Quitar ${p.nombre}`}
                              className="text-texto-suave hover:text-acento"
                            >
                              <X className="size-3" aria-hidden="true" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>Quitar {p.nombre}</TooltipContent>
                        </Tooltip>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              )}
          </section>

          <section className="space-y-2">
            {imagenes.length > 0 && (
              <input
                value={ajuste}
                onChange={(e) => setAjuste(e.target.value)}
                placeholder="Ajuste: 'más velas', 'de noche'…"
                className="w-full rounded-xl border border-borde bg-superficie px-3 py-2 text-xs text-texto outline-none placeholder:text-texto-suave focus:border-acento"
              />
            )}
            <AnimatePresence>
              {seleccionPendiente && !generando && (
                <motion.p
                  initial={{ opacity: 0, y: -6, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.97 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                  className="flex items-center gap-1.5 rounded-lg bg-acento-suave px-2.5 py-2 text-xs font-semibold text-acento"
                >
                  <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
                  Tu selección cambió — regenera para verla reflejada en la imagen.
                </motion.p>
              )}
            </AnimatePresence>
            <button
              type="button"
              onClick={() => {
                if (planDecoracionActivo && imagenesReferencia.length > 0 && !planActual) return;
                if (!planActual) {
                  generar();
                  return;
                }
                if (planAprobadoHash === planActual.plan_hash && ajuste.trim()) {
                  generar({
                    ids: [],
                    ragVariantIds: planActual.compras.map((compra) => compra.variant_id),
                    plan: planActual,
                    brief: briefRef.current,
                    solicitudUsuario: solicitudUsuarioRef.current,
                    instruccion: ajuste.trim(),
                    anchorMessageId: planActualEntry?.id,
                  });
                  return;
                }
                aprobarPlan(planActual, planActualEntry?.id);
              }}
              disabled={planActual ? (botonPlanBloqueado && !ajuste.trim()) || generando : !listoParaGenerar || generando || (planDecoracionActivo && imagenesReferencia.length > 0)}
              aria-busy={generando}
              className="ui-button-primary ui-pressable w-full"
            >
              {planActual && planAprobadoHash === planActual.plan_hash
                ? ajuste.trim() ? "Aplicar ajuste y regenerar" : "Aprobación registrada"
                : planActual
                  ? "Aprobar y generar imagen"
                  : planDecoracionActivo && imagenesReferencia.length > 0
                    ? "Espera el plan comercial"
                    : generando
                      ? "Generando…"
                      : seleccionPendiente
                        ? "Regenerar imagen"
                        : imagenes.length > 0
                          ? "Generar otra versión"
                          : "Generar visualización"}
            </button>
            {!listoParaGenerar && !generando && (
              <p className="text-xs text-texto-suave">{referenceReady ? "Necesitas una pieza o referencia para generar." : "La IA está resolviendo las referencias."}</p>
            )}
            {planDecoracionActivo && imagenesReferencia.length > 0 && !planActual && referenceReady && !generando && (
              <p className="text-xs text-texto-suave">La imagen se habilita después de aprobar el plan que relaciona tus referencias con productos reales.</p>
            )}
          </section>

          {/* Única señal de que la imagen se está armando sola cuando la dispara la IA, sin que el cliente haya pulsado el botón. */}
          <AnimatePresence>
            {generando && (
              <motion.p
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.2 }}
                className="material-generating text-center text-xs"
                role="status"
                aria-live="polite"
              >
                <motion.span
                  animate={{ opacity: [0.6, 1, 0.6] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                >
                  {faseGeneracion(segundosGeneracion)} ({segundosGeneracion}s). Puede tardar hasta 2 min.
                </motion.span>
              </motion.p>
            )}
          </AnimatePresence>

          {comparacionActual.length > 0 && (
            <ComparacionModelos resultados={comparacionActual} onOpen={setImagenAmpliada} />
          )}

          {imagenes.length > 0 && comparacionActual.length === 0 && (
            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-texto-suave">
                  Visualizaciones
                </h2>
                {ultimaGeneracion && (
                  <span className="material-status" title="Proveedor que devolvió esta imagen">
                    Generada con {ultimaGeneracion.etiqueta}
                  </span>
                )}
              </div>
              {ultimaGeneracion?.solicitado === "comparar" && ultimaGeneracion.modo !== "comparar" && (
                <p className="rounded-xl border border-aviso/40 bg-aviso/10 px-3 py-2 text-xs leading-5 text-aviso" role="status">
                  Solicitaste una comparación, pero el servidor devolvió una sola salida: {ultimaGeneracion.etiqueta}.
                </p>
              )}
              {imagenes.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={src}
                  alt={`Visualización ${imagenes.length - i}`}
                  onClick={() => setImagenAmpliada(src)}
                  className="w-full cursor-zoom-in rounded-xl border border-borde transition hover:opacity-90"
                />
              ))}
              <p className="text-xs text-texto-suave">
                Imagen referencial generada con IA. No es un render contractual.
              </p>
              <GenerationQaSummary qa={ultimaQa} />
            </section>
          )}
          </div>
        </aside>
      </main>

      <Lightbox src={imagenAmpliada} open={imagenAmpliada != null} onClose={() => setImagenAmpliada(null)} />
    </div>
  );
}
