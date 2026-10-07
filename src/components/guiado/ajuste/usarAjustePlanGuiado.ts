"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { esCancelacion, mensajeFalloPlanEditar } from "@/lib/plan/peticion-plan-editar";
import { armarBusqueda, type ColorCatalogo } from "@/components/plan/ajuste/ajuste-propuesta";
import { pedirBusqueda, pedirColoresCatalogo } from "@/components/plan/ajuste/cliente-explorador";
import { coloresParaAgregar, confirmacionDelCambio, describirCambio, avisoEnCurso, type CambioPlan, type PlanGuiado } from "./ajuste-plan-guiado";
import { agregarColorEnServidor, aplicarEnServidor, ejecutarCambio, mensajeAjuste, quitarPiezaEnServidor } from "./ejecutar-ajuste";

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
    setEstado({ fase: "guardando", cambio, descripcion, aviso: avisoEnCurso(base, cambio) });
    try {
      const nuevo = await ejecutarCambio(cambio, base, {
        aplicar: (sobre, edicion) => aplicarEnServidor(sobre, edicion),
        quitarPieza: (sobre, estructuraId) => quitarPiezaEnServidor(sobre, estructuraId),
        agregarColor: (sobre, globo) => agregarColorEnServidor(sobre, globo),
        buscar: buscarColor,
        alDescartarColor: (color) => { if (montadoRef.current) setDescartados((actuales) => [...actuales, color]); },
      });
      onPlanAjustadoRef.current(nuevo.plan, nuevo.cotizacion, { descripcion, baseHash: base.plan_hash });
      if (montadoRef.current) setEstado({ fase: "quieto", ultimo: confirmacionDelCambio(base, cambio, nuevo.piezas) });
    } catch (error) {
      if (!esCancelacion(error)) console.warn("[asistente-guiado] no se pudo ajustar el plan", { cambio: cambio.tipo, error });
      if (montadoRef.current) setEstado({ fase: "error", cambio, mensaje: mensajeAjuste(error) });
    } finally {
      enCursoRef.current = false;
    }
  }, []);

  const reintentar = useCallback(() => {
    if (estado.fase === "error") void aplicar(estado.cambio);
  }, [estado, aplicar]);

  const descartarError = useCallback(() => setEstado({ fase: "quieto", ultimo: null }), []);

  /** Los colores del catálogo se piden la primera vez que se abre «Añadir un color» (con memoria en el navegador). */
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
