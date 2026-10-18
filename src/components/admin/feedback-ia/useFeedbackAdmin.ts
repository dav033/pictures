"use client";

import { useCallback, useEffect, useState } from "react";
import type { AnalisisFeedback, ErrorFeedback, ItemListadoFeedback, RespuestaListadoFeedback } from "@/lib/feedback-ia/contrato";
import { mensajeErrorCliente } from "@/lib/estado/mensaje-error-cliente";
import { consultaDeFiltros, FILTROS_INICIALES, type FiltrosPanel } from "./filtros";

const POR_PAGINA = 25;

class ErrorApi extends Error {
  constructor(mensaje: string, readonly codigo: ErrorFeedback["codigo"] | undefined) {
    super(mensaje);
  }
}

async function leerJson<T>(respuesta: Response): Promise<T> {
  const cuerpo: unknown = await respuesta.json();
  if (!respuesta.ok) {
    const error = cuerpo as Partial<ErrorFeedback>;
    throw new ErrorApi(error.error ?? "No se pudo completar la operación.", error.codigo);
  }
  return cuerpo as T;
}

async function pedirPagina(filtros: FiltrosPanel, desplazamiento: number): Promise<RespuestaListadoFeedback> {
  const consulta = consultaDeFiltros(filtros, { limite: String(POR_PAGINA), desplazamiento: String(desplazamiento) });
  return leerJson<RespuestaListadoFeedback>(await fetch(`/api/feedback-ia/admin?${consulta}`));
}

async function pedirUltimoAnalisis(): Promise<AnalisisFeedback | null> {
  const datos = await leerJson<{ analisis: AnalisisFeedback[] }>(await fetch("/api/feedback-ia/analisis"));
  return datos.analisis[0] ?? null;
}

/** Estado del panel: filtros, página de resultados y último análisis. Toda la red del panel pasa por aquí. */
export function useFeedbackAdmin() {
  const [filtros, setFiltros] = useState<FiltrosPanel>(FILTROS_INICIALES);
  const [items, setItems] = useState<ItemListadoFeedback[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analisis, setAnalisis] = useState<AnalisisFeedback | null>(null);
  const [analizando, setAnalizando] = useState(false);

  const aplicarPagina = useCallback((pagina: RespuestaListadoFeedback, desplazamiento: number) => {
    setTotal(pagina.total);
    setItems((previos) => (desplazamiento === 0 ? pagina.items : [...previos, ...pagina.items]));
  }, []);

  const mostrarFallo = useCallback((causa: unknown, respaldo: string) => {
    setError(mensajeErrorCliente(causa, respaldo));
  }, []);

  const cargar = useCallback(async (aplicados: FiltrosPanel, desplazamiento: number) => {
    setCargando(true);
    setError(null);
    try {
      aplicarPagina(await pedirPagina(aplicados, desplazamiento), desplazamiento);
    } catch (causa) {
      mostrarFallo(causa, "No se pudo cargar el feedback.");
    } finally {
      setCargando(false);
    }
  }, [aplicarPagina, mostrarFallo]);

  useEffect(() => {
    pedirPagina(FILTROS_INICIALES, 0)
      .then((pagina) => aplicarPagina(pagina, 0))
      .catch((causa) => mostrarFallo(causa, "No se pudo cargar el feedback."))
      .finally(() => setCargando(false));
    pedirUltimoAnalisis().then(setAnalisis).catch(() => setAnalisis(null));
  }, [aplicarPagina, mostrarFallo]);

  const analizarAhora = useCallback(async (dias: number, conResumen: boolean) => {
    setAnalizando(true);
    setError(null);
    try {
      const datos = await leerJson<{ analisis: AnalisisFeedback }>(await fetch("/api/feedback-ia/analisis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dias, conResumen }),
      }));
      setAnalisis(datos.analisis);
    } catch (causa) {
      setError(mensajeErrorCliente(causa, "No se pudo ejecutar el análisis."));
    } finally {
      setAnalizando(false);
    }
  }, []);

  return {
    filtros,
    setFiltros,
    items,
    total,
    cargando,
    error,
    analisis,
    analizando,
    aplicarFiltros: () => cargar(filtros, 0),
    limpiarFiltros: () => { setFiltros(FILTROS_INICIALES); return cargar(FILTROS_INICIALES, 0); },
    cargarMas: () => cargar(filtros, items.length),
    analizarAhora,
  };
}
