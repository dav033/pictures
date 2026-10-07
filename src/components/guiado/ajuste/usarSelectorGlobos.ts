"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { esCancelacion, mensajeFalloPlanEditar } from "@/lib/plan/peticion-plan-editar";
import { armarBusqueda, LIMITE_MAXIMO, type ColorCatalogo } from "@/components/plan/ajuste/ajuste-propuesta";
import { pedirBusqueda } from "@/components/plan/ajuste/cliente-explorador";
import { agruparColoresPorFamilia, type FamiliaId } from "@/components/plan/ajuste/familias-color";
import { agruparGlobos, filtrarGlobos, globosDeCandidatos, type GloboCatalogo, type GrupoGlobos } from "./selector-globos";

/** La consulta con que se piden globos lisos: los títulos del catálogo son «Globo Latex Redondo Reflex Dorado». */
const CONSULTA = "globo latex redondo";
/** Espera antes de buscar en el servidor lo que el cliente escribe (lo cargado se filtra al instante). */
const ESPERA_BUSQUEDA_MS = 400;

type Resultado = { fase: "cargando" } | { fase: "error"; mensaje: string } | { fase: "listo"; globos: GloboCatalogo[] };

/**
 * Lo que muestra el selector de globos: los más vendidos al abrir (una búsqueda sin color), los de una familia al
 * tocar su chip y, al escribir, lo cargado filtrado al momento y una búsqueda en el catálogo con esa palabra. Todo con
 * la memoria del explorador de la clásica (`pedirBusqueda`): volver a una familia es instantáneo.
 */
export function useSelectorGlobos({ approvalToken, ventas, conImpresos, fuera }: { approvalToken: string; ventas: readonly ColorCatalogo[]; conImpresos: boolean; fuera: ReadonlySet<string> }) {
  const [familia, setFamilia] = useState<FamiliaId | null>(null);
  const [texto, setTexto] = useState("");
  const [buscado, setBuscado] = useState("");
  const [resultado, setResultado] = useState<Resultado>({ fase: "cargando" });
  const [intento, setIntento] = useState(0);
  // Las familias de la más vendida a la menos (la venta de una familia: la de su color más vendido).
  const familias = useMemo(() => {
    const vendidos = (familia: { colores: ReadonlyArray<{ total: number }> }) => Math.max(0, ...familia.colores.map((color) => color.total));
    return agruparColoresPorFamilia(ventas.filter((color) => color.valor !== "multicolor")).sort((a, b) => vendidos(b) - vendidos(a));
  }, [ventas]);
  const temporizador = useRef<number | null>(null);

  // Lo escrito se busca en el servidor tras una pausa corta.
  useEffect(() => {
    if (temporizador.current !== null) window.clearTimeout(temporizador.current);
    temporizador.current = window.setTimeout(() => setBuscado(texto.trim().length >= 3 ? texto.trim() : ""), ESPERA_BUSQUEDA_MS);
    return () => { if (temporizador.current !== null) window.clearTimeout(temporizador.current); };
  }, [texto]);

  useEffect(() => {
    const controlador = new AbortController();
    const colores = familia ? familias.find((item) => item.id === familia)?.colores.map((color) => color.valor) ?? [] : [];
    const cuerpo = armarBusqueda({ texto: buscado ? `${CONSULTA} ${buscado}` : CONSULTA, colores, tamanos: [], limite: LIMITE_MAXIMO, approvalToken });
    pedirBusqueda(cuerpo, controlador.signal)
      .then((respuesta) => { if (!controlador.signal.aborted) setResultado({ fase: "listo", globos: globosDeCandidatos(respuesta.candidatos, { conImpresos }) }); })
      .catch((error: unknown) => {
        if (controlador.signal.aborted || esCancelacion(error)) return;
        setResultado({ fase: "error", mensaje: mensajeFalloPlanEditar(error, "No pude cargar los globos del catálogo. Inténtalo de nuevo.") });
      });
    return () => controlador.abort();
  }, [familia, familias, buscado, approvalToken, conImpresos, intento]);

  const grupos: GrupoGlobos[] = useMemo(() => {
    if (resultado.fase !== "listo") return [];
    return agruparGlobos(filtrarGlobos(resultado.globos, texto), ventas, fuera);
  }, [resultado, texto, ventas, fuera]);

  return {
    familia,
    elegirFamilia: (siguiente: FamiliaId | null) => setFamilia((actual) => (actual === siguiente ? null : siguiente)),
    familias,
    texto,
    setTexto,
    resultado,
    grupos,
    reintentar: () => { setResultado({ fase: "cargando" }); setIntento((valor) => valor + 1); },
    buscando: resultado.fase === "cargando" || (texto.trim().length >= 3 && texto.trim() !== buscado),
  };
}
