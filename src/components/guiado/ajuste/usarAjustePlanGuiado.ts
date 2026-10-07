"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { esCancelacion, mensajeFalloPlanEditar } from "@/lib/plan/peticion-plan-editar";
import { registrarEventoCliente } from "@/lib/registro/cliente";
import { armarBusqueda, type ColorCatalogo } from "@/components/plan/ajuste/ajuste-propuesta";
import { pedirBusqueda, pedirColoresCatalogo } from "@/components/plan/ajuste/cliente-explorador";
import { conversacionGuiada, VISTA_GUIADA } from "../registro-guiado";
import { coloresParaAgregar, confirmacionDelCambio, describirCambio, avisoEnCurso, type CambioPlan, type PlanGuiado } from "./ajuste-plan-guiado";
import { agregarColorEnServidor, aplicarEnServidor, ejecutarCambio, mensajeAjuste, quitarPiezaEnServidor, reemplazarColorEnServidor } from "./ejecutar-ajuste";

export type EstadoAjuste =
  | { fase: "quieto"; ultimo: string | null }
  | { fase: "guardando"; cambio: CambioPlan; descripcion: string; aviso: string }
  | { fase: "error"; cambio: CambioPlan; mensaje: string };

/**
 * Lo que acompaña a un plan ajustado. `descripcion`: la línea corta del historial («sin la columna derecha»).
 * `baseHash`: el plan sobre el que se hizo (si ya no es el vigente, no se publica).
 */
export type AjustePublicado = { descripcion: string; baseHash: string };

export type ColoresCatalogo = { fase: "nada" | "cargando" } | { fase: "error"; mensaje: string } | { fase: "listo"; colores: readonly ColorCatalogo[] };

type Entrada = {
  plan: PlanGuiado;
  /** Publica el plan nuevo en la misma tarjeta. */
  onPlanAjustado: (plan: PlanGuiado, cotizacion: unknown, ajuste: AjustePublicado) => void;
};

/** Cada toque del panel queda en el registro de la conversación (qué se pidió, qué resolvió Python, qué falló). */
export function registrarAjuste(evento: string, datos: Record<string, unknown>, nivel?: "warn" | "error"): void {
  registrarEventoCliente(evento, datos, conversacionGuiada(), { vista: VISTA_GUIADA, ...(nivel ? { nivel, tipo: nivel === "error" ? "error" as const : "evento" as const } : {}) });
}

/** Lo que se registra de un cambio (sin el plan entero). */
function resumenCambio(cambio: CambioPlan): Record<string, unknown> {
  switch (cambio.tipo) {
    case "reemplazar-color": return { tipo: cambio.tipo, color: cambio.color, a: { product_id: cambio.globo.productId, color: cambio.globo.color, nombre: cambio.globo.nombre, variantes: cambio.globo.variantIds.length }, piezas: cambio.estructuraIds ?? null };
    case "agregar-color": return { tipo: cambio.tipo, color: cambio.color, ...(cambio.globo ? { globo: { product_id: cambio.globo.productId, nombre: cambio.globo.nombre, variantes: cambio.globo.variantIds.length } } : {}) };
    default: return { ...cambio };
  }
}

/** Globos de un color para añadirlo: la búsqueda del explorador de la clásica, con su memoria en el navegador. */
async function buscarColor(color: string, approvalToken: string) {
  const respuesta = await pedirBusqueda(armarBusqueda({ texto: "globo redondo", colores: [color], tamanos: [], limite: 20, approvalToken }));
  return respuesta.candidatos;
}

/**
 * Estado de «Ajustar mi plan»: un cambio a la vez, cada uno rehecho por Python sobre el plan firmado que se ve (ninguno
 * pasa por el modelo). Mientras uno está en camino los mandos se apagan (la tarjeta muestra el esqueleto); si falla,
 * el plan no se toca y «Reintentar» repite ESE cambio.
 */
export function useAjustePlanGuiado({ plan, onPlanAjustado }: Entrada) {
  const [estado, setEstado] = useState<EstadoAjuste>({ fase: "quieto", ultimo: null });
  const [catalogo, setCatalogo] = useState<ColoresCatalogo>({ fase: "nada" });
  const [descartados, setDescartados] = useState<readonly string[]>([]);
  const planRef = useRef(plan);
  const montadoRef = useRef(true);
  const enCursoRef = useRef(false);
  const onPlanAjustadoRef = useRef(onPlanAjustado);

  useEffect(() => { planRef.current = plan; }, [plan]);
  useEffect(() => { onPlanAjustadoRef.current = onPlanAjustado; }, [onPlanAjustado]);
  useEffect(() => {
    montadoRef.current = true;
    return () => { montadoRef.current = false; };
  }, []);

  const aplicar = useCallback(async (cambio: CambioPlan): Promise<void> => {
    if (enCursoRef.current) return;
    enCursoRef.current = true;
    const base = planRef.current;
    const descripcion = describirCambio(base, cambio);
    const inicio = performance.now();
    setEstado({ fase: "guardando", cambio, descripcion, aviso: avisoEnCurso(base, cambio) });
    registrarAjuste("ajuste.pedir", { ...resumenCambio(cambio), descripcion, plan_hash: base.plan_hash });
    try {
      const nuevo = await ejecutarCambio(cambio, base, {
        aplicar: (sobre, edicion) => aplicarEnServidor(sobre, edicion),
        quitarPieza: (sobre, estructuraId) => quitarPiezaEnServidor(sobre, estructuraId),
        agregarColor: (sobre, globo, estructuraIds) => agregarColorEnServidor(sobre, globo, undefined, estructuraIds),
        reemplazarColor: (sobre, reemplazo) => reemplazarColorEnServidor(sobre, reemplazo),
        buscar: buscarColor,
        alDescartarColor: (color) => { if (montadoRef.current) setDescartados((actuales) => [...actuales, color]); },
      });
      onPlanAjustadoRef.current(nuevo.plan, nuevo.cotizacion, { descripcion, baseHash: base.plan_hash });
      const confirmacion = confirmacionDelCambio(base, cambio, nuevo.piezas, nuevo.plan);
      registrarAjuste("ajuste.listo", { tipo: cambio.tipo, descripcion, confirmacion, plan_hash_base: base.plan_hash, plan_hash: nuevo.plan.plan_hash, ms: Math.round(performance.now() - inicio), ...(nuevo.piezas ? { piezas: nuevo.piezas } : {}) });
      if (montadoRef.current) setEstado({ fase: "quieto", ultimo: confirmacion });
    } catch (error) {
      const mensaje = mensajeAjuste(error);
      if (!esCancelacion(error)) console.warn("[asistente-guiado] no se pudo ajustar el plan", { cambio: cambio.tipo, error });
      registrarAjuste("ajuste.fallo", { tipo: cambio.tipo, descripcion, mensaje, error: error instanceof Error ? error.message : String(error), plan_hash: base.plan_hash }, "warn");
      if (montadoRef.current) setEstado({ fase: "error", cambio, mensaje });
    } finally {
      enCursoRef.current = false;
    }
  }, []);

  const reintentar = useCallback(() => {
    if (estado.fase === "error") void aplicar(estado.cambio);
  }, [estado, aplicar]);

  const descartarError = useCallback(() => setEstado({ fase: "quieto", ultimo: null }), []);

  /** Los colores del catálogo (con cuántos globos vende de cada uno) se piden la primera vez que hacen falta. */
  const cargarColores = useCallback(() => {
    if (catalogo.fase === "cargando" || catalogo.fase === "listo") return;
    setCatalogo({ fase: "cargando" });
    pedirColoresCatalogo(planRef.current.approval_token)
      .then((colores) => { if (montadoRef.current) setCatalogo({ fase: "listo", colores }); })
      .catch((error: unknown) => { if (montadoRef.current) setCatalogo({ fase: "error", mensaje: mensajeFalloPlanEditar(error, "No pude cargar los colores. Inténtalo de nuevo.") }); });
  }, [catalogo.fase]);

  const coloresDisponibles = useCallback((presentes: readonly string[]): string[] => (
    catalogo.fase === "listo" ? coloresParaAgregar(catalogo.colores, presentes, descartados) : []
  ), [catalogo, descartados]);

  return { estado, aplicar, reintentar, descartarError, catalogo, cargarColores, coloresDisponibles, guardando: estado.fase === "guardando" };
}

export type AjustePlanGuiado = ReturnType<typeof useAjustePlanGuiado>;
