"use client";

import { procedenciaDeItem } from "@/lib/catalogo/anadir-repositorios";
import type { ItemBiblioteca } from "@/lib/globos3d/biblioteca";
import { useRepositoriosCatalogo } from "./useRepositoriosCatalogo";

/**
 * La línea de procedencia en la ficha de un item (REQ-013 fase 5): de qué repositorio es, su versión y su licencia. Solo con la
 * interfaz por repositorio encendida; apagada, sin leer o fallida no pinta nada y la ficha es la de siempre.
 */
export function ProcedenciaDeItem({ item }: { item: ItemBiblioteca }) {
  const repositorios = useRepositoriosCatalogo();
  const texto = procedenciaDeItem(item, repositorios);
  return texto ? <span className="text-xs text-texto-suave" data-testid="procedencia-item">Repositorio: {texto}</span> : null;
}
