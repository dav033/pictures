"use client";

import type { ComponentProps } from "react";
import type { ItemBiblioteca } from "@/lib/globos3d/biblioteca";
import { GRUPO_IDEAS_ASISTENTE } from "@/lib/globos3d/ideas-asistente";
import { GrillaCompacta } from "./GrillaCompacta";

type PropiedadesDeLaGrilla = Omit<ComponentProps<typeof GrillaCompacta>, "vacio">;

/**
 * El grupo «Ideas del asistente» de la pestaña Ideas de «Añadir» (D-038, D-039): las ideas del carrusel de la vista guiada que el
 * motor 3D arma, con su misma geometría. Sin ninguna (otra búsqueda, otro filtro) el grupo no sale. `items`: todas las del grupo
 * (la grilla muestra la página que le toca); las miniaturas las dibuja el visor único del panel.
 */
export function IdeasDelAsistente({ items, ...grilla }: PropiedadesDeLaGrilla & { items: readonly ItemBiblioteca[] }) {
  if (!items.length) return null;
  return (
    <section className="flex flex-col gap-2" aria-label={GRUPO_IDEAS_ASISTENTE}>
      <h3 className="taller-rotulo flex items-baseline justify-between gap-2">
        <span>{GRUPO_IDEAS_ASISTENTE}</span>
        <span className="font-normal normal-case tracking-normal">{items.length} · armadas con el motor 3D</span>
      </h3>
      <GrillaCompacta vacio="" {...grilla} />
    </section>
  );
}
