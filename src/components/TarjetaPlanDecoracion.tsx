"use client";

/* Catalog images come from runtime URLs and already carry explicit dimensions. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import { ArrowLeftRight, Check, ChevronDown, Info, Plus, Search, X } from "lucide-react";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import type { Cotizacion } from "@/lib/cotizacion/motor";
import type { ProductoCandidato, VarianteCandidata } from "@/lib/rag/chat/buscar";
import { puntuacionCromatica } from "@/lib/rag/catalog/similitud-color";
import { ReferenciasEntrenamientoModal, type ReferenciasEvidenciaData } from "@/components/ReferenciasEntrenamientoModal";
import type { LoraModeSlug } from "@/lib/lora/schema";
import { esCancelacion, FalloPlanEditar, mensajeErrorRespuesta, mensajeFalloPlanEditar, pedirPlanEditar } from "@/lib/plan/peticion-plan-editar";
import { mensajeErrorCliente } from "@/lib/estado/mensaje-error-cliente";
import { identificarEstructuraOficial } from "@/lib/plan/estructuras-oficiales";
import { esSustitucionDeColor } from "@/lib/plan/colores-referencia";
import type { ReferenceBlueprintV2 } from "@/lib/ia/referencia/reference-blueprint";
import {
  coloresCliente,
  compararLineasPorTamanoCliente,
  contar,
  describirEstructuraCliente,
  escenografiaCliente,
  esEstructuraDeGlobos,
  faltantesCliente,
  medidasCortasCliente,
  muestraColor,
  nombreConCantidadCliente,
  paquetesCliente,
  piezasVistasEnReferencia,
  productoCliente,
  productoConTamanoCliente,
  pulgadasCliente,
  pulgadasConCentimetrosCliente,
  lineaQuitable,
  resumenPlanCliente,
  supuestoCliente,
  sustitucionesCliente,
  tamanosCliente,
  ubicacionCortaCliente,
} from "@/lib/plan/presentacion-cliente";
import { DetalleEstructura } from "@/components/plan/DetalleEstructura";
import { DialogoCotizacion, gruposCotizacionPlan } from "@/components/plan/DialogoCotizacion";
import { BarraTamanos, tramosPorTamano } from "@/components/plan/BarraTamanos";
import { ChipEstructura, ENTRADA_CASCADA, TarjetaPiezaFoto, TarjetaProducto, type PiezaPropuestaVista, type ProductoPropuestaVista } from "@/components/plan/PiezasPropuesta";
import { NumeroAnimado } from "@/components/propuesta/NumeroAnimado";
import { BotonAprobar } from "@/components/propuesta/BotonAprobar";
import { GlobosCelebracion } from "@/components/propuesta/GlobosCelebracion";
import { AjustesPropuesta, type AjustePropuesta } from "@/components/plan/AjustesPropuesta";
import { PanelEspacio } from "@/components/referencia/PanelEspacio";
import { imagenDeReferencia, urlImagen } from "@/components/referencia/recorte";
import { EditorPatron } from "@/components/plan/patron/EditorPatron";
import { DialogoHojaArmado } from "@/components/plan/patron/HojaArmado";
import { leyendaPatron } from "@/components/plan/patron/leyenda";
import { admitePatron } from "@/components/plan/patron/modos";
import type { PatronColor, PatronColorResuelto } from "@/lib/plan/patron-color";
import { FalloPlanPatron, pedirPlanEditarPatron, pedirVistaPatron } from "@/lib/plan/peticion-patron";
import { avisosDeEdicion } from "@/components/plan/avisos-edicion";
import { crearVistasEnVivo } from "@/components/plan/vistas-en-vivo";
import { crearColaAjustes, crearPendientesAjustes, type TramoAjustes } from "@/components/plan/cola-ajustes";
import type { ResumenAutoguardado } from "@/components/plan/autoguardado";

const RESPALDO_RECOMENDACIONES = "No pudimos cargar opciones parecidas. Intenta de nuevo o busca en todo el catálogo.";

const pesos = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

type LineaCatalogoSeleccionada = {
  linea: PlanResuelto["estructuras"][number]["lineas"][number];
  estructuraId: string;
  estructura: string;
};

type ModoEdicion = "agregar" | "reemplazar";
type VarianteEdicion = VarianteCandidata & { productId: string };
type ReferenciaEntrenamiento = { total: number; bySize?: Record<string, number> };
type ReferenciasEntrenamientoResponse = { countsByCatalogId?: Record<string, ReferenciaEntrenamiento> };
type ReferenciaEvidenciaSeleccionada = {
  catalogId: string;
  sizeCode: string | null;
  productLabel: string;
  expectedCount: number;
};

type Props = {
  plan: PlanResuelto;
  onAprobar?: () => void;
  aprobado?: boolean;
  generando?: boolean;
  onPlanActualizado?: (plan: PlanResuelto, cotizacion?: Cotizacion) => void;
  /** Modo LoRA activo: el editor de piezas debe respetar el mismo allowlist
   * de dataset que ya aplica el chat, o se puede agregar/reemplazar una
   * pieza que el modelo nunca vio y enterarse recién al generar. */
  loraMode?: LoraModeSlug;
  /** Modo dev (B2): muestra niveles de coincidencia, ajustes declarados y referencias de entrenamiento. */
  modoDev?: boolean;
  /** Referencia analizada del turno que produjo el plan: recortes por pieza y ambientación que no se cotiza. */
  referenceBlueprint?: ReferenceBlueprintV2;
  /** Fotos de referencia del turno que produjo el plan (`REF_01`, `REF_02`… por orden). */
  imagenesReferencia?: { id?: string; base64: string; mime: string }[];
  /** Foto del espacio del turno, para el panel de espacio. */
  fotoEspacio?: { base64: string; mime: string };
  /** Si llega, "Ver cotización" lo llama en vez de abrir el diálogo propio de la tarjeta. */
  onVerCotizacion?: () => void;
  /**
   * `element_id`s de la escenografía que el cliente apagó: no se dibujan en la
   * imagen. Nunca afecta al plan, a los materiales ni a `plan_hash` — la
   * escenografía no se vende, no se cotiza y no se compra.
   */
  escenografiaApagada?: readonly string[];
  /** Enciende o apaga un chip de escenografía (todos sus elementos a la vez). */
  onEscenografiaToggle?: (elementIds: readonly string[], visible: boolean) => void;
  /**
   * Le pide al asistente un ajuste en el chat. Con él, una aprobación
   * bloqueada (presupuesto o piezas sin globos) ofrece el arreglo al lado del
   * botón en vez de dejarlo gris sin explicación.
   */
  onPedirAjuste?: (mensaje: string) => void;
};

const CASCADA: Variants = {
  oculto: { opacity: 0, y: 18, scale: 0.985, filter: "blur(6px)" },
  visible: { opacity: 1, y: 0, scale: 1, filter: "blur(0px)", transition: { duration: 0.6, ease: [0.23, 1, 0.32, 1], staggerChildren: 0.12, delayChildren: 0.15 } },
};

const LISTA_CASCADA: Variants = {
  oculto: {},
  visible: { transition: { staggerChildren: 0.14 } },
};

function mayusculaInicial(texto: string): string {
  return texto ? `${texto.charAt(0).toUpperCase()}${texto.slice(1)}` : texto;
}

function unirTamanos(pulgadas: number[]): string {
  const unicos = [...new Set(pulgadas)].sort((a, b) => a - b);
  if (!unicos.length) return "";
  return `${unicos.length === 1 ? unicos[0] : `${unicos.slice(0, -1).join(", ")} y ${unicos.at(-1)}`} pulgadas`;
}

type OpcionCatalogo = { candidato: ProductoCandidato; variante: VarianteCandidata };

/** A way back from an edit (or a pattern editor session): its "Deshacer" and what the notice says after it. */
type VueltaAtras = { tramo: TramoAjustes<PlanResuelto>; texto: string };
/** One pattern editor session: its saves are undone together, and Python's sentences about them are told once, at the end. */
type SesionPatron = { estructuraId: string; tramo: TramoAjustes<PlanResuelto>; avisos: string[] };

function unicosPor<T>(items: T[], clave: (item: T) => string): T[] {
  const vistas = new Set<string>();
  return items.filter((item) => {
    const key = clave(item);
    if (vistas.has(key)) return false;
    vistas.add(key);
    return true;
  });
}

/**
 * Lines of a structure as the customer sees them: one per product + size +
 * color. The same balloon can arrive as two package variants (x12 and x50,
 * D3); materials are declared per product, so editing or removing the
 * representative line acts on the whole material.
 */
function lineasVisiblesPorVariante(lineas: PlanResuelto["estructuras"][number]["lineas"]): PlanResuelto["estructuras"][number]["lineas"] {
  const agrupadas = new Map<string, PlanResuelto["estructuras"][number]["lineas"][number]>();
  for (const linea of lineas) {
    const clave = `${linea.product_id}|${linea.tamano_codigo ?? linea.diam_pulg ?? ""}|${linea.color ?? ""}`;
    const anterior = agrupadas.get(clave);
    if (!anterior) {
      agrupadas.set(clave, { ...linea });
      continue;
    }
    agrupadas.set(clave, {
      ...anterior,
      unidades: anterior.unidades + linea.unidades,
      imagen: anterior.imagen ?? linea.imagen,
      sustitucion: anterior.sustitucion ?? linea.sustitucion,
    });
  }
  // Same order as the quote card and dialog: color, product, smallest size first.
  return [...agrupadas.values()].sort(compararLineasPorTamanoCliente);
}

function mismaMedida(linea: LineaCatalogoSeleccionada["linea"], variante: VarianteCandidata): boolean {
  if (linea.tamano_codigo && variante.codigoTamano) return linea.tamano_codigo === variante.codigoTamano;
  if (linea.diam_pulg != null && variante.diamPulg != null) return linea.diam_pulg === variante.diamPulg;
  return true;
}

function cercaniaCromatica(linea: LineaCatalogoSeleccionada["linea"], variante: VarianteCandidata): number {
  return puntuacionCromatica(linea.color ? [linea.color] : [], variante.colores);
}

function opcionesCatalogo(candidatos: ProductoCandidato[], linea: LineaCatalogoSeleccionada["linea"], soloRecomendadas: boolean): OpcionCatalogo[] {
  const opciones = candidatos.flatMap((candidato) => candidato.variantes.map((variante) => ({ candidato, variante })));
  const filtradas = opciones.filter(({ variante }) => {
    if (variante.variantId === linea.variant_id || !variante.disponible) return false;
    return !soloRecomendadas || mismaMedida(linea, variante);
  });
  const vistas = new Set<string>();
  return filtradas
    .sort((a, b) => {
      const familiaA = a.candidato.productId === linea.product_id ? 1 : 0;
      const familiaB = b.candidato.productId === linea.product_id ? 1 : 0;
      return cercaniaCromatica(linea, a.variante) - cercaniaCromatica(linea, b.variante)
        || familiaB - familiaA
        || a.candidato.titulo.localeCompare(b.candidato.titulo);
    })
    .filter(({ variante }) => {
      if (vistas.has(variante.variantId)) return false;
      vistas.add(variante.variantId);
      return true;
    })
    .slice(0, 10);
}

function ListaOpciones({ opciones, guardando, onCambiar, ariaLabel, listId, activeVariantId }: {
  opciones: OpcionCatalogo[];
  guardando: boolean;
  onCambiar: (opcion: OpcionCatalogo) => void;
  ariaLabel: string;
  listId?: string;
  activeVariantId?: string;
}) {
  return (
    <ul id={listId} role={listId ? "listbox" : undefined} className="space-y-1.5" aria-label={ariaLabel}>
      {opciones.map(({ candidato, variante }) => (
        <li key={variante.variantId} className="flex items-center gap-2 rounded-md border border-borde bg-superficie p-2">
          {candidato.imagen ? (
            <img src={candidato.imagen} alt="" width={40} height={40} loading="lazy" className="size-10 shrink-0 rounded-md object-cover" />
          ) : <span aria-hidden className="size-10 shrink-0 rounded-md bg-superficie-2" />}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-texto">{productoCliente(candidato.titulo)}</span>
            <span className="block truncate text-[11px] text-texto-suave">{variante.codigoTamano ? pulgadasCliente(variante.codigoTamano) : "Tamaño no especificado"} · {variante.colores.join(", ") || "Color de catálogo"} · {pesos.format(variante.precio)}</span>
          </span>
          <button id={listId ? `opcion-intercambio-${variante.variantId}` : undefined} type="button" role={listId ? "option" : undefined} aria-selected={listId ? activeVariantId === variante.variantId : undefined} disabled={guardando} onClick={() => onCambiar({ candidato, variante })} className={`ui-pressable shrink-0 rounded-md bg-acento px-2.5 py-1.5 text-[11px] font-semibold text-sobre-acento disabled:opacity-50 ${activeVariantId === variante.variantId ? "ring-2 ring-acento ring-offset-1" : ""}`}>
            {guardando ? "Cambiando…" : "Cambiar"}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function TarjetaPlanDecoracion({ plan, onAprobar, aprobado = false, generando = false, onPlanActualizado, loraMode, modoDev = false, referenceBlueprint, imagenesReferencia, fotoEspacio, onVerCotizacion, escenografiaApagada = [], onEscenografiaToggle, onPedirAjuste }: Props) {
  const [celebracion, setCelebracion] = useState(0);
  // Feedback after an edit: what changed, the new total and a way back while it is still the last change.
  // `avisos`: Python's own sentences about the edit (/api/plan-editar), verbatim.
  const [avisoEdicion, setAvisoEdicion] = useState<{ id: number; texto: string; deshacer?: VueltaAtras; avisos?: readonly string[] } | null>(null);
  // An edit resets the approval; the customer is told instead of finding a button that changed.
  const [editadoTrasAprobar, setEditadoTrasAprobar] = useState(false);
  const secuenciaAvisoRef = useRef(0);
  const reducir = useReducedMotion();
  const [detalleAbierto, setDetalleAbierto] = useState(false);
  const [estructuraAbierta, setEstructuraAbierta] = useState<string | null>(plan.estructuras[0]?.estructura_id ?? null);
  const [cotizacionAbierta, setCotizacionAbierta] = useState(false);
  const detalleRef = useRef<HTMLDivElement | null>(null);
  const [imagenesCatalogo, setImagenesCatalogo] = useState<Record<string, string>>({});
  const [imagenesAusentes, setImagenesAusentes] = useState<Record<string, true>>({});
  const [referenciasEntrenamiento, setReferenciasEntrenamiento] = useState<Record<string, ReferenciaEntrenamiento>>({});
  const [referenciaEvidencia, setReferenciaEvidencia] = useState<ReferenciaEvidenciaSeleccionada | null>(null);
  const [estadoEvidencia, setEstadoEvidencia] = useState<"idle" | "loading" | "error" | "ready">("idle");
  const [datosEvidencia, setDatosEvidencia] = useState<ReferenciasEvidenciaData | null>(null);
  const [errorEvidencia, setErrorEvidencia] = useState<string | null>(null);
  const [revisionEvidencia, setRevisionEvidencia] = useState(0);
  const [seleccionCatalogo, setSeleccionCatalogo] = useState<LineaCatalogoSeleccionada | null>(null);
  const [intercambioAbierto, setIntercambioAbierto] = useState(false);
  const [recomendaciones, setRecomendaciones] = useState<ProductoCandidato[]>([]);
  const [resultadosCatalogo, setResultadosCatalogo] = useState<ProductoCandidato[]>([]);
  const [consultaCatalogo, setConsultaCatalogo] = useState("");
  const [buscandoCatalogo, setBuscandoCatalogo] = useState(false);
  const [editorAbierto, setEditorAbierto] = useState(false);
  const [modoEdicion, setModoEdicion] = useState<ModoEdicion>("agregar");
  const [estructuraEdicion, setEstructuraEdicion] = useState(plan.plan.estructuras[0]?.estructura_id ?? "");
  const [objetivoEdicion, setObjetivoEdicion] = useState<string | null>(null);
  const [consultaEdicion, setConsultaEdicion] = useState("");
  const [candidatosEdicion, setCandidatosEdicion] = useState<ProductoCandidato[]>([]);
  const [varianteEdicion, setVarianteEdicion] = useState<VarianteEdicion | null>(null);
  const [colorEdicion, setColorEdicion] = useState("");
  const [participacionEdicion, setParticipacionEdicion] = useState("20");
  const [buscandoEdicion, setBuscandoEdicion] = useState(false);
  const [guardandoEdicion, setGuardandoEdicion] = useState(false);
  const [errorEdicion, setErrorEdicion] = useState<string | null>(null);
  const [opcionBusquedaActiva, setOpcionBusquedaActiva] = useState(-1);
  // Color pattern editor and assembly sheet (ADR-0028), one structure at a time.
  // The session's saves share one "Deshacer", back to the plan before the first of them.
  const [patronEditando, setPatronEditando] = useState<SesionPatron | null>(null);
  // The session's last change did not make it into the plan: why, and (for a failure, not a rejection) a retry with it.
  const [falloPatron, setFalloPatron] = useState<{ mensaje: string; reintentar: (() => void) | null } | null>(null);
  const patronesRechazadosRef = useRef(new WeakSet<PatronColor>());
  // Every edit of the proposal runs one at a time on the plan the previous one
  // signed: the controls save on their own, faster than the prop comes back.
  const [ajustesEnCurso, setAjustesEnCurso] = useState(0);
  const [cola] = useState(() => crearColaAjustes(plan, setAjustesEnCurso));
  // Slider changes still waiting for their pause (not in the queue yet) or saving.
  const [cambiosSinGuardar, setCambiosSinGuardar] = useState(0);
  const [pendientes] = useState(() => crearPendientesAjustes(setCambiosSinGuardar));
  const guardandoAjustes = ajustesEnCurso > 0 || cambiosSinGuardar > 0;
  const [hojaArmado, setHojaArmado] = useState<string | null>(null);
  // The colors slider's live drawing per structure (ADR-0028 §13), outside the card's state: each Python
  // response repaints only the pattern block and the summary strip of that piece, not the whole card.
  const [vistasEnVivo] = useState(() => crearVistasEnVivo<PatronColorResuelto>());
  const disparadorModalRef = useRef<HTMLButtonElement | null>(null);
  const volverDetalleRef = useRef<HTMLButtonElement | null>(null);
  const busquedaCatalogoRef = useRef<HTMLInputElement | null>(null);
  const peticionCatalogoRef = useRef<AbortController | null>(null);
  const secuenciaCatalogoRef = useRef(0);
  const peticionEvidenciaRef = useRef<AbortController | null>(null);
  const secuenciaEvidenciaRef = useRef(0);
  const editorDisponible = Boolean(onPlanActualizado);
  const editorId = `editor-plan-${plan.plan.plan_id}`;
  const supuestos = [...new Set(plan.plan.supuestos)];
  const sustituciones = unicosPor(plan.sustituciones, (item) => `${item.estructura_id}|${item.pedido}|${item.entregado}|${item.motivo}`);
  const sinCobertura = unicosPor(plan.sin_cobertura, (item) => `${item.estructura_id}|${item.product_id}|${item.tamano}`);
  const variantIdsSinImagen = [...new Set(plan.estructuras.flatMap((estructura) => estructura.lineas).filter((linea) => !linea.imagen && !imagenesCatalogo[linea.variant_id]).map((linea) => linea.variant_id))].sort();
  const solicitudImagenes = variantIdsSinImagen.map((variantId) => `variant_id=${encodeURIComponent(variantId)}`).join("&");
  const compraSeleccionada = seleccionCatalogo ? gruposCotizacionPlan(plan.compras).find((grupo) => grupo.items.some((compra) => compra.variant_id === seleccionCatalogo.linea.variant_id)) : undefined;
  const imagenSeleccionada = seleccionCatalogo ? seleccionCatalogo.linea.imagen ?? imagenesCatalogo[seleccionCatalogo.linea.variant_id] : undefined;
  const acabados = [...new Set(plan.plan.estructuras.flatMap((estructura) => estructura.materiales.map((material) => material.acabado).filter((acabado): acabado is string => Boolean(acabado))))];
  // Presentation for the end customer: names, locations and colors derive from
  // the official structure catalog and the resolved plan, never from free text.
  const declaradasPorId = new Map(plan.plan.estructuras.map((estructura) => [estructura.estructura_id, estructura]));
  // Only applied patterns describe the plan; a suggestion lives in the editor until it is applied.
  const patronesAplicados = new Map((plan.patrones_color ?? []).filter((patron) => patron.aplicado).map((patron) => [patron.estructura_id, patron]));
  const vistasEstructura = plan.estructuras.map((estructura) => {
    const declarada = declaradasPorId.get(estructura.estructura_id);
    const oficial = identificarEstructuraOficial({ tipo: estructura.tipo, densidad: declarada?.densidad, ubicacion: estructura.ubicacion, nombre: estructura.nombre, estructura_oficial: declarada?.estructura_oficial });
    const paraDescribir = { oficialId: oficial?.id, nombre: estructura.nombre, ubicacion: estructura.ubicacion, repeticiones: estructura.repeticiones };
    return {
      estructura,
      declarada,
      oficial,
      paraDescribir,
      descripcion: describirEstructuraCliente(paraDescribir, "definido"),
      colores: coloresCliente(estructura.lineas),
      // Numbered legend of the pattern: material index + 1, in `materiales` order.
      leyenda: leyendaPatron(declarada?.materiales ?? [], estructura.lineas),
      patron: patronesAplicados.get(estructura.estructura_id),
      admitePatron: Boolean(declarada && admitePatron(estructura.tipo, declarada.materiales.length)),
    };
  });
  const descripcionesPorId = new Map(vistasEstructura.map((vista) => [vista.estructura.estructura_id, vista.descripcion]));
  const vistaEditorPatron = patronEditando ? vistasEstructura.find((vista) => vista.estructura.estructura_id === patronEditando.estructuraId) : undefined;
  const vistaHojaArmado = hojaArmado ? vistasEstructura.find((vista) => vista.estructura.estructura_id === hojaArmado) : undefined;
  const coloresPlan = [...new Set(vistasEstructura.flatMap((vista) => vista.colores.map((muestra) => muestra.color)))];
  const resumenPlan = resumenPlanCliente(vistasEstructura.map((vista) => vista.paraDescribir), coloresPlan);
  const soloGlobos = plan.estructuras.every((estructura) => esEstructuraDeGlobos(estructura.tipo));
  // Escenografía: lo que se conserva de la foto del cliente. Entra en la
  // imagen, el cliente la enciende o la apaga, y nunca se cotiza — no toca el
  // plan, los materiales ni `plan_hash`.
  const escenografia = referenceBlueprint
    ? escenografiaCliente(referenceBlueprint, new Set(plan.plan.estructuras.map((estructura) => estructura.referencia_element_id).filter((id): id is string => Boolean(id))))
    : [];
  // El chip se apaga entero: sus elementos entran y salen juntos.
  const escenografiaApagadaSet = new Set(escenografiaApagada);
  const chipEncendido = (chip: { elementIds: string[]; visiblePorDefecto: boolean }) =>
    chip.visiblePorDefecto && chip.elementIds.every((id) => !escenografiaApagadaSet.has(id));
  const textosSustitucion = sustitucionesCliente(sustituciones.filter((item) => !esSustitucionDeColor(item)), descripcionesPorId);
  const textosColorReferencia = sustitucionesCliente(sustituciones.filter(esSustitucionDeColor), descripcionesPorId);
  const textosFaltantes = faltantesCliente(sinCobertura, descripcionesPorId);
  const estructuraSeleccionada = plan.plan.estructuras.find((estructura) => estructura.estructura_id === estructuraEdicion);
  const opcionesRecomendadas = seleccionCatalogo ? opcionesCatalogo(recomendaciones, seleccionCatalogo.linea, true) : [];
  const opcionesBusqueda = seleccionCatalogo ? opcionesCatalogo(resultadosCatalogo, seleccionCatalogo.linea, false) : [];
  const idDetalle = `${editorId}-detalle`;
  // Data URLs of the turn's photos, built once per attachment set.
  const urlsReferencia = useMemo(() => new Map((imagenesReferencia ?? []).map((imagen) => [imagen, urlImagen(imagen)])), [imagenesReferencia]);
  const elementosReferencia = new Map((referenceBlueprint?.elements ?? []).map((elemento) => [elemento.element_id, elemento]));
  // Consumo imputado por estructura, tal como lo firma Python. Antes se repartia aqui el
  // paquete entre estructuras, que era la misma formula mantenida en dos idiomas.
  const consumoPorEstructura = new Map(plan.costes_por_estructura.map((coste) => [coste.estructura_id, coste.consumo_cop]));
  const imagenLinea = (variantId: string, propia?: string | null): string | undefined => propia ?? imagenesCatalogo[variantId];

  function recorteDe(declarada: (typeof vistasEstructura)[number]["declarada"]) {
    const elemento = declarada?.referencia_element_id ? elementosReferencia.get(declarada.referencia_element_id) : undefined;
    if (!elemento) return null;
    const imagen = imagenDeReferencia(imagenesReferencia, elemento.source_image_id);
    const src = imagen ? urlsReferencia.get(imagen) : undefined;
    return src ? { src, caja: elemento.reference_bbox } : null;
  }

  const piezas = vistasEstructura.map(({ estructura, declarada, oficial, paraDescribir, colores, leyenda, patron }, indice): PiezaPropuestaVista & { recorteCrudo: ReturnType<typeof recorteDe> } => {
    const recorte = recorteDe(declarada);
    const ubicacionCorta = mayusculaInicial(ubicacionCortaCliente(estructura.ubicacion, estructura.repeticiones));
    return {
      id: estructura.estructura_id,
      numero: indice + 1,
      oficialId: oficial?.id,
      espejo: estructura.ubicacion === "lateral_derecho",
      titulo: oficial ? nombreConCantidadCliente(paraDescribir) : productoCliente(estructura.nombre),
      subtitulo: [ubicacionCorta, medidasCortasCliente(estructura.tipo, declarada?.medidas)].filter(Boolean).join(" · "),
      globos: estructura.total_unidades,
      unidad: esEstructuraDeGlobos(estructura.tipo) ? "globos" : "piezas",
      colores,
      recorte: recorte ? { ...recorte, alt: `${oficial?.nombre ?? productoCliente(estructura.nombre)} de tu foto de referencia, ${ubicacionCorta.toLowerCase()}` } : null,
      recorteCrudo: recorte,
      // While the colors slider of a confetti moves, its strip shows Python's live drawing (`enVivo`).
      patron: patron ? { resuelto: patron, leyenda, enVivo: editorDisponible ? vistasEnVivo : undefined } : undefined,
    };
  });
  const conFotos = piezas.some((pieza) => pieza.recorte);
  const piezasEnFoto = referenceBlueprint ? piezasVistasEnReferencia(referenceBlueprint) : [];
  const idsMaterializados = new Set(plan.plan.estructuras.map((estructura) => estructura.referencia_element_id).filter((id): id is string => Boolean(id)));
  // Only pieces a plan structure really links to count; with none linked the card falls back to product photos.
  const piezasIncluidas = piezasEnFoto.filter((pieza) => idsMaterializados.has(pieza.elementId)).length;
  const miniaturaReferencia = imagenesReferencia?.[0] ? urlsReferencia.get(imagenesReferencia[0]) : undefined;
  const productos: ProductoPropuestaVista[] = (() => {
    const grupos = new Map<string, ProductoPropuestaVista & { pulgadas: number[] }>();
    for (const compra of plan.compras) {
      const clave = `${compra.product_id}|${compra.color ?? ""}`;
      const previo = grupos.get(clave);
      const pulgadas = compra.diam_pulg != null ? [compra.diam_pulg] : [];
      if (previo) {
        previo.unidades += compra.design_quantity;
        previo.pulgadas.push(...pulgadas);
        previo.imagen ??= imagenLinea(compra.variant_id, compra.imagen);
        continue;
      }
      const nombre = productoCliente(compra.titulo);
      grupos.set(clave, { clave, nombre, alt: nombre, imagen: imagenLinea(compra.variant_id, compra.imagen), unidades: compra.design_quantity, tamanos: "", pulgadas });
    }
    return [...grupos.values()]
      .map(({ pulgadas, ...producto }) => ({ ...producto, tamanos: unirTamanos(pulgadas) }))
      .sort((a, b) => b.unidades - a.unidades);
  })();
  const tramosPlan = tramosPorTamano(Object.entries(plan.totales.globos_por_tamano).map(([codigo, unidades]) => ({ pulgadas: Number(/(\d+(?:[.,]\d+)?)/.exec(codigo)?.[1]?.replace(",", ".") ?? Number.NaN) || null, unidades })));
  const textoTamanosPlan = tamanosCliente(tramosPlan.map((tramo) => ({ diam_pulg: tramo.pulgadas })));
  const techo = plan.comercial.techo_cop;
  const estadoPresupuesto = plan.comercial.estado === "PRESUPUESTO_EXCEDIDO"
    ? `se pasa de tu presupuesto por ${pesos.format(plan.comercial.delta_cop)}`
    : plan.comercial.estado === "APROBACION_REQUERIDA"
      ? "revisión pendiente"
      : techo != null ? "dentro de tu presupuesto" : null;
  // While an edit is still saving (or a slider waits for its pause), approving would sign the plan it is about to replace.
  const aprobarDeshabilitado = aprobado || generando || guardandoAjustes || plan.comercial.estado === "PRESUPUESTO_EXCEDIDO" || plan.sin_cobertura.length > 0;
  // After an edit on an approved proposal the image is stale: approving again regenerates it (never on its own).
  const textoAprobar = generando ? "Generando…" : aprobado ? "Aprobación registrada" : plan.sin_cobertura.length > 0 ? "Faltan piezas disponibles" : editadoTrasAprobar ? "Regenerar visual" : "Aprobar y ver cómo queda";
  const ajustes: AjustePropuesta[] = [
    ...textosFaltantes.map((texto): AjustePropuesta => ({ tipo: "faltante", texto })),
    ...textosColorReferencia.map((texto): AjustePropuesta => ({ tipo: "color", texto })),
    ...textosSustitucion.map((texto): AjustePropuesta => ({ tipo: "tamano", texto })),
    ...supuestos.map((supuesto): AjustePropuesta => ({ tipo: "supuesto", texto: supuestoCliente(supuesto) })),
  ];
  // Why the approval is blocked, with the fix one tap away.
  const bloqueo = aprobado || generando
    ? null
    : plan.comercial.estado === "PRESUPUESTO_EXCEDIDO"
      ? { motivo: `Se pasa de tu presupuesto por ${pesos.format(plan.comercial.delta_cop)}.`, accion: "Ajustar al presupuesto", mensaje: "Ajusta la propuesta para que quepa en mi presupuesto." }
      : plan.sin_cobertura.length > 0
        ? { motivo: "A algunas piezas les faltan globos disponibles.", accion: "Buscar alternativas", mensaje: "Busca alternativas disponibles para las piezas a las que les faltan globos." }
        : null;
  const coloresCelebracion = [...new Set(vistasEstructura.flatMap((vista) => vista.colores.map((muestra) => muestra.fondo)))];
  function aprobarConCelebracion(): void {
    if (!onAprobar) return;
    setCelebracion((valor) => valor + 1);
    onAprobar();
  }

  function abrirPieza(estructuraId: string): void {
    setDetalleAbierto(true);
    setEstructuraAbierta(estructuraId);
    requestAnimationFrame(() => detalleRef.current?.scrollIntoView({ behavior: reducir ? "auto" : "smooth", block: "nearest" }));
  }

  function verCotizacion(): void {
    if (onVerCotizacion) onVerCotizacion();
    else setCotizacionAbierta(true);
  }

  function referenciaEntrenamiento(linea: PlanResuelto["estructuras"][number]["lineas"][number]): { count: number; catalogId: string } | null {
    const referencia = [linea.sku, linea.product_id, linea.variant_id]
      .filter((id): id is string => Boolean(id))
      .map((id) => ({ catalogId: id, reference: referenciasEntrenamiento[id] }))
      .find((item) => Boolean(item.reference));
    if (!referencia) return null;
    const count = linea.tamano_codigo && referencia.reference.bySize?.[linea.tamano_codigo] != null
      ? referencia.reference.bySize[linea.tamano_codigo]
      : referencia.reference.total;
    return { count, catalogId: referencia.catalogId };
  }

  function cargarEvidencia(seleccion: ReferenciaEvidenciaSeleccionada): void {
    peticionEvidenciaRef.current?.abort();
    const controlador = new AbortController();
    peticionEvidenciaRef.current = controlador;
    const secuencia = ++secuenciaEvidenciaRef.current;
    setRevisionEvidencia((revision) => revision + 1);
    setEstadoEvidencia("loading");
    setDatosEvidencia(null);
    setErrorEvidencia(null);
    const parametros = new URLSearchParams({ catalog_id: seleccion.catalogId });
    if (seleccion.sizeCode) parametros.set("size_code", seleccion.sizeCode);
    fetch(`/api/lora/training-references?${parametros}`, { signal: controlador.signal, cache: "no-store" })
      .then(async (respuesta) => {
        const datos = await respuesta.json() as ReferenciasEvidenciaData & { error?: string };
        if (!respuesta.ok) throw new Error(datos.error ?? "No se pudieron cargar las fotos de entrenamiento.");
        return datos;
      })
      .then((datos) => {
        if (secuencia !== secuenciaEvidenciaRef.current) return;
        setDatosEvidencia(datos);
        setEstadoEvidencia("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (secuencia !== secuenciaEvidenciaRef.current) return;
        setErrorEvidencia(mensajeErrorCliente(error, "No se pudieron cargar las fotos de entrenamiento."));
        setEstadoEvidencia("error");
      });
  }

  function abrirEvidencia(linea: PlanResuelto["estructuras"][number]["lineas"][number], referencia: NonNullable<ReturnType<typeof referenciaEntrenamiento>>): void {
    const seleccion = {
      catalogId: referencia.catalogId,
      sizeCode: linea.tamano_codigo ?? null,
      productLabel: linea.titulo,
      expectedCount: referencia.count,
    };
    setReferenciaEvidencia(seleccion);
    cargarEvidencia(seleccion);
  }

  function cerrarEvidencia(): void {
    peticionEvidenciaRef.current?.abort();
    ++secuenciaEvidenciaRef.current;
    setReferenciaEvidencia(null);
    setEstadoEvidencia("idle");
  }

  function abrirEditor(modo: ModoEdicion, estructuraId: string, objetivo?: PlanResuelto["estructuras"][number]["lineas"][number]) {
    setModoEdicion(modo);
    setEstructuraEdicion(estructuraId);
    setObjetivoEdicion(objetivo?.variant_id ?? null);
    setConsultaEdicion(objetivo ? [objetivo.tamano_codigo ? pulgadasCliente(objetivo.tamano_codigo) : null, objetivo.color].filter(Boolean).join(" ") : "");
    setCandidatosEdicion([]);
    setVarianteEdicion(null);
    setColorEdicion(objetivo?.color ?? "");
    setParticipacionEdicion("20");
    setErrorEdicion(null);
    setDetalleAbierto(true);
    setEditorAbierto(true);
  }

  function cerrarEditor() {
    if (guardandoEdicion) return;
    setEditorAbierto(false);
    setErrorEdicion(null);
  }

  /** Shape and size of the line a search would replace, so the server only offers compatible balloons. */
  function lineaObjetivoDe(variantId: string | null | undefined): { forma: string | null; diam_pulg: number | null } | undefined {
    if (!variantId) return undefined;
    const linea = plan.estructuras.flatMap((estructura) => estructura.lineas).find((item) => item.variant_id === variantId);
    return linea ? { forma: linea.forma ?? null, diam_pulg: linea.diam_pulg ?? null } : undefined;
  }

  async function buscarVariantes(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const consulta = consultaEdicion.trim();
    if (!consulta || buscandoEdicion) return;
    setBuscandoEdicion(true);
    setErrorEdicion(null);
    try {
      const datos = await pedirPlanEditar({ modo: "buscar", consulta, approval_token: plan.approval_token, loraMode, ...(modoEdicion === "reemplazar" && lineaObjetivoDe(objetivoEdicion) ? { linea_objetivo: lineaObjetivoDe(objetivoEdicion) } : {}) }, "No se pudo buscar en el catálogo.") as { candidatos?: ProductoCandidato[] };
      setCandidatosEdicion(datos.candidatos ?? []);
      if (!datos.candidatos?.length) setErrorEdicion("No encontré una variante disponible. Prueba con el tamaño y el color, por ejemplo: globo rojo de 5 pulgadas.");
    } catch (error) {
      setErrorEdicion(mensajeFalloPlanEditar(error, "No se pudo buscar en el catálogo."));
    } finally {
      setBuscandoEdicion(false);
    }
  }

  function elegirVariante(candidato: ProductoCandidato, variante: VarianteCandidata) {
    setVarianteEdicion({ ...variante, productId: candidato.productId });
    // El color sigue a la variante elegida, siempre. Antes solo se rellenaba
    // cuando estaba vacío, y al abrir el editor ya venía con el color de la
    // pieza que se reemplaza: cambiar de variante dejaba globos azules
    // cotizados como "rosado".
    setColorEdicion(variante.colores.length === 1 ? variante.colores[0]! : "");
    setErrorEdicion(null);
  }

  function navegarOpcionesBusqueda(evento: React.KeyboardEvent<HTMLInputElement>): void {
    if (evento.key === "ArrowDown" && opcionesBusqueda.length > 0) {
      evento.preventDefault();
      setOpcionBusquedaActiva((indice) => Math.min(indice + 1, opcionesBusqueda.length - 1));
      return;
    }
    if (evento.key === "ArrowUp" && opcionesBusqueda.length > 0) {
      evento.preventDefault();
      setOpcionBusquedaActiva((indice) => Math.max(indice - 1, 0));
      return;
    }
    if (evento.key === "Enter" && opcionBusquedaActiva >= 0 && opcionesBusqueda[opcionBusquedaActiva]) {
      evento.preventDefault();
      void reemplazarDesdeCatalogo(opcionesBusqueda[opcionBusquedaActiva]!);
      return;
    }
    if (evento.key === "Escape") {
      evento.preventDefault();
      if (consultaCatalogo) {
        setConsultaCatalogo("");
        setResultadosCatalogo([]);
        setOpcionBusquedaActiva(-1);
      } else {
        setIntercambioAbierto(false);
      }
    }
  }

  /** Publishes a plan the server signed; the next edit starts from it even before React paints it. */
  function publicarPlan(nuevo: PlanResuelto, cotizacion?: Cotizacion): void {
    cola.fijar(nuevo);
    onPlanActualizado?.(nuevo, cotizacion);
  }

  /**
   * The notice's "Deshacer" is offered only while its edit is still the last
   * thing that changed the plan and nothing else is on its way: going back
   * to the plan before it would silently drop any later edit.
   */
  function puedeDeshacer(vuelta: VueltaAtras): boolean {
    return !guardandoAjustes && vuelta.tramo.deshacible();
  }

  /** "Deshacer": back to the plan the server had signed before the edit (it still carries its approval token). */
  function deshacer({ tramo, texto }: VueltaAtras): void {
    setErrorEdicion(null);
    void tramo.deshacer((anterior) => {
      publicarPlan(anterior);
      setAvisoEdicion({ id: ++secuenciaAvisoRef.current, texto: `${texto} Total: ${pesos.format(anterior.totales.total_cop)}.` });
    }).then((deshecho) => {
      // Something else changed the plan in the meantime (the chat, another card): it stays as it is.
      if (!deshecho) {
        setAvisoEdicion(null);
        setErrorEdicion("No lo deshice: la propuesta cambió después de ese ajuste.");
      }
    });
  }

  /** A new plan from an edit; `texto: null` publishes it without the per-edit notice. `avisos`: Python's sentences, shown with it. */
  function planEditado(nuevo: PlanResuelto, cotizacion: Cotizacion | undefined, texto: string | null, deshacer?: VueltaAtras, avisos: readonly string[] = []): void {
    if (!onPlanActualizado) return;
    if (aprobado) setEditadoTrasAprobar(true);
    publicarPlan(nuevo, cotizacion);
    if (texto !== null) setAvisoEdicion({ id: ++secuenciaAvisoRef.current, texto: `${texto} Nuevo total: ${pesos.format(nuevo.totales.total_cop)}.`, deshacer, avisos });
  }

  /**
   * The card's direct controls (color split, size balance, color pattern)
   * save on their own: each edit waits for the previous one and starts from
   * the plan it signed (`cola`), with the new total and a way back to the plan
   * before it. Resolves the reason shown to the customer, or `null` when the
   * edit is in the plan. `enDialogo` leaves the error to the control that
   * asked; `aviso: false` skips the per-edit notice (the pattern editor gives
   * one for its whole session); `pedir` swaps the request (the pattern one
   * reads Python's rejection); `tramo` joins the edit to others undone
   * together (the pattern editor session); `alAvisar` receives Python's
   * sentences about the edit when the notice is someone else's.
   */
  async function aplicarAjusteDirecto(edicion: Record<string, unknown>, texto: string, opciones: { enDialogo?: boolean; aviso?: boolean; pedir?: typeof pedirPlanEditar; tramo?: TramoAjustes<PlanResuelto>; alAvisar?: (avisos: readonly string[]) => void } = {}): Promise<string | null> {
    if (!onPlanActualizado) return "Esta propuesta ya no se puede editar.";
    const pedir = opciones.pedir ?? pedirPlanEditar;
    const tramo = opciones.tramo ?? cola.tramo();
    if (!opciones.enDialogo) setErrorEdicion(null);
    try {
      await tramo.encolar(async (base) => {
        const datos = await pedir({ modo: "aplicar", base, edicion, loraMode }, "No se pudo actualizar la pieza.") as { plan?: PlanResuelto; cotizacion?: Cotizacion };
        if (!datos.plan) throw new FalloPlanEditar(mensajeErrorRespuesta(datos, "No se pudo actualizar la pieza."));
        const avisos = avisosDeEdicion(datos);
        opciones.alAvisar?.(avisos);
        planEditado(datos.plan, datos.cotizacion, opciones.aviso === false ? null : texto, { tramo, texto: "Volví a como estaba." }, avisos);
        return datos.plan;
      });
      return null;
    } catch (error) {
      const mensaje = mensajeFalloPlanEditar(error, "No se pudo actualizar la pieza.");
      if (!opciones.enDialogo) setErrorEdicion(mensaje);
      return mensaje;
    }
  }

  /** One autosave of the pattern editor. A rejected pattern comes back with Python's own sentence ("Negro no aparece…"). */
  function guardarPatron(sesion: SesionPatron, patron: PatronColor | null): Promise<string | null> {
    const pedir: typeof pedirPlanEditar = (cuerpo, respaldo, opciones) => pedirPlanEditarPatron(cuerpo, respaldo, opciones).catch((error: unknown) => {
      // Python rejected this very pattern: retrying it would get the same answer.
      if (patron && error instanceof FalloPlanPatron && error.patronInvalido) patronesRechazadosRef.current.add(patron);
      throw error;
    });
    return aplicarAjusteDirecto(
      { accion: "patron", estructura_id: sesion.estructuraId, patron_color: patron },
      "",
      { enDialogo: true, aviso: false, pedir, tramo: sesion.tramo, alAvisar: (avisos) => sesion.avisos.push(...avisos) },
    );
  }

  function abrirEditorPatron(estructuraId: string): void {
    setFalloPatron(null);
    setPatronEditando({ estructuraId, tramo: cola.tramo(), avisos: [] });
  }

  /**
   * The editor closes at once; what it still had to save finishes in the
   * background. Then ONE notice for the whole session, with a "Deshacer" back
   * to the plan before it (while nothing else changed the plan in between),
   * and the reason if the last change did not make it into the plan, with a
   * retry of that change when it failed on the way (not when Python rejected it).
   */
  function cerrarEditorPatron(fin: Promise<ResumenAutoguardado<PatronColor | null>>): void {
    const sesion = patronEditando;
    setPatronEditando(null);
    if (!sesion) return;
    void fin.then((resumen) => avisarSesionPatron(sesion, resumen));
  }

  function avisarSesionPatron(sesion: SesionPatron, { guardados, error, sinGuardar }: ResumenAutoguardado<PatronColor | null>): void {
    if (guardados > 0) {
      setAvisoEdicion({
        id: ++secuenciaAvisoRef.current,
        texto: `Patrón actualizado. Nuevo total: ${pesos.format(cola.base().totales.total_cop)}.`,
        deshacer: { tramo: sesion.tramo, texto: "Volví a como estaba." },
        avisos: [...new Set(sesion.avisos)],
      });
    }
    const reintentable = sinGuardar && !(sinGuardar.valor && patronesRechazadosRef.current.has(sinGuardar.valor)) ? sinGuardar : null;
    setFalloPatron(error ? { mensaje: `El último cambio del patrón no se guardó: ${error}`, reintentar: reintentable ? () => reintentarPatron(sesion, reintentable.valor) : null } : null);
  }

  function reintentarPatron(sesion: SesionPatron, patron: PatronColor | null): void {
    setFalloPatron(null);
    void guardarPatron(sesion, patron).then((error) => avisarSesionPatron(sesion, { guardados: error ? 0 : 1, error, sinGuardar: error ? { valor: patron } : null }));
  }

  async function aplicarEdicion(evento?: FormEvent<HTMLFormElement>) {
    evento?.preventDefault();
    if (!onPlanActualizado || guardandoEdicion || !estructuraSeleccionada) return;
    if (modoEdicion !== "agregar" && !objetivoEdicion) return;
    if (!varianteEdicion) {
      setErrorEdicion(modoEdicion === "agregar" ? "Elige primero una variante del catálogo." : "Elige primero la variante que reemplazará la pieza actual.");
      return;
    }
    const participacion = Number(participacionEdicion) / 100;
    if (modoEdicion === "agregar" && (!Number.isFinite(participacion) || participacion <= 0.01 || participacion >= 0.8)) {
      setErrorEdicion("La participación debe estar entre 2% y 79%.");
      return;
    }
    setGuardandoEdicion(true);
    setErrorEdicion(null);
    try {
      await cola.encolar(async (base) => {
        const datos = await pedirPlanEditar(
          { modo: "aplicar", base, edicion: { accion: modoEdicion, estructura_id: estructuraEdicion, objetivo_variant_id: objetivoEdicion ?? undefined, variante: { product_id: varianteEdicion.productId, variant_id: varianteEdicion.variantId, color: colorEdicion.trim() || undefined }, participacion: modoEdicion === "agregar" ? participacion : undefined }, loraMode },
          "No se pudo actualizar el plan.",
        ) as { plan?: PlanResuelto; cotizacion?: Cotizacion };
        if (!datos.plan) throw new FalloPlanEditar(mensajeErrorRespuesta(datos, "No se pudo actualizar el plan."));
        planEditado(datos.plan, datos.cotizacion, modoEdicion === "agregar" ? "Listo, agregué el globo." : "Listo, cambié el globo.", undefined, avisosDeEdicion(datos));
        return datos.plan;
      });
      cerrarEditor();
    } catch (error) {
      setErrorEdicion(mensajeFalloPlanEditar(error, "No se pudo actualizar el plan."));
    } finally {
      setGuardandoEdicion(false);
    }
  }

  async function reemplazarDesdeCatalogo(opcion: OpcionCatalogo) {
    if (!onPlanActualizado || !seleccionCatalogo || guardandoEdicion) return;
    setGuardandoEdicion(true);
    setErrorEdicion(null);
    try {
      await cola.encolar(async (base) => {
        const datos = await pedirPlanEditar({ modo: "aplicar", base, edicion: { accion: "reemplazar", estructura_id: seleccionCatalogo.estructuraId, objetivo_variant_id: seleccionCatalogo.linea.variant_id, variante: { product_id: opcion.candidato.productId, variant_id: opcion.variante.variantId, color: opcion.variante.colores[0] ?? undefined } }, loraMode }, "No se pudo cambiar la pieza.") as { plan?: PlanResuelto; cotizacion?: Cotizacion };
        if (!datos.plan) throw new FalloPlanEditar(mensajeErrorRespuesta(datos, "No se pudo cambiar la pieza."));
        planEditado(datos.plan, datos.cotizacion, "Listo, cambié el globo.", undefined, avisosDeEdicion(datos));
        return datos.plan;
      });
       setIntercambioAbierto(false);
       setSeleccionCatalogo(null);
       requestAnimationFrame(() => disparadorModalRef.current?.focus());
    } catch (error) {
      setErrorEdicion(mensajeFalloPlanEditar(error, "No se pudo cambiar la pieza."));
    } finally {
      setGuardandoEdicion(false);
    }
  }

  async function quitarVariante(estructuraId: string, linea: PlanResuelto["estructuras"][number]["lineas"][number]) {
    if (!onPlanActualizado || guardandoEdicion) return;
    // No browser dialog: the removal happens and can be undone for a few
    // seconds by restoring the plan the server had already signed.
    const nombre = productoCliente(linea.titulo);
    const pieza = descripcionesPorId.get(estructuraId) ?? "la decoración";
    setGuardandoEdicion(true);
    setErrorEdicion(null);
    const tramo = cola.tramo();
    try {
      await tramo.encolar(async (anterior) => {
        const datos = await pedirPlanEditar({ modo: "aplicar", base: anterior, edicion: { accion: "quitar", estructura_id: estructuraId, objetivo_variant_id: linea.variant_id }, loraMode }, "No se pudo quitar la pieza.") as { plan?: PlanResuelto; cotizacion?: Cotizacion };
        if (!datos.plan) throw new FalloPlanEditar(mensajeErrorRespuesta(datos, "No se pudo quitar la pieza."));
        planEditado(datos.plan, datos.cotizacion, `Quité ${nombre} de ${pieza}.`, { tramo, texto: `Volví a poner ${nombre}.` }, avisosDeEdicion(datos));
        return datos.plan;
      });
    } catch (error) {
      setErrorEdicion(mensajeFalloPlanEditar(error, "No se pudo quitar la pieza."));
      setEditorAbierto(true);
    } finally {
      setGuardandoEdicion(false);
    }
  }

  async function abrirIntercambio() {
    if (!seleccionCatalogo || buscandoCatalogo) return;
    peticionCatalogoRef.current?.abort();
    const controlador = new AbortController();
    peticionCatalogoRef.current = controlador;
    const secuencia = ++secuenciaCatalogoRef.current;
    setIntercambioAbierto(true);
    setResultadosCatalogo([]);
    setConsultaCatalogo("");
    setOpcionBusquedaActiva(-1);
    setBuscandoCatalogo(true);
    setErrorEdicion(null);
    try {
      const datos = await pedirPlanEditar({ modo: "recomendadas", variant_id: seleccionCatalogo.linea.variant_id, approval_token: plan.approval_token, loraMode }, RESPALDO_RECOMENDACIONES, { signal: controlador.signal }) as { candidatos?: ProductoCandidato[] };
      if (secuencia !== secuenciaCatalogoRef.current) return;
      setRecomendaciones(datos.candidatos ?? []);
    } catch (error) {
      if (esCancelacion(error)) return;
      setErrorEdicion(mensajeFalloPlanEditar(error, RESPALDO_RECOMENDACIONES));
    } finally {
      if (secuencia === secuenciaCatalogoRef.current) setBuscandoCatalogo(false);
    }
  }

  async function buscarCatalogoPorTexto(consultaCruda: string) {
    const consulta = consultaCruda.trim();
    if (consulta.length < 2) return;
    peticionCatalogoRef.current?.abort();
    const controlador = new AbortController();
    peticionCatalogoRef.current = controlador;
    const secuencia = ++secuenciaCatalogoRef.current;
    setBuscandoCatalogo(true);
    setErrorEdicion(null);
    try {
      const datos = await pedirPlanEditar({ modo: "buscar", consulta, approval_token: plan.approval_token, loraMode, ...(lineaObjetivoDe(seleccionCatalogo?.linea.variant_id) ? { linea_objetivo: lineaObjetivoDe(seleccionCatalogo?.linea.variant_id) } : {}) }, "No se pudo buscar en el catálogo.", { signal: controlador.signal }) as { candidatos?: ProductoCandidato[] };
      if (secuencia !== secuenciaCatalogoRef.current) return;
      setResultadosCatalogo(datos.candidatos ?? []);
    } catch (error) {
      if (esCancelacion(error)) return;
      setErrorEdicion(mensajeFalloPlanEditar(error, "No se pudo buscar en el catálogo."));
    } finally {
      if (secuencia === secuenciaCatalogoRef.current) setBuscandoCatalogo(false);
    }
  }

  async function buscarEnCatalogo(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    await buscarCatalogoPorTexto(consultaCatalogo);
  }

  useEffect(() => {
    if (!intercambioAbierto || consultaCatalogo.trim().length < 2) return;
    const temporizador = window.setTimeout(() => void buscarCatalogoPorTexto(consultaCatalogo), 280);
    return () => {
      window.clearTimeout(temporizador);
      peticionCatalogoRef.current?.abort();
    };
    // The search function reads only current local state; changing it on every
    // render would restart the debounce.
  }, [consultaCatalogo, intercambioAbierto, loraMode]);

  useEffect(() => {
    if (!intercambioAbierto) peticionCatalogoRef.current?.abort();
  }, [intercambioAbierto]);

  useEffect(() => {
    if (!solicitudImagenes) return;
    const idsSolicitados = new URLSearchParams(solicitudImagenes).getAll("variant_id");
    const controlador = new AbortController();
    fetch(`/api/catalogo/imagenes?${solicitudImagenes}`, { signal: controlador.signal })
      .then((respuesta) => (respuesta.ok ? respuesta.json() : Promise.reject(new Error("No se pudieron cargar las fotos del catálogo."))))
      .then((datos: { imagenes?: Record<string, string> }) => {
        const imagenes = datos.imagenes ?? {};
        setImagenesCatalogo((previas) => ({ ...previas, ...imagenes }));
        setImagenesAusentes((previas) => ({ ...previas, ...Object.fromEntries(idsSolicitados.filter((variantId) => !imagenes[variantId]).map((variantId) => [variantId, true] as const)) }));
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setImagenesAusentes((previas) => ({ ...previas, ...Object.fromEntries(idsSolicitados.map((variantId) => [variantId, true] as const)) }));
      });
    return () => controlador.abort();
  }, [solicitudImagenes]);

  useEffect(() => {
    // Cuántas veces salió cada producto en el entrenamiento del LoRA (solo modo dev).
    if (!modoDev) return;
    const controlador = new AbortController();
    const parametros = loraMode ? `?loraMode=${encodeURIComponent(loraMode)}` : "";
    fetch(`/api/lora/training-reference-counts${parametros}`, { signal: controlador.signal, cache: "no-store" })
      .then((respuesta) => (respuesta.ok ? respuesta.json() : Promise.reject(new Error("No se pudieron cargar las referencias de entrenamiento."))))
      .then((datos: ReferenciasEntrenamientoResponse) => setReferenciasEntrenamiento(datos.countsByCatalogId ?? {}))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setReferenciasEntrenamiento({});
      });
    return () => controlador.abort();
  }, [loraMode, modoDev]);

  useEffect(() => () => peticionEvidenciaRef.current?.abort(), []);

  // A plan that arrives from outside (the chat built another one) is the base of the next edit.
  useEffect(() => {
    cola.sincronizar(plan);
  }, [cola, plan]);

  // The edit notice (and its "Deshacer") stays a few seconds, then gets out of the way; longer with Python's sentences to read.
  useEffect(() => {
    if (!avisoEdicion) return;
    const fin = window.setTimeout(() => setAvisoEdicion((actual) => (actual?.id === avisoEdicion.id ? null : actual)), avisoEdicion.avisos?.length ? 12000 : 6000);
    return () => window.clearTimeout(fin);
  }, [avisoEdicion]);

  // Approved again: the "your proposal changed" notice has done its job.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberado: el aviso depende de un cambio de la prop `aprobado`.
    if (aprobado) setEditadoTrasAprobar(false);
  }, [aprobado]);

  useEffect(() => {
    if (!editorAbierto) return;
    document.getElementById(editorId)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [editorAbierto, editorId]);

  useEffect(() => {
    if (!intercambioAbierto) return;
    requestAnimationFrame(() => volverDetalleRef.current?.focus() ?? busquedaCatalogoRef.current?.focus());
  }, [intercambioAbierto]);

  const botonAjustar = editorDisponible && <button type="button" data-testid="editar-plan" aria-expanded={editorAbierto} aria-controls={editorId} onClick={() => { setDetalleAbierto(true); setEditorAbierto((abierto) => !abierto); }} className="ui-pressable inline-flex items-center gap-1 rounded-full border border-borde px-2.5 py-1 text-xs font-medium text-acento hover:bg-acento-suave focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento"><Plus className="size-3" aria-hidden="true" />Ajustar plan</button>;

  return (
    <motion.section
      data-testid="plan-desglose"
      aria-label={`Tu propuesta: ${plan.plan.concepto.titulo}`}
      variants={CASCADA}
      initial={reducir ? false : "oculto"}
      animate="visible"
      className="@container mt-3 w-full max-w-190 overflow-hidden rounded-[20px] border border-borde-suave bg-superficie text-texto shadow-[0_1px_2px_var(--sombra),0_18px_40px_var(--sombra)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-4 pt-4 @xl:px-5.5 @xl:pt-4.5">
        <div className="min-w-0 flex-1 basis-60">
          <motion.p variants={ENTRADA_CASCADA} className="text-xs font-medium text-acento">Tu propuesta</motion.p>
          <motion.h3 variants={ENTRADA_CASCADA} className="mt-0.5 text-lg font-semibold leading-snug tracking-tight text-texto @xl:text-xl">{plan.plan.concepto.titulo}</motion.h3>
          {resumenPlan && <motion.p variants={ENTRADA_CASCADA} data-testid="plan-resumen" className="mt-1 text-sm text-texto-suave">{resumenPlan}</motion.p>}
          {plan.event_label && <p data-testid="plan-event-label" className="mt-1 text-xs text-texto-suave">Evento: <span className="font-medium text-texto">{plan.event_label}</span></p>}
          {modoDev && plan.event_match_levels && plan.event_match_levels.length > 0 && (
            <div data-testid="plan-match-levels" className="mt-1 flex flex-wrap gap-1.5" aria-label="Niveles de coincidencia del catálogo">
              {plan.event_match_levels.map((level) => (
                <span key={level} className="rounded-full border border-borde px-1.5 py-0.5 text-[10px] font-medium text-texto-suave">
                  {level === "exact_event" ? "Evento exacto" : level === "thematic" ? "Temático" : "Adaptable"}
                </span>
              ))}
            </div>
          )}
        </div>
        {referenceBlueprint && miniaturaReferencia && piezasIncluidas > 0 && (
          <motion.div variants={ENTRADA_CASCADA} className="flex items-center gap-2.5 rounded-2xl bg-superficie-suave py-1.5 pl-1.5 pr-3 ring-1 ring-borde-suave ring-inset">
            <img src={miniaturaReferencia} alt="Tu foto de referencia" width={52} height={36} className="h-9 w-13 rounded-[10px] object-cover" />
            <span>
              <span className="block text-xs font-semibold text-texto">Basada en tu foto</span>
              <span className="block text-xs text-texto-suave">{piezasIncluidas} de {contar(piezasEnFoto.length, "pieza incluida", "piezas incluidas")}</span>
            </span>
          </motion.div>
        )}
      </div>
      {/* The concept description is free model text and may name pieces the plan does not have; the summary above is derived from the real structures. */}
      {modoDev && <p className="px-4 pt-2 text-xs text-texto-suave @xl:px-5.5">{plan.plan.concepto.descripcion}</p>}

      {fotoEspacio && <div className="px-4 pt-4 @xl:px-5.5"><PanelEspacio foto={fotoEspacio} espacio={plan.plan.espacio} /></div>}

      <motion.ul
        variants={LISTA_CASCADA}
        aria-label="Piezas de la propuesta"
        className={conFotos
          ? "grid grid-cols-2 gap-2.5 px-4 pt-4 @xl:gap-3 @xl:px-5.5"
          : "grid grid-cols-1 gap-2.5 px-4 pt-4 @md:grid-cols-2 @2xl:grid-cols-3 @xl:px-5.5"}
      >
        {piezas.map((pieza, indice) => conFotos
          ? <TarjetaPiezaFoto key={pieza.id} pieza={pieza} retraso={reducir ? 0 : 0.45 + indice * 0.2} controles={idDetalle} onAbrir={() => abrirPieza(pieza.id)} />
          : <ChipEstructura key={pieza.id} pieza={pieza} controles={idDetalle} onAbrir={() => abrirPieza(pieza.id)} />)}
      </motion.ul>

      {!conFotos && productos.length > 0 && (
        <motion.div variants={ENTRADA_CASCADA} className="px-4 pt-4 @xl:px-5.5">
          <p className="text-[13px] font-semibold text-texto">Globos que usaré</p>
          <motion.ul variants={LISTA_CASCADA} className="mt-2.5 grid grid-cols-1 gap-2.5 @md:grid-cols-2 @2xl:grid-cols-3" aria-label="Productos del catálogo que usa la propuesta">
            {productos.slice(0, 6).map((producto, indice) => <TarjetaProducto key={producto.clave} producto={producto} indice={indice} />)}
          </motion.ul>
          {productos.length > 6 && <p className="mt-2 text-xs text-texto-suave">Y {contar(productos.length - 6, "producto más", "productos más")} en el detalle.</p>}
        </motion.div>
      )}

      {soloGlobos && tramosPlan.length > 0 && (
        <motion.div variants={ENTRADA_CASCADA} className="px-4 pt-4 @xl:px-5.5">
          <BarraTamanos tramos={tramosPlan} descripcion={textoTamanosPlan ? mayusculaInicial(textoTamanosPlan) : null} retraso={reducir ? 0 : 0.9} />
        </motion.div>
      )}

      {escenografia.length > 0 && (
        <motion.div variants={ENTRADA_CASCADA} data-testid="plan-ambientacion" className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-4 pt-3 text-xs text-texto-suave @xl:px-5.5">
          <span>En la imagen también pondré</span>
          <ul className="contents" aria-label="Escenografía de tu foto que va en la imagen; se puede quitar">
            {escenografia.map((chip) => {
              const encendido = chipEncendido(chip);
              return (
                <li key={chip.etiqueta} className="contents">
                  <button
                    type="button"
                    aria-pressed={encendido}
                    disabled={!onEscenografiaToggle}
                    onClick={() => onEscenografiaToggle?.(chip.elementIds, !encendido)}
                    title={encendido ? `Quitar ${chip.etiqueta.toLowerCase()} de la imagen` : `Poner ${chip.etiqueta.toLowerCase()} en la imagen`}
                    className={`rounded-full px-2.5 py-0.5 ring-1 ring-inset transition-colors focus-visible:outline-2 focus-visible:outline-acento disabled:cursor-default ${encendido ? "bg-superficie-suave text-texto ring-borde-suave" : "text-texto-suave line-through ring-borde-suave hover:text-texto"}`}
                  >
                    {chip.etiqueta}
                  </button>
                </li>
              );
            })}
          </ul>
          <span>· no se cotizan</span>
        </motion.div>
      )}

      {ajustes.length > 0 && (
        <motion.div variants={ENTRADA_CASCADA} className="px-4 pt-3 @xl:px-5.5">
          <AjustesPropuesta ajustes={ajustes} />
        </motion.div>
      )}
      {modoDev && plan.event_relaxations && plan.event_relaxations.length > 0 && (
        <p data-testid="plan-event-relaxations" className="mx-4 mt-3 rounded-md border border-aviso/40 bg-aviso-suave px-2.5 py-2 text-xs text-aviso @xl:mx-5.5">
          Ajustes declarados: {plan.event_relaxations.join("; ")}
        </p>
      )}

      <motion.div
        ref={detalleRef}
        id={idDetalle}
        inert={!detalleAbierto}
        initial={false}
        animate={{ height: detalleAbierto ? "auto" : 0, opacity: detalleAbierto ? 1 : 0 }}
        transition={reducir ? { duration: 0 } : { height: { duration: 0.42, ease: [0.23, 1, 0.32, 1] }, opacity: { duration: 0.25 } }}
        style={{ overflow: "hidden" }}
      >
        <div className="space-y-3 px-4 pt-4 @xl:px-5.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-texto-suave">Toca una pieza para ver qué lleva</p>
            {botonAjustar}
          </div>

          {editorDisponible && editorAbierto && (
            <section id={editorId} aria-labelledby={`${editorId}-titulo`} className="space-y-3 rounded-2xl border border-borde bg-superficie-suave p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 id={`${editorId}-titulo`} className="text-sm font-semibold text-texto">Ajusta la propuesta</h3>
                  <p className="mt-0.5 text-xs text-texto-suave">Busca el globo que quieres, elige su tamaño y color, y guárdalo. El total se actualiza al instante.</p>
                </div>
                <button type="button" aria-label="Cerrar editor del plan" onClick={cerrarEditor} className="rounded-md p-1 text-texto-suave hover:bg-superficie hover:text-texto focus-visible:outline-2 focus-visible:outline-acento"><X className="size-4" aria-hidden="true" /></button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-xs text-texto-suave">¿En qué pieza?<select name="estructura-plan" value={estructuraEdicion} onChange={(evento) => { setEstructuraEdicion(evento.target.value); setObjetivoEdicion(null); setVarianteEdicion(null); }} className="mt-1 w-full rounded-md border border-borde bg-superficie px-2 py-2 text-sm text-texto focus-visible:outline-2 focus-visible:outline-acento">{plan.plan.estructuras.map((estructura) => <option key={estructura.estructura_id} value={estructura.estructura_id}>{descripcionesPorId.get(estructura.estructura_id) ?? estructura.nombre}</option>)}</select></label>
                <label className="text-xs text-texto-suave">¿Qué quieres hacer?<select name="accion-plan" value={modoEdicion} onChange={(evento) => { setModoEdicion(evento.target.value as ModoEdicion); setObjetivoEdicion(null); setVarianteEdicion(null); }} className="mt-1 w-full rounded-md border border-borde bg-superficie px-2 py-2 text-sm text-texto focus-visible:outline-2 focus-visible:outline-acento"><option value="agregar">Agregar un globo</option><option value="reemplazar">Cambiar un globo</option></select></label>
              </div>
              {modoEdicion === "reemplazar" && <label className="block text-xs text-texto-suave">¿Qué globo cambias?<select name="objetivo-plan" value={objetivoEdicion ?? ""} onChange={(evento) => setObjetivoEdicion(evento.target.value || null)} className="mt-1 w-full rounded-md border border-borde bg-superficie px-2 py-2 text-sm text-texto focus-visible:outline-2 focus-visible:outline-acento"><option value="">Elige un globo</option>{lineasVisiblesPorVariante(plan.estructuras.find((estructura) => estructura.estructura_id === estructuraEdicion)?.lineas ?? []).map((linea) => <option key={linea.variant_id} value={linea.variant_id}>{[productoCliente(linea.titulo), linea.tamano_codigo ? pulgadasCliente(linea.tamano_codigo) : null, linea.color].filter(Boolean).join(" · ")}</option>)}</select></label>}
              <form onSubmit={buscarVariantes} className="flex gap-2"><label htmlFor={`${editorId}-buscar`} className="sr-only">Buscar un globo en el catálogo</label><input id={`${editorId}-buscar`} name="consulta-variante-plan" autoComplete="off" value={consultaEdicion} onChange={(evento) => setConsultaEdicion(evento.target.value)} placeholder="Ej. globo rojo de 5 pulgadas…" className="min-w-0 flex-1 rounded-md border border-borde bg-superficie px-2.5 py-2 text-sm text-texto outline-none placeholder:text-texto-tenue focus-visible:border-acento focus-visible:outline-2 focus-visible:outline-acento" /><button type="submit" disabled={buscandoEdicion || !consultaEdicion.trim()} className="ui-pressable inline-flex shrink-0 items-center gap-1 rounded-md bg-acento px-3 py-2 text-sm font-semibold text-sobre-acento disabled:opacity-50"><Search className="size-3.5" aria-hidden="true" />{buscandoEdicion ? "Buscando…" : "Buscar"}</button></form>
              {candidatosEdicion.length > 0 && <ul className="space-y-2" aria-label="Resultados del catálogo">{candidatosEdicion.map((candidato) => <li key={candidato.productId} className="rounded-md border border-borde bg-superficie/70 p-2"><p className="text-xs font-semibold text-texto">{productoCliente(candidato.titulo)}</p><div className="mt-1.5 flex flex-wrap gap-1.5">{candidato.variantes.map((variante) => { const elegido = varianteEdicion?.variantId === variante.variantId; return <button key={variante.variantId} type="button" aria-pressed={elegido} onClick={() => elegirVariante(candidato, variante)} className={`rounded-md border px-2 py-1 text-left text-[11px] transition-colors focus-visible:outline-2 focus-visible:outline-acento ${elegido ? "border-acento bg-acento-suave text-acento" : "border-borde text-texto hover:bg-fondo"}`}><span className="font-semibold">{variante.codigoTamano ? pulgadasCliente(variante.codigoTamano) : variante.titulo ?? "Variante"}</span><span className="ml-1 text-texto-suave">{pesos.format(variante.precio)}{variante.colores.length ? ` · ${variante.colores.join(", ")}` : ""}</span></button>; })}</div></li>)}</ul>}
              {varianteEdicion && (
                <form onSubmit={aplicarEdicion} className="space-y-3 rounded-xl bg-superficie p-3">
                  {varianteEdicion.colores.length > 1 ? (
                    <fieldset>
                      <legend className="text-xs text-texto-suave">¿De qué color?</legend>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {varianteEdicion.colores.map((color) => {
                          const elegido = colorEdicion === color;
                          return (
                            <button key={color} type="button" aria-pressed={elegido} onClick={() => setColorEdicion(color)} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ring-1 ring-inset transition-colors focus-visible:outline-2 focus-visible:outline-acento ${elegido ? "bg-acento-suave font-semibold text-acento ring-acento" : "text-texto ring-borde-suave hover:bg-superficie-suave"}`}>
                              <span aria-hidden="true" className="size-3.5 rounded-full ring-1 ring-black/10" style={{ background: muestraColor(color, null).fondo }} />
                              {color}
                            </button>
                          );
                        })}
                      </div>
                    </fieldset>
                  ) : varianteEdicion.colores.length === 1 ? (
                    <p className="flex items-center gap-1.5 text-xs text-texto-suave">
                      <span aria-hidden="true" className="size-3.5 rounded-full ring-1 ring-black/10" style={{ background: muestraColor(varianteEdicion.colores[0]!, null).fondo }} />
                      Color: <span className="font-medium text-texto">{varianteEdicion.colores[0]}</span>
                    </p>
                  ) : (
                    <label className="block text-xs text-texto-suave">Color (opcional)<input name="color-variante-plan" autoComplete="off" value={colorEdicion} onChange={(evento) => setColorEdicion(evento.target.value)} placeholder="Según catálogo…" className="mt-1 w-full rounded-md border border-borde bg-fondo px-2 py-1.5 text-sm text-texto focus-visible:outline-2 focus-visible:outline-acento" /></label>
                  )}
                  {modoEdicion === "agregar" && (
                    <label className="block text-xs text-texto-suave">
                      <span className="flex items-center justify-between">Cuánto de la pieza lleva este globo<output className="font-semibold tabular-nums text-texto">{participacionEdicion}%</output></span>
                      <input name="participacion-variante-plan" type="range" min="2" max="79" step="1" value={participacionEdicion} onChange={(evento) => setParticipacionEdicion(evento.target.value)} className="mt-1.5 w-full accent-[var(--acento)]" />
                      <span className="mt-0.5 flex justify-between text-[11px] text-texto-tenue"><span>Un toque</span><span>Protagonista</span></span>
                    </label>
                  )}
                  <button type="submit" disabled={guardandoEdicion} data-testid="guardar-edicion-plan" className="ui-pressable w-full rounded-lg bg-acento px-3 py-2 text-sm font-semibold text-sobre-acento disabled:opacity-50 sm:w-auto">{guardandoEdicion ? "Guardando…" : modoEdicion === "agregar" ? "Agregar a la pieza" : "Cambiar el globo"}</button>
                </form>
              )}
              {errorEdicion && <p role="alert" aria-live="polite" className="text-xs font-medium text-error">{errorEdicion}</p>}
            </section>
          )}
          {!editorAbierto && errorEdicion && !seleccionCatalogo && <p role="alert" className="rounded-xl bg-error-suave px-3 py-2 text-xs font-medium text-error">{errorEdicion}</p>}

          <ol className="space-y-2.5" aria-label="Piezas de la decoración">
            {vistasEstructura.map(({ estructura, declarada, oficial, leyenda, patron, admitePatron: conPatron }, indice) => (
              <DetalleEstructura
                key={estructura.estructura_id}
                idBase={`${editorId}-pieza-${indice}`}
                estructura={estructura}
                declarada={declarada}
                oficial={oficial}
                abierto={estructuraAbierta === estructura.estructura_id}
                onAlternar={() => setEstructuraAbierta((actual) => (actual === estructura.estructura_id ? null : estructura.estructura_id))}
                recorte={piezas[indice]?.recorteCrudo}
                lineas={lineasVisiblesPorVariante(estructura.lineas)}
                imagenDe={(linea) => imagenLinea(linea.variant_id, linea.imagen)}
                fotoAusente={(linea) => Boolean(imagenesAusentes[linea.variant_id])}
                sumaCop={consumoPorEstructura.get(estructura.estructura_id) ?? null}
                editable={editorDisponible}
                onAgregar={() => abrirEditor("agregar", estructura.estructura_id)}
                onEditar={(linea) => abrirEditor("reemplazar", estructura.estructura_id, linea)}
                onQuitar={(linea) => void quitarVariante(estructura.estructura_id, linea)}
                puedeQuitar={(linea) => lineaQuitable(linea, lineasVisiblesPorVariante(estructura.lineas), declarada?.materiales)}
                // The sliders save on release and show their own status (with "Reintentar"); the card keeps its "Deshacer".
                onRepartir={editorDisponible ? (participaciones) => aplicarAjusteDirecto({ accion: "repartir", estructura_id: estructura.estructura_id, participaciones }, "Listo, cambié la distribución de colores.", { enDialogo: true }) : undefined}
                onCambiarMezcla={editorDisponible ? (mezcla) => aplicarAjusteDirecto({ accion: "mezcla", estructura_id: estructura.estructura_id, mezcla }, "Listo, cambié los tamaños de la pieza.", { enDialogo: true }) : undefined}
                patron={conPatron || patron ? {
                  resuelto: patron,
                  leyenda,
                  onEditar: editorDisponible && conPatron ? () => abrirEditorPatron(estructura.estructura_id) : undefined,
                  onHojaArmado: patron ? () => setHojaArmado(estructura.estructura_id) : undefined,
                  // The session starts from the plan the pending slider changes sign.
                  ocupado: guardandoAjustes,
                } : undefined}
                vistaReparto={editorDisponible ? {
                  pedir: (participaciones, signal) => pedirVistaPatron({ plan: plan.plan, estructura_id: estructura.estructura_id, patron_color: null, participaciones: [...participaciones] }, { signal }),
                  vistas: vistasEnVivo,
                } : undefined}
                ocupado={guardandoEdicion}
                pendientes={pendientes}
                onVerProducto={(linea, disparador) => { disparadorModalRef.current = disparador; setSeleccionCatalogo({ linea, estructuraId: estructura.estructura_id, estructura: estructura.nombre }); setIntercambioAbierto(false); setRecomendaciones([]); setResultadosCatalogo([]); setErrorEdicion(null); }}
                modoDev={modoDev}
                extraLinea={(linea) => {
                  // LoRA training evidence is a development tool, not something a customer reads.
                  if (!modoDev) return null;
                  const referencias = referenciaEntrenamiento(linea);
                  return referencias && <button type="button" data-testid="linea-referencias-entrenamiento" onClick={() => abrirEvidencia(linea, referencias)} className="ui-pressable shrink-0 rounded-lg border border-acento/35 bg-acento-suave px-2 py-1.5 text-left text-[11px] font-semibold leading-4 text-acento hover:bg-acento/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento" aria-label={`Ver ${referencias.count} ${referencias.count === 1 ? "referencia" : "referencias"} de entrenamiento para ${linea.titulo}`}><span className="block tabular-nums">{referencias.count} {referencias.count === 1 ? "referencia" : "referencias"}</span><span className="block font-normal">en entrenamiento</span></button>;
                }}
              />
            ))}
          </ol>

          <div className="space-y-1 text-xs text-texto-suave">
            <p>{soloGlobos ? `Unos ${contar(plan.totales.total_unidades, "globo", "globos")} en total.` : `Unas ${contar(plan.totales.total_unidades, "unidad", "unidades")} en total.`} Los globos se venden en paquetes cerrados y cada paquete se compra una sola vez para toda la decoración.</p>
            {/* ahorro_paquetes_cop compares against buying every structure line in separate packages, a purchase nobody quoted; for small plans it can exceed the total, so the customer only sees the real total. */}
            {modoDev && plan.totales.ahorro_paquetes_cop > 0 && <p>Ahorro por consolidar paquetes: <span className="font-medium text-texto">{pesos.format(plan.totales.ahorro_paquetes_cop)} COP</span></p>}
            {modoDev && acabados.length > 0 && <p>Acabado solicitado: <span className="font-medium text-texto">{acabados.join(", ")}</span></p>}
          </div>
          {plan.alternativas.length > 0 && <div data-testid="plan-alternativas" className="space-y-1 rounded-xl bg-superficie-suave p-3 text-xs text-texto"><p className="font-semibold">Otras opciones de precio</p>{plan.alternativas.map((alternativa) => <p key={alternativa.familia_id} className="flex items-center justify-between gap-2"><span>{alternativa.etiqueta === "economica" ? "Económica" : alternativa.etiqueta === "equilibrada" ? "Equilibrada" : "Premium"}: {productoCliente(alternativa.titulo)}</span><span className="shrink-0 font-medium">{pesos.format(alternativa.total_cop)}{alternativa.ahorro_cop > 0 ? ` · ahorras ${pesos.format(alternativa.ahorro_cop)}` : ""}</span></p>)}</div>}
          {modoDev && (sustituciones.length > 0 || sinCobertura.length > 0) && <div className="space-y-1 text-[11px] text-texto-suave">{sustituciones.map((item) => <p key={`sustitucion-dev:${item.estructura_id}:${item.pedido}:${item.entregado}:${item.motivo}`}>{item.estructura_id}: {item.pedido} → {item.entregado}</p>)}{sinCobertura.map((item) => <p key={`cobertura-dev:${item.estructura_id}:${item.product_id}:${item.tamano}`}>{item.estructura_id}: sin cobertura para {item.tamano}</p>)}</div>}
        </div>
      </motion.div>

      <motion.div variants={ENTRADA_CASCADA} className="mt-4 flex flex-col gap-3 border-t border-borde-suave bg-superficie-suave px-4 py-4 @2xl:flex-row @2xl:items-center @2xl:justify-between @xl:px-5.5">
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 @2xl:block">
          <p data-testid="plan-total" className="text-2xl font-semibold tracking-tight whitespace-nowrap tabular-nums text-texto">
            <NumeroAnimado valor={plan.totales.total_cop} formato="pesos" retraso={reducir ? 0 : 1.1} />
          </p>
          <p className={`text-xs ${plan.comercial.estado === "PRESUPUESTO_EXCEDIDO" ? "text-aviso" : "text-texto-suave"}`}>
            COP{estadoPresupuesto ? ` · ${estadoPresupuesto}` : ""}
            <span aria-hidden="true"> · </span>
            <button type="button" onClick={verCotizacion} aria-haspopup="dialog" className="font-medium whitespace-nowrap text-acento underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento">Ver cotización</button>
          </p>
        </div>
        <div className="flex flex-col-reverse items-stretch gap-1.5 @md:flex-row @md:items-center @md:justify-end">
          <button
            type="button"
            aria-expanded={detalleAbierto}
            aria-controls={idDetalle}
            onClick={() => setDetalleAbierto((abierto) => !abierto)}
            className="inline-flex h-10 items-center justify-center gap-1 rounded-[0.8rem] px-3 text-sm font-medium whitespace-nowrap text-acento hover:bg-acento-suave focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento"
          >
            {detalleAbierto ? "Ocultar productos" : editorDisponible ? "Ver productos y ajustar" : "Ver productos"}
            <ChevronDown className={`size-4 transition-transform ${detalleAbierto ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
          {onAprobar && (
            <div className="plan-card-approval-action">
              <BotonAprobar data-testid="aprobar-generar-plan" onClick={aprobarConCelebracion} disabled={aprobarDeshabilitado} ocupado={generando} className="w-full @md:w-auto">
                {textoAprobar}
              </BotonAprobar>
            </div>
          )}
        </div>
      </motion.div>

      <AnimatePresence>
        {avisoEdicion && (
          <motion.div
            key={avisoEdicion.id}
            role="status"
            initial={reducir ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
            className="overflow-hidden border-t border-borde-suave bg-exito-suave"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs text-texto @xl:px-5.5">
              <span className="flex items-center gap-1.5"><Check className="size-3.5 text-exito" aria-hidden="true" />{avisoEdicion.texto}</span>
              {avisoEdicion.avisos && avisoEdicion.avisos.length > 0 && (
                <ul data-testid="avisos-edicion" aria-label="Avisos de la edición" className="order-last basis-full space-y-0.5 text-texto-suave">
                  {avisoEdicion.avisos.map((aviso) => <li key={aviso} className="flex gap-1.5"><Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />{aviso}</li>)}
                </ul>
              )}
              {avisoEdicion.deshacer && puedeDeshacer(avisoEdicion.deshacer) && (
                <button type="button" data-testid="deshacer-edicion" onClick={() => { if (avisoEdicion.deshacer) deshacer(avisoEdicion.deshacer); }} className="rounded-full px-2.5 py-1 font-semibold text-acento underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento">
                  Deshacer
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {falloPatron && (
        <div data-testid="patron-sin-guardar" role="alert" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-borde-suave bg-error-suave px-4 py-2.5 text-xs font-medium text-error @xl:px-5.5">
          <span className="min-w-0">{falloPatron.mensaje}</span>
          {falloPatron.reintentar && (
            <button type="button" onClick={falloPatron.reintentar} className="shrink-0 rounded-full px-2.5 py-1 font-semibold text-acento underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento">
              Reintentar
            </button>
          )}
        </div>
      )}

      {editadoTrasAprobar && !aprobado && onAprobar && !bloqueo && (
        <p data-testid="plan-reaprobar" role="status" className="border-t border-borde-suave bg-acento-suave px-4 py-2.5 text-xs font-medium text-acento @xl:px-5.5">
          Cambiaste la propuesta: la imagen no se actualiza sola. Toca «Regenerar visual» cuando quieras verla.
        </p>
      )}

      {onAprobar && bloqueo && (
        <div data-testid="plan-aprobacion-bloqueada" role="status" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-borde-suave bg-aviso-suave px-4 py-2.5 text-xs text-aviso @xl:px-5.5">
          <span className="font-medium">{bloqueo.motivo}</span>
          {onPedirAjuste && (
            <button
              type="button"
              onClick={() => onPedirAjuste(bloqueo.mensaje)}
              className="ui-pressable inline-flex items-center gap-1 rounded-full bg-superficie px-3 py-1.5 font-semibold text-acento ring-1 ring-borde-suave ring-inset hover:bg-acento-suave focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento"
            >
              {bloqueo.accion}
            </button>
          )}
        </div>
      )}

      <GlobosCelebracion disparo={celebracion} colores={coloresCelebracion} />

      {patronEditando && vistaEditorPatron?.declarada && editorDisponible && (
        <EditorPatron
          key={vistaEditorPatron.estructura.estructura_id}
          onCerrar={cerrarEditorPatron}
          plan={plan.plan}
          estructura={vistaEditorPatron.estructura}
          declarada={vistaEditorPatron.declarada}
          oficial={vistaEditorPatron.oficial}
          resuelto={vistaEditorPatron.patron ?? null}
          aprobada={aprobado || editadoTrasAprobar}
          onGuardar={(patron) => guardarPatron(patronEditando, patron)}
        />
      )}
      {vistaHojaArmado?.patron && (
        <DialogoHojaArmado
          abierto
          onAbiertoChange={(abierta) => { if (!abierta) setHojaArmado(null); }}
          resuelto={vistaHojaArmado.patron}
          leyenda={vistaHojaArmado.leyenda}
          estructura={vistaHojaArmado.estructura}
          declarada={vistaHojaArmado.declarada}
          oficial={vistaHojaArmado.oficial}
          tituloPlan={plan.plan.concepto.titulo}
        />
      )}

      {!onVerCotizacion && (
        <DialogoCotizacion
          plan={plan}
          abierto={cotizacionAbierta}
          onAbiertoChange={setCotizacionAbierta}
          imagenDe={(compra) => imagenLinea(compra.variant_id, compra.imagen)}
          onAprobar={onAprobar ? () => { setCotizacionAbierta(false); aprobarConCelebracion(); } : undefined}
          aprobarDeshabilitado={aprobarDeshabilitado}
          textoAprobar={textoAprobar}
          generando={generando}
        />
      )}

      <Dialog.Root open={Boolean(seleccionCatalogo) && !intercambioAbierto} onOpenChange={(abierto) => { if (abierto) return; setSeleccionCatalogo(null); setIntercambioAbierto(false); requestAnimationFrame(() => disparadorModalRef.current?.focus()); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-borde-suave bg-superficie p-4 shadow-lg">
            <Dialog.Title className="text-base font-semibold text-texto">{seleccionCatalogo ? productoCliente(seleccionCatalogo.linea.titulo) : "Detalle del producto"}</Dialog.Title>
            <Dialog.Description className="mt-1 text-xs text-texto-suave">Se usa en {seleccionCatalogo ? descripcionesPorId.get(seleccionCatalogo.estructuraId) ?? "la decoración" : "la decoración"}.</Dialog.Description>
            {seleccionCatalogo && <div className="mt-4 space-y-4"><div className="relative">{imagenSeleccionada ? <img src={imagenSeleccionada} alt={productoConTamanoCliente(seleccionCatalogo.linea.titulo, seleccionCatalogo.linea.tamano_codigo)} width={400} height={400} className="aspect-square w-full rounded-lg bg-superficie-2 object-contain" /> : <div className="flex aspect-square items-center justify-center rounded-lg bg-superficie-2 text-sm text-texto-suave">{imagenesAusentes[seleccionCatalogo.linea.variant_id] ? "Foto no disponible en el catálogo" : "Cargando foto…"}</div>}{editorDisponible && <button type="button" title="Cambiar elemento" aria-label="Cambiar elemento del catálogo" aria-expanded={intercambioAbierto} aria-controls={`intercambio-${plan.plan.plan_id}`} onClick={() => void abrirIntercambio()} className="absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-lg border border-borde bg-superficie/90 px-2.5 py-2 text-xs font-semibold text-texto shadow-sm backdrop-blur hover:bg-acento-suave hover:text-acento focus-visible:outline-2 focus-visible:outline-acento"><ArrowLeftRight className="size-3.5" aria-hidden="true" />Cambiar</button>}</div><dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm"><div><dt className="text-xs text-texto-suave">Tamaño</dt><dd className="font-medium text-texto">{seleccionCatalogo.linea.tamano_codigo ? pulgadasConCentimetrosCliente(seleccionCatalogo.linea.tamano_codigo, seleccionCatalogo.linea.diam_cm) : "No especificado"}</dd></div><div><dt className="text-xs text-texto-suave">Color</dt><dd className="font-medium text-texto">{seleccionCatalogo.linea.color ?? "Según catálogo"}</dd></div><div><dt className="text-xs text-texto-suave">Unidades en esta estructura</dt><dd className="font-medium tabular-nums text-texto">{seleccionCatalogo.linea.unidades}</dd></div>{compraSeleccionada && <><div><dt className="text-xs text-texto-suave">Se compra en</dt><dd className="font-medium text-texto">{paquetesCliente(compraSeleccionada.paquetes)}</dd></div><div><dt className="text-xs text-texto-suave">Unidades que sobran</dt><dd className="font-medium tabular-nums text-texto">{compraSeleccionada.sobrante}</dd></div><div><dt className="text-xs text-texto-suave">Precio de los paquetes</dt><dd className="font-medium tabular-nums text-texto">{pesos.format(compraSeleccionada.subtotal)}</dd></div></>}</dl>
              {editorDisponible && intercambioAbierto && <section id={`intercambio-${plan.plan.plan_id}`} aria-labelledby={`intercambio-${plan.plan.plan_id}-titulo`} className="space-y-3 rounded-lg border border-acento/30 bg-fondo/60 p-3"><div><h3 id={`intercambio-${plan.plan.plan_id}-titulo`} className="text-sm font-semibold text-texto">Cambia esta pieza</h3><p className="mt-0.5 text-xs text-texto-suave">Primero te muestro opciones del mismo tamaño y forma, priorizando colores cercanos y la misma familia; también puedes buscar cualquier pieza del catálogo.</p></div><div className="space-y-2"><p className="text-[11px] font-semibold uppercase tracking-wide text-texto-suave">Recomendados</p>{buscandoCatalogo && recomendaciones.length === 0 ? <p className="rounded-md bg-superficie px-2.5 py-2 text-xs text-texto-suave" role="status">Buscando opciones compatibles…</p> : opcionesRecomendadas.length > 0 ? <ListaOpciones opciones={opcionesRecomendadas} guardando={guardandoEdicion} onCambiar={(opcion) => void reemplazarDesdeCatalogo(opcion)} ariaLabel="Elementos recomendados" /> : <p className="rounded-md bg-superficie px-2.5 py-2 text-xs text-texto-suave">No encontré otra variante compatible. Prueba la búsqueda completa.</p>}</div><div className="space-y-2 border-t border-borde pt-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-texto-suave">Todo el catálogo</p><form onSubmit={buscarEnCatalogo} className="flex gap-2"><label htmlFor={`buscar-intercambio-${plan.plan.plan_id}`} className="sr-only">Buscar en todo el catálogo</label><input id={`buscar-intercambio-${plan.plan.plan_id}`} name="buscar-intercambio-catalogo" autoComplete="off" value={consultaCatalogo} onChange={(evento) => setConsultaCatalogo(evento.target.value)} placeholder="Busca por nombre, tamaño o color…" className="min-w-0 flex-1 rounded-md border border-borde bg-superficie px-2.5 py-2 text-sm text-texto outline-none placeholder:text-texto-suave focus-visible:border-acento focus-visible:outline-2 focus-visible:outline-acento" /><button type="submit" disabled={buscandoCatalogo || consultaCatalogo.trim().length < 2} className="ui-pressable inline-flex shrink-0 items-center gap-1 rounded-md bg-acento px-3 py-2 text-xs font-semibold text-sobre-acento disabled:opacity-50"><Search className="size-3.5" aria-hidden="true" />{buscandoCatalogo ? "Buscando…" : "Buscar"}</button></form>{opcionesBusqueda.length > 0 && <ListaOpciones opciones={opcionesBusqueda} guardando={guardandoEdicion} onCambiar={(opcion) => void reemplazarDesdeCatalogo(opcion)} ariaLabel="Resultados de todo el catálogo" />}</div></section>}
            </div>}
             {errorEdicion && <p role="alert" aria-live="polite" className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs font-medium text-error">{errorEdicion}</p>}
             <div className="mt-5 flex justify-end"><Dialog.Close asChild><button type="button" className="ui-pressable rounded-lg border border-borde px-3 py-2 text-sm font-medium text-texto hover:bg-fondo focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento">Cerrar</button></Dialog.Close></div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={Boolean(seleccionCatalogo) && intercambioAbierto} onOpenChange={(abierto) => { if (abierto) return; peticionCatalogoRef.current?.abort(); setIntercambioAbierto(false); requestAnimationFrame(() => disparadorModalRef.current?.focus()); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto overscroll-contain rounded-2xl border border-borde-suave bg-superficie p-4 shadow-lg">
            <Dialog.Title className="text-base font-semibold text-texto">Cambiar {seleccionCatalogo ? productoConTamanoCliente(seleccionCatalogo.linea.titulo, seleccionCatalogo.linea.tamano_codigo) : "elemento"}</Dialog.Title>
            <Dialog.Description className="mt-1 text-xs text-texto-suave">Elige otra pieza disponible del catálogo. El total de tu propuesta se actualiza con el cambio.</Dialog.Description>
            {seleccionCatalogo && (
              <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3">
                <button ref={volverDetalleRef} type="button" onClick={() => { setIntercambioAbierto(false); setErrorEdicion(null); }} className="self-start text-xs font-semibold text-acento underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-acento">Volver al detalle</button>
                <label htmlFor={`buscar-intercambio-${plan.plan.plan_id}`} className="sr-only">Buscar en todo el catálogo</label>
                <input
                  ref={busquedaCatalogoRef}
                  id={`buscar-intercambio-${plan.plan.plan_id}`}
                  name="buscar-intercambio-catalogo"
                  autoComplete="off"
                  spellCheck={false}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={consultaCatalogo.trim().length >= 2 && (buscandoCatalogo || opcionesBusqueda.length > 0)}
                  aria-controls={`opciones-intercambio-${plan.plan.plan_id}`}
                  aria-activedescendant={opcionBusquedaActiva >= 0 ? `opcion-intercambio-${opcionesBusqueda[opcionBusquedaActiva]?.variante.variantId}` : undefined}
                  value={consultaCatalogo}
                  onKeyDown={navegarOpcionesBusqueda}
                  onChange={(evento) => {
                    const valor = evento.target.value;
                    setConsultaCatalogo(valor);
                    setOpcionBusquedaActiva(-1);
                    if (valor.trim().length < 2) {
                      peticionCatalogoRef.current?.abort();
                      setResultadosCatalogo([]);
                    }
                  }}
                  placeholder="Busca por nombre, tamaño o color…"
                  className="w-full rounded-md border border-borde bg-superficie px-2.5 py-2 text-sm text-texto outline-none placeholder:text-texto-suave focus-visible:border-acento focus-visible:outline-2 focus-visible:outline-acento"
                />
                <div className="min-h-0 flex-1" aria-live="polite">
                  {consultaCatalogo.trim().length >= 2 ? (
                    buscandoCatalogo ? (
                      <p className="rounded-md bg-fondo px-2.5 py-2 text-xs text-texto-suave" role="status">Buscando en todo el catálogo…</p>
                    ) : opcionesBusqueda.length > 0 ? (
                      <ListaOpciones
                        opciones={opcionesBusqueda}
                        guardando={guardandoEdicion}
                        onCambiar={(opcion) => void reemplazarDesdeCatalogo(opcion)}
                        ariaLabel="Resultados de búsqueda del catálogo"
                        listId={`opciones-intercambio-${plan.plan.plan_id}`}
                        activeVariantId={opcionBusquedaActiva >= 0 ? opcionesBusqueda[opcionBusquedaActiva]?.variante.variantId : undefined}
                      />
                    ) : errorEdicion ? (
                      <div className="space-y-2 rounded-md bg-fondo px-2.5 py-2 text-xs text-texto-suave">
                        <p>{errorEdicion}</p>
                        <button type="button" onClick={() => void buscarCatalogoPorTexto(consultaCatalogo)} className="font-semibold text-acento underline underline-offset-2">Reintentar búsqueda</button>
                      </div>
                    ) : (
                      <p className="rounded-md bg-fondo px-2.5 py-2 text-xs text-texto-suave">No encontré variantes para esa búsqueda.</p>
                    )
                  ) : buscandoCatalogo && recomendaciones.length === 0 ? (
                    <p className="rounded-md bg-fondo px-2.5 py-2 text-xs text-texto-suave" role="status">Buscando opciones compatibles…</p>
                  ) : opcionesRecomendadas.length > 0 ? (
                    <ListaOpciones opciones={opcionesRecomendadas} guardando={guardandoEdicion} onCambiar={(opcion) => void reemplazarDesdeCatalogo(opcion)} ariaLabel="Elementos recomendados" />
                  ) : errorEdicion ? null : (
                    // A failed request is not "no compatible variants": that case shows only the error below.
                    <p className="rounded-md bg-fondo px-2.5 py-2 text-xs text-texto-suave">No encontré otra variante compatible. Escribe al menos dos caracteres para buscar.</p>
                  )}
                </div>
                {errorEdicion && consultaCatalogo.trim().length < 2 && (
                  <div role="alert" className="space-y-1.5 rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs font-medium text-error">
                    <p>{errorEdicion}</p>
                    {recomendaciones.length === 0 && <button type="button" disabled={buscandoCatalogo} onClick={() => void abrirIntercambio()} className="font-semibold underline underline-offset-2 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-acento">Reintentar</button>}
                  </div>
                )}
              </div>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <ReferenciasEntrenamientoModal
        key={revisionEvidencia}
        open={Boolean(referenciaEvidencia)}
        onClose={cerrarEvidencia}
        onRetry={() => { if (referenciaEvidencia) cargarEvidencia(referenciaEvidencia); }}
        loadState={estadoEvidencia}
        error={errorEvidencia}
        data={datosEvidencia}
        productLabel={referenciaEvidencia?.productLabel ?? "Producto"}
        expectedCount={referenciaEvidencia?.expectedCount ?? 0}
      />
    </motion.section>
  );
}
