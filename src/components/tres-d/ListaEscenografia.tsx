"use client";

import { useMemo } from "react";
import { repartirEscenografia, type EscenografiaPorRepositorio } from "@/lib/catalogo/lista-por-repositorio";
import { escenaDeItem, type ItemBiblioteca, type LineaEscenografia, type ProductosDeItem } from "@/lib/globos3d/biblioteca";
import { useRepositoriosCatalogo } from "./useRepositoriosCatalogo";

/**
 * La parte «Escenografía» de la lista de compra de una escena o de una ficha (REQ-013 fase 5, T25). Con la interfaz por repositorio
 * apagada, sin leer o fallida, es la de siempre: una sola sección. Encendida, la reparte en «Mobiliario» y «Escenografía»
 * (`repartirEscenografia`); si la escena no trae mobiliario queda una sola sección, igual que antes.
 */

/** Las líneas de la parte «Escenografía», repartidas por repositorio si la interfaz está encendida; `null`: la de siempre. */
export function useEscenografiaPorRepositorio(item: ItemBiblioteca, productos: ProductosDeItem): EscenografiaPorRepositorio | null {
  const activa = useRepositoriosCatalogo()?.ui === true;
  return useMemo(() => (activa ? repartirEscenografia(escenaDeItem(item), productos.escenografia) : null), [activa, item, productos.escenografia]);
}

const CLASE_DE_LINEA: Readonly<Record<LineaEscenografia["clase"], string>> = { escenografia: "escenografía", papel: "papel", follaje: "follaje artificial" };

function Grupo({ titulo, lineas, deMobiliario = false }: { titulo: string; lineas: readonly LineaEscenografia[]; deMobiliario?: boolean }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-texto">{titulo} <span className="font-normal text-texto-suave">· no es producto de la tienda</span></h4>
      <ul className="mt-1 text-sm text-texto">
        {lineas.map((e) => (
          <li key={`${e.clase}|${e.nombre}`}>{e.cantidad} × {e.nombre} <span className="text-[0.7rem] text-texto-suave">({deMobiliario ? "mobiliario" : CLASE_DE_LINEA[e.clase]})</span></li>
        ))}
      </ul>
    </div>
  );
}

export function ListaEscenografia({ productos, partes }: { productos: ProductosDeItem; partes: EscenografiaPorRepositorio | null }) {
  if (!partes) return productos.escenografia.length > 0 ? <Grupo titulo="Escenografía" lineas={productos.escenografia} /> : null;
  return (
    <>
      {partes.mobiliario.length > 0 && <Grupo titulo="Mobiliario" lineas={partes.mobiliario} deMobiliario />}
      {partes.escenografia.length > 0 && <Grupo titulo="Escenografía" lineas={partes.escenografia} />}
    </>
  );
}
