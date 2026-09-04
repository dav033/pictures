"use client";

/* Catalog images come from runtime URLs and already carry explicit dimensions. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState, type FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowLeftRight, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import type { PlanResuelto } from "@/lib/plan/resuelto";
import type { Cotizacion } from "@/lib/cotizacion/motor";
import type { ProductoCandidato, VarianteCandidata } from "@/lib/rag/chat/buscar";
import { puntuacionCromatica } from "@/lib/rag/catalog/similitud-color";
import { ReferenciasEntrenamientoModal, type ReferenciasEvidenciaData } from "@/components/ReferenciasEntrenamientoModal";
import type { LoraModeSlug } from "@/lib/lora/schema";

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
};

type OpcionCatalogo = { candidato: ProductoCandidato; variante: VarianteCandidata };

function medidas(estructura: PlanResuelto["plan"]["estructuras"][number]): string {
  const valores = [estructura.medidas.ancho_m, estructura.medidas.alto_m, estructura.medidas.largo_m].filter((value): value is number => value != null);
  return valores.length ? valores.map((value) => `${value} m`).join(" × ") : "medida no aplica";
}

function unidadesPorInstancia(estructura: PlanResuelto["estructuras"][number]): string {
  const repeticiones = Math.max(1, estructura.repeticiones);
  const base = Math.floor(estructura.total_unidades / repeticiones);
  const resto = estructura.total_unidades % repeticiones;
  if (repeticiones === 1) return String(estructura.total_unidades);
  return resto === 0 ? `${base} cada una` : `${base} o ${base + 1} cada una`;
}

function unicosPor<T>(items: T[], clave: (item: T) => string): T[] {
  const vistas = new Set<string>();
  return items.filter((item) => {
    const key = clave(item);
    if (vistas.has(key)) return false;
    vistas.add(key);
    return true;
  });
}

function lineasVisiblesPorVariante(lineas: PlanResuelto["estructuras"][number]["lineas"]): PlanResuelto["estructuras"][number]["lineas"] {
  const agrupadas = new Map<string, PlanResuelto["estructuras"][number]["lineas"][number]>();
  for (const linea of lineas) {
    const anterior = agrupadas.get(linea.variant_id);
    if (!anterior) {
      agrupadas.set(linea.variant_id, { ...linea });
      continue;
    }
    agrupadas.set(linea.variant_id, {
      ...anterior,
      unidades: anterior.unidades + linea.unidades,
      sustitucion: anterior.sustitucion ?? linea.sustitucion,
    });
  }
  return [...agrupadas.values()];
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
            <span className="block truncate text-xs font-semibold text-texto">{candidato.titulo}</span>
            <span className="block truncate text-[11px] text-texto-suave">{variante.codigoTamano ?? "Tamaño no especificado"} · {variante.colores.join(", ") || "Color de catálogo"} · {pesos.format(variante.precio)}</span>
          </span>
          <button id={listId ? `opcion-intercambio-${variante.variantId}` : undefined} type="button" role={listId ? "option" : undefined} aria-selected={listId ? activeVariantId === variante.variantId : undefined} disabled={guardando} onClick={() => onCambiar({ candidato, variante })} className={`ui-pressable shrink-0 rounded-md bg-acento px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50 ${activeVariantId === variante.variantId ? "ring-2 ring-acento ring-offset-1" : ""}`}>
            {guardando ? "Cambiando…" : "Cambiar"}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function TarjetaPlanDecoracion({ plan, onAprobar, aprobado = false, generando = false, onPlanActualizado, loraMode }: Props) {
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
  const compraSeleccionada = seleccionCatalogo ? plan.compras.find((compra) => compra.variant_id === seleccionCatalogo.linea.variant_id) : undefined;
  const imagenSeleccionada = seleccionCatalogo ? seleccionCatalogo.linea.imagen ?? imagenesCatalogo[seleccionCatalogo.linea.variant_id] : undefined;
  const acabados = [...new Set(plan.plan.estructuras.flatMap((estructura) => estructura.materiales.map((material) => material.acabado).filter((acabado): acabado is string => Boolean(acabado))))];
  const estructuraSeleccionada = plan.plan.estructuras.find((estructura) => estructura.estructura_id === estructuraEdicion);
  const opcionesRecomendadas = seleccionCatalogo ? opcionesCatalogo(recomendaciones, seleccionCatalogo.linea, true) : [];
  const opcionesBusqueda = seleccionCatalogo ? opcionesCatalogo(resultadosCatalogo, seleccionCatalogo.linea, false) : [];

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
        setErrorEvidencia(error instanceof Error ? error.message : "No se pudieron cargar las fotos de entrenamiento.");
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
    setConsultaEdicion(objetivo ? [objetivo.tamano_codigo, objetivo.color].filter(Boolean).join(" ") : "");
    setCandidatosEdicion([]);
    setVarianteEdicion(null);
    setColorEdicion(objetivo?.color ?? "");
    setParticipacionEdicion("20");
    setErrorEdicion(null);
    setEditorAbierto(true);
  }

  function cerrarEditor() {
    if (guardandoEdicion) return;
    setEditorAbierto(false);
    setErrorEdicion(null);
  }

  async function buscarVariantes(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const consulta = consultaEdicion.trim();
    if (!consulta || buscandoEdicion) return;
    setBuscandoEdicion(true);
    setErrorEdicion(null);
    try {
      const respuesta = await fetch("/api/plan-editar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modo: "buscar", consulta, loraMode }) });
      const datos = await respuesta.json() as { candidatos?: ProductoCandidato[]; error?: string };
      if (!respuesta.ok) throw new Error(datos.error ?? "No se pudo buscar en el catálogo.");
      setCandidatosEdicion(datos.candidatos ?? []);
      if (!datos.candidatos?.length) setErrorEdicion("No encontré una variante disponible. Prueba con el código y el color, por ejemplo: R-5 rojo.");
    } catch (error) {
      setErrorEdicion(error instanceof Error ? error.message : "No se pudo buscar en el catálogo.");
    } finally {
      setBuscandoEdicion(false);
    }
  }

  function elegirVariante(candidato: ProductoCandidato, variante: VarianteCandidata) {
    setVarianteEdicion({ ...variante, productId: candidato.productId });
    if (!colorEdicion && variante.colores.length === 1) setColorEdicion(variante.colores[0]);
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
      const respuesta = await fetch("/api/plan-editar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modo: "aplicar", base: plan, edicion: { accion: modoEdicion, estructura_id: estructuraEdicion, objetivo_variant_id: objetivoEdicion ?? undefined, variante: { product_id: varianteEdicion.productId, variant_id: varianteEdicion.variantId, color: colorEdicion.trim() || undefined }, participacion: modoEdicion === "agregar" ? participacion : undefined }, loraMode }),
      });
       const datos = await respuesta.json() as { plan?: PlanResuelto; cotizacion?: Cotizacion; error?: string };
       if (!respuesta.ok || !datos.plan) throw new Error(datos.error ?? "No se pudo actualizar el plan.");
       onPlanActualizado(datos.plan, datos.cotizacion);
      cerrarEditor();
    } catch (error) {
      setErrorEdicion(error instanceof Error ? error.message : "No se pudo actualizar el plan.");
    } finally {
      setGuardandoEdicion(false);
    }
  }

  async function reemplazarDesdeCatalogo(opcion: OpcionCatalogo) {
    if (!onPlanActualizado || !seleccionCatalogo || guardandoEdicion) return;
    setGuardandoEdicion(true);
    setErrorEdicion(null);
    try {
      const respuesta = await fetch("/api/plan-editar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modo: "aplicar", base: plan, edicion: { accion: "reemplazar", estructura_id: seleccionCatalogo.estructuraId, objetivo_variant_id: seleccionCatalogo.linea.variant_id, variante: { product_id: opcion.candidato.productId, variant_id: opcion.variante.variantId, color: opcion.variante.colores[0] ?? undefined } }, loraMode }) });
       const datos = await respuesta.json() as { plan?: PlanResuelto; cotizacion?: Cotizacion; error?: string };
       if (!respuesta.ok || !datos.plan) throw new Error(datos.error ?? "No se pudo cambiar la pieza.");
       onPlanActualizado(datos.plan, datos.cotizacion);
       setIntercambioAbierto(false);
       setSeleccionCatalogo(null);
       requestAnimationFrame(() => disparadorModalRef.current?.focus());
    } catch (error) {
      setErrorEdicion(error instanceof Error ? error.message : "No se pudo cambiar la pieza.");
    } finally {
      setGuardandoEdicion(false);
    }
  }

  async function quitarVariante(estructuraId: string, linea: PlanResuelto["estructuras"][number]["lineas"][number]) {
    if (!onPlanActualizado || guardandoEdicion) return;
    if (!window.confirm(`¿Quitar ${linea.titulo} de ${estructuraId}?`)) return;
    setGuardandoEdicion(true);
    setErrorEdicion(null);
    try {
      const respuesta = await fetch("/api/plan-editar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modo: "aplicar", base: plan, edicion: { accion: "quitar", estructura_id: estructuraId, objetivo_variant_id: linea.variant_id }, loraMode }) });
       const datos = await respuesta.json() as { plan?: PlanResuelto; cotizacion?: Cotizacion; error?: string };
       if (!respuesta.ok || !datos.plan) throw new Error(datos.error ?? "No se pudo quitar la pieza.");
       onPlanActualizado(datos.plan, datos.cotizacion);
    } catch (error) {
      setErrorEdicion(error instanceof Error ? error.message : "No se pudo quitar la pieza.");
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
      const respuesta = await fetch("/api/plan-editar", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controlador.signal, body: JSON.stringify({ modo: "recomendadas", variant_id: seleccionCatalogo.linea.variant_id, loraMode }) });
      const datos = await respuesta.json() as { candidatos?: ProductoCandidato[]; error?: string };
      if (!respuesta.ok) throw new Error(datos.error ?? "No se pudieron cargar recomendaciones.");
      if (secuencia !== secuenciaCatalogoRef.current) return;
      setRecomendaciones(datos.candidatos ?? []);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setErrorEdicion(error instanceof Error ? error.message : "No se pudieron cargar recomendaciones.");
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
      const respuesta = await fetch("/api/plan-editar", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controlador.signal, body: JSON.stringify({ modo: "buscar", consulta, loraMode }) });
      const datos = await respuesta.json() as { candidatos?: ProductoCandidato[]; error?: string };
      if (!respuesta.ok) throw new Error(datos.error ?? "No se pudo buscar en el catálogo.");
      if (secuencia !== secuenciaCatalogoRef.current) return;
      setResultadosCatalogo(datos.candidatos ?? []);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setErrorEdicion(error instanceof Error ? error.message : "No se pudo buscar en el catálogo.");
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
  }, [consultaCatalogo, intercambioAbierto]);

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
  }, [loraMode]);

  useEffect(() => () => peticionEvidenciaRef.current?.abort(), []);

  useEffect(() => {
    if (!editorAbierto) return;
    document.getElementById(editorId)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [editorAbierto, editorId]);

  useEffect(() => {
    if (!intercambioAbierto) return;
    requestAnimationFrame(() => volverDetalleRef.current?.focus() ?? busquedaCatalogoRef.current?.focus());
  }, [intercambioAbierto]);

  return (
    <section data-testid="plan-desglose" className="mt-3 max-w-[92%] space-y-3 rounded-xl border border-acento/30 bg-superficie p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-texto">Esto es lo que voy a armar</p>
          <p className="text-xs text-texto-suave">{plan.plan.concepto.titulo} · estimado preliminar</p>
          {plan.event_label && <p data-testid="plan-event-label" className="mt-1 text-xs text-texto-suave">Evento: <span className="font-medium text-texto">{plan.event_label}</span></p>}
          {plan.event_match_levels && plan.event_match_levels.length > 0 && (
            <div data-testid="plan-match-levels" className="mt-1 flex flex-wrap gap-1.5" aria-label="Niveles de coincidencia del catálogo">
              {plan.event_match_levels.map((level) => (
                <span key={level} className="rounded-full border border-borde px-1.5 py-0.5 text-[10px] font-medium text-texto-suave">
                  {level === "exact_event" ? "Evento exacto" : level === "thematic" ? "Temático" : "Adaptable"}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {editorDisponible && <button type="button" data-testid="editar-plan" aria-expanded={editorAbierto} aria-controls={editorId} onClick={() => setEditorAbierto((abierto) => !abierto)} className="ui-pressable inline-flex items-center gap-1 rounded-full border border-acento/40 px-2 py-1 text-[10px] font-semibold text-acento hover:bg-acento-suave focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento"><Plus className="size-3" aria-hidden="true" />Ajustar plan</button>}
          <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${plan.comercial.estado === "PRESUPUESTO_EXCEDIDO" ? "bg-red-100 text-red-700" : "bg-acento-suave text-acento"}`}>
            {plan.comercial.estado === "APROBACION_REQUERIDA" ? "Revisión pendiente" : plan.comercial.estado === "VERIFICADO" ? "Dentro del techo" : "Excede el presupuesto"}
          </span>
        </div>
      </div>
      <p className="text-xs text-texto-suave">{plan.plan.concepto.descripcion}</p>
      {plan.event_relaxations && plan.event_relaxations.length > 0 && (
        <p data-testid="plan-event-relaxations" className="rounded-md border border-amber-300/60 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
          Ajustes declarados: {plan.event_relaxations.join("; ")}
        </p>
      )}

      {editorDisponible && editorAbierto && (
        <section id={editorId} aria-labelledby={`${editorId}-titulo`} className="space-y-3 rounded-lg border border-acento/30 bg-fondo/60 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 id={`${editorId}-titulo`} className="text-sm font-semibold text-texto">Ajusta la propuesta</h3>
              <p className="mt-0.5 text-xs text-texto-suave">Busca una variante real, elige el tamaño/color y guarda el cambio. La cotización se recalcula y cualquier aprobación anterior se reinicia.</p>
            </div>
            <button type="button" aria-label="Cerrar editor del plan" onClick={cerrarEditor} className="rounded-md p-1 text-texto-suave hover:bg-superficie hover:text-texto focus-visible:outline-2 focus-visible:outline-acento"><X className="size-4" aria-hidden="true" /></button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-texto-suave">Estructura<select name="estructura-plan" value={estructuraEdicion} onChange={(evento) => { setEstructuraEdicion(evento.target.value); setObjetivoEdicion(null); setVarianteEdicion(null); }} className="mt-1 w-full rounded-md border border-borde bg-superficie px-2 py-2 text-sm text-texto focus-visible:outline-2 focus-visible:outline-acento">{plan.plan.estructuras.map((estructura) => <option key={estructura.estructura_id} value={estructura.estructura_id}>{estructura.nombre}</option>)}</select></label>
            <label className="text-xs text-texto-suave">Acción<select name="accion-plan" value={modoEdicion} onChange={(evento) => { setModoEdicion(evento.target.value as ModoEdicion); setObjetivoEdicion(null); setVarianteEdicion(null); }} className="mt-1 w-full rounded-md border border-borde bg-superficie px-2 py-2 text-sm text-texto focus-visible:outline-2 focus-visible:outline-acento"><option value="agregar">Agregar una pieza</option><option value="reemplazar">Reemplazar una pieza</option></select></label>
          </div>
          {modoEdicion === "reemplazar" && <label className="block text-xs text-texto-suave">Pieza a reemplazar<select name="objetivo-plan" value={objetivoEdicion ?? ""} onChange={(evento) => setObjetivoEdicion(evento.target.value || null)} className="mt-1 w-full rounded-md border border-borde bg-superficie px-2 py-2 text-sm text-texto focus-visible:outline-2 focus-visible:outline-acento"><option value="">Elige una pieza</option>{lineasVisiblesPorVariante(plan.estructuras.find((estructura) => estructura.estructura_id === estructuraEdicion)?.lineas ?? []).map((linea) => <option key={linea.variant_id} value={linea.variant_id}>{linea.titulo} · {linea.tamano_codigo ?? "sin tamaño"}{linea.color ? ` · ${linea.color}` : ""}</option>)}</select></label>}
          <form onSubmit={buscarVariantes} className="flex gap-2"><label htmlFor={`${editorId}-buscar`} className="sr-only">Buscar variante del catálogo</label><input id={`${editorId}-buscar`} name="consulta-variante-plan" autoComplete="off" value={consultaEdicion} onChange={(evento) => setConsultaEdicion(evento.target.value)} placeholder="Ej. R-5 rojo…" className="min-w-0 flex-1 rounded-md border border-borde bg-superficie px-2.5 py-2 text-sm text-texto outline-none placeholder:text-texto-suave focus-visible:border-acento focus-visible:outline-2 focus-visible:outline-acento" /><button type="submit" disabled={buscandoEdicion || !consultaEdicion.trim()} className="ui-pressable inline-flex shrink-0 items-center gap-1 rounded-md bg-acento px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><Search className="size-3.5" aria-hidden="true" />{buscandoEdicion ? "Buscando…" : "Buscar"}</button></form>
          {candidatosEdicion.length > 0 && <ul className="space-y-2" aria-label="Resultados del catálogo">{candidatosEdicion.map((candidato) => <li key={candidato.productId} className="rounded-md border border-borde bg-superficie/70 p-2"><p className="text-xs font-semibold text-texto">{candidato.titulo}</p><div className="mt-1.5 flex flex-wrap gap-1.5">{candidato.variantes.map((variante) => { const elegido = varianteEdicion?.variantId === variante.variantId; return <button key={variante.variantId} type="button" aria-pressed={elegido} onClick={() => elegirVariante(candidato, variante)} className={`rounded-md border px-2 py-1 text-left text-[11px] transition-colors focus-visible:outline-2 focus-visible:outline-acento ${elegido ? "border-acento bg-acento-suave text-acento" : "border-borde text-texto hover:bg-fondo"}`}><span className="font-semibold">{variante.codigoTamano ?? variante.titulo ?? "Variante"}</span><span className="ml-1 text-texto-suave">{pesos.format(variante.precio)}{variante.colores.length ? ` · ${variante.colores.join(", ")}` : ""}</span></button>; })}</div></li>)}</ul>}
          {varianteEdicion && <form onSubmit={aplicarEdicion} className="grid gap-2 rounded-md bg-superficie p-2 sm:grid-cols-[1fr_8rem_auto] sm:items-end"><label className="text-xs text-texto-suave">Color en la estructura<input name="color-variante-plan" autoComplete="off" value={colorEdicion} onChange={(evento) => setColorEdicion(evento.target.value)} placeholder="Según catálogo…" className="mt-1 w-full rounded-md border border-borde bg-fondo px-2 py-1.5 text-sm text-texto focus-visible:outline-2 focus-visible:outline-acento" /></label>{modoEdicion === "agregar" ? <label className="text-xs text-texto-suave">Participación<input name="participacion-variante-plan" type="number" min="2" max="79" inputMode="numeric" value={participacionEdicion} onChange={(evento) => setParticipacionEdicion(evento.target.value)} className="mt-1 w-full rounded-md border border-borde bg-fondo px-2 py-1.5 text-sm text-texto focus-visible:outline-2 focus-visible:outline-acento" /></label> : <span /> }<button type="submit" disabled={guardandoEdicion} data-testid="guardar-edicion-plan" className="ui-pressable rounded-md bg-acento px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{guardandoEdicion ? "Guardando…" : modoEdicion === "agregar" ? "Agregar al plan" : "Reemplazar"}</button></form>}
          {errorEdicion && <p role="alert" aria-live="polite" className="text-xs font-medium text-error">{errorEdicion}</p>}
        </section>
      )}

      <ol className="space-y-3">
        {plan.estructuras.map((estructura, index) => (
          <li key={estructura.estructura_id}>
            <details className="group overflow-hidden rounded-lg bg-fondo/60">
              <summary className="cursor-pointer list-none p-3 [&::-webkit-details-marker]:hidden"><div className="flex items-start justify-between gap-2"><span className="min-w-0 text-sm font-medium text-texto">{index + 1}. {estructura.nombre}</span><span className="flex shrink-0 items-center gap-1 text-[10px] uppercase tracking-wide text-texto-suave">{estructura.tipo}<span aria-hidden className="text-base leading-none transition-transform duration-150 group-open:rotate-90">›</span></span></div><p className="mt-1 text-xs text-texto-suave">{estructura.repeticiones > 1 ? `${estructura.repeticiones} × ` : ""}{medidas(plan.plan.estructuras.find((item) => item.estructura_id === estructura.estructura_id)!)} · {estructura.total_unidades} unidades totales · {estructura.repeticiones > 1 ? `${unidadesPorInstancia(estructura)} · ` : ""}{estructura.ubicacion.replaceAll("_", " ")}</p>{estructura.mezcla_real.length > 0 && <p className="mt-1 text-xs text-texto"><span className="font-medium">Distribución cotizada: </span>{estructura.mezcla_real.map((linea) => `R-${linea.diam_pulg} · ${linea.unidades} (${Math.round(linea.pct)}%)`).join(" · ")}</p>}<p className="mt-1 text-xs text-texto-suave">{plan.plan.estructuras.find((item) => item.estructura_id === estructura.estructura_id)?.porque}</p></summary>
              <div className="border-t border-borde px-3 py-2.5">
                {editorDisponible && <button type="button" onClick={() => abrirEditor("agregar", estructura.estructura_id)} className="mb-2 inline-flex items-center gap-1 rounded-md border border-acento/40 px-2 py-1 text-[11px] font-semibold text-acento hover:bg-acento-suave focus-visible:outline-2 focus-visible:outline-acento"><Plus className="size-3" aria-hidden="true" />Agregar pieza</button>}
                <p className="text-xs font-semibold text-texto">Elementos del catálogo</p>
                <p className="mt-1 text-[11px] text-texto-suave">Una fila por variante. El desglose de paquetes se muestra en la cotización.</p>
                <ul className="mt-2 space-y-2">
                  {lineasVisiblesPorVariante(estructura.lineas).map((linea) => {
                    const imagen = linea.imagen ?? imagenesCatalogo[linea.variant_id];
                    const referencias = referenciaEntrenamiento(linea);
                    return (
                      <li key={linea.variant_id} className="flex items-center gap-1.5">
                        <button type="button" onClick={(evento) => { disparadorModalRef.current = evento.currentTarget; setSeleccionCatalogo({ linea, estructuraId: estructura.estructura_id, estructura: estructura.nombre }); setIntercambioAbierto(false); setRecomendaciones([]); setResultadosCatalogo([]); setErrorEdicion(null); }} aria-haspopup="dialog" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md bg-superficie/70 p-2 text-left text-xs transition-colors hover:bg-superficie-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento">
                          {imagen ? <img src={imagen} alt="" width={40} height={40} loading="lazy" className="size-10 shrink-0 rounded-md object-cover" /> : <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-md bg-superficie-2 text-center text-[10px] font-medium text-texto-suave">{imagenesAusentes[linea.variant_id] ? "Foto no disponible" : "Cargando foto…"}</span>}
                          <span className="min-w-0 flex-1"><span className="block truncate font-medium text-texto">{linea.titulo}</span><span className="mt-0.5 block text-texto-suave">{linea.tamano_codigo ?? "sin tamaño"}{linea.color ? ` · ${linea.color}` : ""} · {linea.unidades} unidades</span></span>
                          <span aria-hidden className="shrink-0 text-base leading-none text-texto-suave">›</span>
                        </button>
                        {referencias && <button type="button" data-testid="linea-referencias-entrenamiento" onClick={() => abrirEvidencia(linea, referencias)} className="ui-pressable shrink-0 rounded-lg border border-acento/35 bg-acento-suave px-2 py-1.5 text-left text-[11px] font-semibold leading-4 text-acento hover:bg-acento/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento" aria-label={`Ver ${referencias.count} ${referencias.count === 1 ? "referencia" : "referencias"} de entrenamiento para ${linea.titulo}`}>
                          <span className="block tabular-nums">{referencias.count} {referencias.count === 1 ? "referencia" : "referencias"}</span><span className="block font-normal">en entrenamiento</span>
                        </button>}
                        {editorDisponible && <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-borde/70 bg-superficie/50 p-0.5"><button type="button" title={`Modificar ${linea.titulo}`} aria-label={`Modificar ${linea.titulo}`} onClick={() => abrirEditor("reemplazar", estructura.estructura_id, linea)} className="flex size-7 items-center justify-center rounded-md text-texto-suave hover:bg-acento-suave hover:text-acento focus-visible:outline-2 focus-visible:outline-acento"><Pencil className="size-3.5" aria-hidden="true" /></button><button type="button" title={`Quitar ${linea.titulo}`} aria-label={`Quitar ${linea.titulo}`} onClick={() => void quitarVariante(estructura.estructura_id, linea)} className="flex size-7 items-center justify-center rounded-md text-texto-suave hover:bg-error-suave hover:text-error focus-visible:outline-2 focus-visible:outline-acento"><Trash2 className="size-3.5" aria-hidden="true" /></button></div>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </details>
          </li>
        ))}
      </ol>
      <div className="border-t border-borde pt-2 text-xs text-texto"><div className="flex items-center justify-between gap-2 font-semibold"><span>Total: {plan.totales.total_unidades} unidades</span><span>{pesos.format(plan.totales.total_cop)} COP</span></div><p className="mt-1 text-texto-suave">Los paquetes se compran una sola vez para toda la decoración; el precio no se reparte por estructura.</p>{plan.totales.ahorro_paquetes_cop > 0 && <p className="mt-1 text-texto-suave">Ahorro por consolidar paquetes: <span className="font-medium text-texto">{pesos.format(plan.totales.ahorro_paquetes_cop)} COP</span></p>}{acabados.length > 0 && <p className="mt-1 text-texto-suave">Acabado solicitado: <span className="font-medium text-texto">{acabados.join(", ")}</span></p>}{plan.comercial.techo_cop != null && <p className={`mt-1 ${plan.comercial.delta_cop > 0 ? "text-red-700" : "text-texto-suave"}`}>Techo: {pesos.format(plan.comercial.techo_cop)}{plan.comercial.delta_cop > 0 ? ` · excede ${pesos.format(plan.comercial.delta_cop)}` : " · compatible"}</p>}</div>
      {plan.alternativas.length > 0 && <div data-testid="plan-alternativas" className="space-y-1 border-t border-borde pt-2 text-xs text-texto"><p className="font-semibold">Alternativas compatibles</p>{plan.alternativas.map((alternativa) => <p key={alternativa.familia_id} className="flex items-center justify-between gap-2"><span>{alternativa.etiqueta}: {alternativa.titulo}</span><span className="shrink-0 font-medium">{pesos.format(alternativa.total_cop)}{alternativa.ahorro_cop > 0 ? ` · ahorra ${pesos.format(alternativa.ahorro_cop)}` : ""}</span></p>)}</div>}
      {(supuestos.length > 0 || sustituciones.length > 0 || sinCobertura.length > 0) && <div className="space-y-1 text-xs text-aviso">{supuestos.map((supuesto) => <p key={`supuesto:${supuesto}`}>⚠ {supuesto}</p>)}{sustituciones.map((item) => <p key={`sustitucion:${item.estructura_id}:${item.pedido}:${item.entregado}:${item.motivo}`}>⚠ {item.estructura_id}: {item.pedido} → {item.entregado}</p>)}{sinCobertura.map((item) => <p key={`cobertura:${item.estructura_id}:${item.product_id}:${item.tamano}`}>⚠ {item.estructura_id}: sin cobertura para {item.tamano}</p>)}</div>}
      {onAprobar && <div className="plan-card-approval-action"><button type="button" data-testid="aprobar-generar-plan" onClick={onAprobar} disabled={aprobado || generando || plan.comercial.estado === "PRESUPUESTO_EXCEDIDO" || plan.sin_cobertura.length > 0} aria-busy={generando} className="ui-button-primary ui-pressable w-full disabled:opacity-60">{generando ? "Generando…" : aprobado ? "Aprobación registrada" : plan.sin_cobertura.length > 0 ? "Completa las piezas sin cobertura" : "Aprobar y generar imagen"}</button></div>}

      <Dialog.Root open={Boolean(seleccionCatalogo) && !intercambioAbierto} onOpenChange={(abierto) => { if (abierto) return; setSeleccionCatalogo(null); setIntercambioAbierto(false); requestAnimationFrame(() => disparadorModalRef.current?.focus()); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-borde bg-superficie p-4 shadow-lg">
            <Dialog.Title className="text-base font-semibold text-texto">{seleccionCatalogo?.linea.titulo ?? "Detalle del producto"}</Dialog.Title>
            <Dialog.Description className="mt-1 text-xs text-texto-suave">Referencia usada en {seleccionCatalogo?.estructura ?? "la decoración"}.</Dialog.Description>
            {seleccionCatalogo && <div className="mt-4 space-y-4"><div className="relative">{imagenSeleccionada ? <img src={imagenSeleccionada} alt={seleccionCatalogo.linea.titulo} width={400} height={400} className="aspect-square w-full rounded-lg bg-superficie-2 object-contain" /> : <div className="flex aspect-square items-center justify-center rounded-lg bg-superficie-2 text-sm text-texto-suave">{imagenesAusentes[seleccionCatalogo.linea.variant_id] ? "Foto no disponible en el catálogo" : "Cargando foto…"}</div>}{editorDisponible && <button type="button" title="Cambiar elemento" aria-label="Cambiar elemento del catálogo" aria-expanded={intercambioAbierto} aria-controls={`intercambio-${plan.plan.plan_id}`} onClick={() => void abrirIntercambio()} className="absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-lg border border-borde bg-superficie/90 px-2.5 py-2 text-xs font-semibold text-texto shadow-sm backdrop-blur hover:bg-acento-suave hover:text-acento focus-visible:outline-2 focus-visible:outline-acento"><ArrowLeftRight className="size-3.5" aria-hidden="true" />Cambiar</button>}</div><dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm"><div><dt className="text-xs text-texto-suave">Tamaño</dt><dd className="font-medium text-texto">{seleccionCatalogo.linea.tamano_codigo ?? "No especificado"}{seleccionCatalogo.linea.diam_cm != null ? ` (${seleccionCatalogo.linea.diam_cm} cm)` : ""}</dd></div><div><dt className="text-xs text-texto-suave">Color</dt><dd className="font-medium text-texto">{seleccionCatalogo.linea.color ?? "Según catálogo"}</dd></div><div><dt className="text-xs text-texto-suave">Unidades en esta estructura</dt><dd className="font-medium tabular-nums text-texto">{seleccionCatalogo.linea.unidades}</dd></div>{compraSeleccionada && <><div><dt className="text-xs text-texto-suave">Presentación cotizada</dt><dd className="font-medium text-texto">{compraSeleccionada.paquetes} paquete{compraSeleccionada.paquetes === 1 ? "" : "s"} × {compraSeleccionada.unidades_paquete}</dd></div><div><dt className="text-xs text-texto-suave">Sobrante total</dt><dd className="font-medium tabular-nums text-texto">{compraSeleccionada.sobrante}</dd></div><div><dt className="text-xs text-texto-suave">Subtotal cotizado</dt><dd className="font-medium tabular-nums text-texto">{pesos.format(compraSeleccionada.subtotal)}</dd></div></>}</dl>
              {editorDisponible && intercambioAbierto && <section id={`intercambio-${plan.plan.plan_id}`} aria-labelledby={`intercambio-${plan.plan.plan_id}-titulo`} className="space-y-3 rounded-lg border border-acento/30 bg-fondo/60 p-3"><div><h3 id={`intercambio-${plan.plan.plan_id}-titulo`} className="text-sm font-semibold text-texto">Cambia esta pieza</h3><p className="mt-0.5 text-xs text-texto-suave">Primero te muestro opciones del mismo tamaño y forma, priorizando colores cercanos y la misma familia; también puedes buscar cualquier pieza del catálogo.</p></div><div className="space-y-2"><p className="text-[11px] font-semibold uppercase tracking-wide text-texto-suave">Recomendados</p>{buscandoCatalogo && recomendaciones.length === 0 ? <p className="rounded-md bg-superficie px-2.5 py-2 text-xs text-texto-suave" role="status">Buscando opciones compatibles…</p> : opcionesRecomendadas.length > 0 ? <ListaOpciones opciones={opcionesRecomendadas} guardando={guardandoEdicion} onCambiar={(opcion) => void reemplazarDesdeCatalogo(opcion)} ariaLabel="Elementos recomendados" /> : <p className="rounded-md bg-superficie px-2.5 py-2 text-xs text-texto-suave">No encontré otra variante compatible. Prueba la búsqueda completa.</p>}</div><div className="space-y-2 border-t border-borde pt-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-texto-suave">Todo el catálogo</p><form onSubmit={buscarEnCatalogo} className="flex gap-2"><label htmlFor={`buscar-intercambio-${plan.plan.plan_id}`} className="sr-only">Buscar en todo el catálogo</label><input id={`buscar-intercambio-${plan.plan.plan_id}`} name="buscar-intercambio-catalogo" autoComplete="off" value={consultaCatalogo} onChange={(evento) => setConsultaCatalogo(evento.target.value)} placeholder="Busca por nombre, tamaño o color…" className="min-w-0 flex-1 rounded-md border border-borde bg-superficie px-2.5 py-2 text-sm text-texto outline-none placeholder:text-texto-suave focus-visible:border-acento focus-visible:outline-2 focus-visible:outline-acento" /><button type="submit" disabled={buscandoCatalogo || consultaCatalogo.trim().length < 2} className="ui-pressable inline-flex shrink-0 items-center gap-1 rounded-md bg-acento px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><Search className="size-3.5" aria-hidden="true" />{buscandoCatalogo ? "Buscando…" : "Buscar"}</button></form>{opcionesBusqueda.length > 0 && <ListaOpciones opciones={opcionesBusqueda} guardando={guardandoEdicion} onCambiar={(opcion) => void reemplazarDesdeCatalogo(opcion)} ariaLabel="Resultados de todo el catálogo" />}</div></section>}
            </div>}
             {errorEdicion && <p role="alert" aria-live="polite" className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs font-medium text-error">{errorEdicion}</p>}
             <div className="mt-5 flex justify-end"><Dialog.Close asChild><button type="button" className="ui-pressable rounded-lg border border-borde px-3 py-2 text-sm font-medium text-texto hover:bg-fondo focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento">Cerrar</button></Dialog.Close></div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={Boolean(seleccionCatalogo) && intercambioAbierto} onOpenChange={(abierto) => { if (abierto) return; peticionCatalogoRef.current?.abort(); setIntercambioAbierto(false); requestAnimationFrame(() => disparadorModalRef.current?.focus()); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto overscroll-contain rounded-xl border border-borde bg-superficie p-4 shadow-lg">
            <Dialog.Title className="text-base font-semibold text-texto">Cambiar {seleccionCatalogo?.linea.titulo ?? "elemento"}</Dialog.Title>
            <Dialog.Description className="mt-1 text-xs text-texto-suave">Elige una variante real del catálogo para mantener el plan y la cotización trazables.</Dialog.Description>
            {seleccionCatalogo && (
              <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3">
                <button ref={volverDetalleRef} type="button" onClick={() => setIntercambioAbierto(false)} className="self-start text-xs font-semibold text-acento underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-acento">Volver al detalle</button>
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
                  ) : (
                    <p className="rounded-md bg-fondo px-2.5 py-2 text-xs text-texto-suave">No encontré otra variante compatible. Escribe al menos dos caracteres para buscar.</p>
                  )}
                </div>
                {errorEdicion && consultaCatalogo.trim().length < 2 && <p role="alert" className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs font-medium text-error">{errorEdicion}</p>}
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
    </section>
  );
}
