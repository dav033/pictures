"use client";

import { useCallback, useMemo, useState } from "react";
import type { ItemBiblioteca, TipoItem } from "@/lib/globos3d/biblioteca";
import {
  FILTRO_TAXONOMIA_VACIO, contarPorEje, filtrarPorTaxonomia, ordenarPorIds, textoEtiquetaPrincipal,
  type EjeTaxonomia, type FiltroTaxonomia,
} from "@/lib/taller/filtros-taxonomia";
import { useClasificador } from "./clasificacion-cliente";
import { useBusquedaFoto } from "./useBusquedaFoto";

const SIN_CONTEOS: Readonly<Record<EjeTaxonomia, ReadonlyMap<string, number>>> = { celebraciones: new Map(), tematicas: new Map() };

/**
 * Lo que se le suma a la biblioteca filtrada de «Añadir» (`useBibliotecaFiltrada`): los filtros por celebración y
 * temática (con la clasificación local, cargada perezosa), la búsqueda por foto (los parecidos, en su orden) y la
 * etiqueta principal de cada item para su tarjeta. Los conteos salen de los items de la pestaña, como los de color y globo.
 */
export function useRefinarBiblioteca(deTipo: readonly ItemBiblioteca[], visibles: readonly ItemBiblioteca[], tipos: readonly TipoItem[]) {
  const clasificador = useClasificador();
  const [taxonomia, setTaxonomia] = useState<FiltroTaxonomia>(FILTRO_TAXONOMIA_VACIO);
  const foto = useBusquedaFoto(tipos);

  const conteos = useMemo(
    () => (clasificador ? { celebraciones: contarPorEje(deTipo, clasificador, "celebraciones"), tematicas: contarPorEje(deTipo, clasificador, "tematicas") } : SIN_CONTEOS),
    [deTipo, clasificador],
  );
  const idsFoto = foto.estado.fase === "listo" ? foto.estado.ids : null;
  const refinados = useMemo(() => {
    const porTaxonomia = clasificador ? filtrarPorTaxonomia(visibles, clasificador, taxonomia) : visibles;
    return idsFoto ? ordenarPorIds(porTaxonomia, idsFoto) : porTaxonomia;
  }, [visibles, clasificador, taxonomia, idsFoto]);
  const etiquetaDe = useCallback((id: string) => (clasificador ? textoEtiquetaPrincipal(clasificador(id)) : null), [clasificador]);

  return { refinados, taxonomia, onTaxonomia: setTaxonomia, conteos, cargandoClasificacion: clasificador === null, etiquetaDe, foto, conFoto: idsFoto !== null };
}
