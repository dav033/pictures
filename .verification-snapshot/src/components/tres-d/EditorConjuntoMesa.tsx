"use client";

import { Minus, Plus } from "lucide-react";
import type { Escena, NodoEscena } from "@/lib/globos3d/escena";
import { MAX_NODOS } from "@/lib/globos3d/limites-escena";
import { esGrupoDeSillas, mesaDePieza, sillasDePieza } from "@/lib/globos3d/mobiliario-conjunto";
import { cambiarMesa, cambiarSillas, conjuntoDe, esConjuntoFijo, esMesaDelSalon, pasarAConjunto } from "@/lib/globos3d/mobiliario-conjunto-escena";
import {
  DISPOSICIONES, FONDO_DEL_ANCHO, LIMITES_MESA, MANTELES, MAX_SILLAS_POR_MESA, NOMBRE_MESA, TIPOS_MESA, TIPOS_SILLA,
  type DisposicionSillas, type MesaGuardada, type TipoMesa, type TipoSilla,
} from "@/lib/globos3d/mobiliario-conjunto-tipos";
import { ADMITE_CAMINO } from "@/lib/globos3d/mobiliario-mesas-param";
import { repartirSillas } from "@/lib/globos3d/mobiliario-perimetro";
import { SILLAS } from "@/lib/globos3d/mobiliario-sillas-param";
import { Deslizador } from "./PanelFlor";
import { BTN_ICO } from "./ui-taller";

const metros = (cm: number) => `${(cm / 100).toLocaleString("es-CO", { maximumFractionDigits: 2 })} m`;
const NOMBRE_MANTEL = { piso: "Hasta el piso", corto: "Corto", ninguno: "Sin mantel" } as const;
const NOMBRE_DISPOSICION: Readonly<Record<DisposicionSillas, string>> = {
  alrededor: "Alrededor", un_lado: "Un lado", dos_lados: "Dos lados (los largos)", cabeceras: "Solo cabeceras", frente: "Frente al escenario",
};
const SELECT = "rounded-md bg-superficie-suave px-2 py-1 text-xs";
const COLOR_CAMINO = "#c9a14a";

/** ¿Es una pieza que este editor cambia (una mesa de conjunto, sus sillas o un conjunto fijo de antes)? */
export const esConjuntoEditable = (n: NodoEscena, escena: Escena): boolean => conjuntoDe(escena, n.id) !== null || esConjuntoFijo(n);

/** El nombre del lado de la sala al que miran las sillas «frente al escenario» (el escenario está al fondo: 180°). */
const HACIA_FONDO = 180;

/**
 * Mesa y sillas del conjunto de mesa (REQ-012) en el inspector: tipo, medida, mantel y colores de la mesa; cantidad, tipo, disposición
 * y colores de las sillas. Cada cambio rearma la mesa y reparte las sillas por su perímetro real; lo que está sobre la tapa se queda
 * en ella. Un conjunto fijo de antes (`mesa_redonda_sillas`…) ofrece pasarlo a conjunto editable.
 */
export function EditorConjuntoMesa({ nodo, escena, onEscena }: { nodo: NodoEscena; escena: Escena; onEscena: (e: Escena, agrupar?: string) => void }) {
  // Una mesa del salón armado no se pasa a editable: el salón la recalcula (invitados, mesas, sillas por mesa) y la cuenta como suya.
  if (esMesaDelSalon(escena, nodo.id)) {
    return <p className="text-xs text-taller-suave">Esta mesa es del salón armado: sus sillas y la cantidad de mesas se cambian pidiéndole a la IA «ajustar el salón» (sillas por mesa, mesas), para que todo el salón se recalcule junto.</p>;
  }
  if (esConjuntoFijo(nodo)) {
    return (
      <div className="flex flex-col gap-2 text-xs text-taller-suave">
        <p>Este conjunto es una sola pieza con sus sillas fijas. Pásalo a mesa con sillas para cambiar cuántas hay, de qué tipo y cómo se reparten.</p>
        <button type="button" onClick={() => { if (escena.nodos.length >= MAX_NODOS) return; const nueva = pasarAConjunto(escena, nodo.id); if (nueva) onEscena(nueva); }} className="min-h-8 self-start rounded-md bg-superficie-suave px-2 text-taller-texto hover:bg-taller-encima">Hacerla editable</button>
      </div>
    );
  }
  const conjunto = conjuntoDe(escena, nodo.id);
  const mesa = conjunto ? mesaDePieza(conjunto.mesa.pieza) : null;
  if (!conjunto || !mesa) return null;
  const sillas = conjunto.sillas ? sillasDePieza(conjunto.sillas.pieza) : null;
  const agrupar = `conjunto-${conjunto.mesa.id}`;
  const ponMesa = (cambio: Partial<MesaGuardada>) => onEscena(cambiarMesa(escena, conjunto.mesa.id, cambio, []), agrupar);
  const tipoSilla: TipoSilla = sillas?.tipo ?? "tiffany";
  const disposicion: DisposicionSillas = sillas?.disposicion ?? "alrededor";
  const pedida = sillas?.pedida ?? 0;
  const ponSillas = (cambio: Parameters<typeof cambiarSillas>[2]) => onEscena(cambiarSillas(escena, conjunto.mesa.id, cambio, []), agrupar);
  const cantidadSillas = (n: number) => ponSillas({ cantidad: Math.max(0, Math.min(MAX_SILLAS_POR_MESA, n)), ...(sillas ? {} : { tipo: tipoSilla, disposicion }) });
  const l = LIMITES_MESA[mesa.tipo];
  const conFondo = !FONDO_DEL_ANCHO[mesa.tipo];
  const etiquetaAncho = mesa.tipo === "redonda" || mesa.tipo === "coctel" || mesa.tipo === "media_luna" ? "Diámetro" : mesa.tipo === "cuadrada" ? "Lado" : mesa.tipo === "u" ? "Ancho total" : "Largo";
  const etiquetaFondo = mesa.tipo === "u" ? "Fondo total" : "Ancho de la mesa";
  const capacidad = repartirSillas(mesa, { tipo: tipoSilla, cantidad: MAX_SILLAS_POR_MESA, disposicion, haciaGrados: sillas?.haciaGrados ?? 0 }).capacidad;
  const colorCojin = sillas?.colorCojin ?? null;

  return (
    <div className="flex flex-col gap-3" aria-label={`Mesa y sillas de ${conjunto.mesa.nombre}`}>
      <h4 className="taller-rotulo">Mesa</h4>
      <label className="flex items-center justify-between gap-2 text-xs text-taller-texto">Tipo de mesa
        <select aria-label="Tipo de mesa" value={mesa.tipo} onChange={(e) => ponMesa({ tipo: e.target.value as TipoMesa })} className={SELECT}>
          {TIPOS_MESA.map((t) => <option key={t} value={t}>{NOMBRE_MESA[t]}</option>)}
        </select>
      </label>
      <Deslizador id="conjunto-ancho" etiqueta={etiquetaAncho} valor={mesa.anchoCm} min={l.ancho[0]} max={l.ancho[1]} paso={5} texto={metros(mesa.anchoCm)} onCambio={(v) => ponMesa({ anchoCm: v })} />
      {conFondo && <Deslizador id="conjunto-fondo" etiqueta={etiquetaFondo} valor={mesa.fondoCm} min={l.fondo[0]} max={l.fondo[1]} paso={5} texto={metros(mesa.fondoCm)} onCambio={(v) => ponMesa({ fondoCm: v })} />}
      <Deslizador id="conjunto-alto" etiqueta="Alto de la tapa" valor={mesa.altoCm} min={l.alto[0]} max={l.alto[1]} paso={5} texto={metros(mesa.altoCm)} onCambio={(v) => ponMesa({ altoCm: v })} />
      <label className="flex items-center justify-between gap-2 text-xs text-taller-texto">Mantel
        <select aria-label="Mantel" value={mesa.mantel} onChange={(e) => ponMesa({ mantel: e.target.value as MesaGuardada["mantel"] })} className={SELECT}>
          {MANTELES.map((m) => <option key={m} value={m}>{NOMBRE_MANTEL[m]}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <span className="flex items-center gap-2 text-xs text-taller-texto"><input type="color" value={mesa.colorMantel} aria-label={mesa.mantel === "ninguno" ? "Color de la tapa" : "Color del mantel"} onChange={(e) => ponMesa({ colorMantel: e.target.value })} className="size-7 shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-0" />{mesa.mantel === "ninguno" ? "tapa" : "mantel"}</span>
        <span className="flex items-center gap-2 text-xs text-taller-texto"><input type="color" value={mesa.colorPatas} aria-label="Color de las patas" onChange={(e) => ponMesa({ colorPatas: e.target.value })} className="size-7 shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-0" />patas</span>
        {ADMITE_CAMINO.has(mesa.tipo) && (mesa.camino
          ? <span className="flex items-center gap-2 text-xs text-taller-texto"><input type="color" value={mesa.camino} aria-label="Color del camino de mesa" onChange={(e) => ponMesa({ camino: e.target.value })} className="size-7 shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-0" />camino<button type="button" aria-label="Quitar el camino de mesa" onClick={() => ponMesa({ camino: null })} className="ml-auto text-taller-suave hover:text-taller-texto">×</button></span>
          : <button type="button" onClick={() => ponMesa({ camino: COLOR_CAMINO })} className="min-h-8 rounded-md bg-superficie-suave px-2 text-left text-xs text-taller-suave hover:text-taller-texto">+ camino de mesa</button>)}
      </div>

      <h4 className="taller-rotulo">Sillas</h4>
      <div className="flex items-center justify-between gap-2 text-xs text-taller-texto">
        <span>Cantidad <span className="text-taller-suave">(caben {capacidad})</span></span>
        <span className="flex items-center gap-1.5">
          <button type="button" aria-label="Una silla menos" disabled={!sillas} onClick={() => cantidadSillas((sillas?.puestos.length ?? 0) - 1)} className={`${BTN_ICO} size-8`}><Minus className="size-4" aria-hidden /></button>
          <span className="min-w-6 text-center font-mono text-[13px]" aria-live="polite">{sillas?.puestos.length ?? 0}</span>
          <button type="button" aria-label="Una silla más" disabled={(sillas?.puestos.length ?? 0) >= capacidad} onClick={() => cantidadSillas((sillas?.puestos.length ?? 0) + 1)} className={`${BTN_ICO} size-8`}><Plus className="size-4" aria-hidden /></button>
        </span>
      </div>
      {pedida > (sillas?.puestos.length ?? 0) && <p className="text-[0.7rem] text-taller-peligro">Se pidieron {pedida}, pero en esta mesa con esta disposición solo caben {sillas?.puestos.length ?? 0}.</p>}
      <label className="flex items-center justify-between gap-2 text-xs text-taller-texto">Tipo de silla
        <select aria-label="Tipo de silla" value={tipoSilla} onChange={(e) => ponSillas({ cantidad: pedida || 4, tipo: e.target.value as TipoSilla })} className={SELECT}>
          {TIPOS_SILLA.map((t) => <option key={t} value={t}>{SILLAS[t].nombre}</option>)}
        </select>
      </label>
      <label className="flex items-center justify-between gap-2 text-xs text-taller-texto">Disposición
        <select aria-label="Disposición de las sillas" value={disposicion} onChange={(e) => ponSillas({ cantidad: pedida || 4, disposicion: e.target.value as DisposicionSillas, ...(e.target.value === "frente" ? { haciaGrados: HACIA_FONDO - (conjunto.mesa.colocacion.en === "piso" ? conjunto.mesa.colocacion.giroGrados : 0) } : {}) })} className={SELECT}>
          {DISPOSICIONES.map((d) => <option key={d} value={d}>{NOMBRE_DISPOSICION[d]}</option>)}
        </select>
      </label>
      {sillas && (
        <div className="grid grid-cols-2 gap-2">
          <span className="flex items-center gap-2 text-xs text-taller-texto"><input type="color" value={sillas.colorEstructura} aria-label="Color de las sillas" onChange={(e) => ponSillas({ cantidad: pedida, colorEstructura: e.target.value })} className="size-7 shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-0" />sillas</span>
          {SILLAS[sillas.tipo].cojin && (colorCojin
            ? <span className="flex items-center gap-2 text-xs text-taller-texto"><input type="color" value={colorCojin} aria-label="Color del cojín" onChange={(e) => ponSillas({ cantidad: pedida, colorCojin: e.target.value })} className="size-7 shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-0" />cojín<button type="button" aria-label="Quitar el cojín" onClick={() => ponSillas({ cantidad: pedida, colorCojin: null })} className="ml-auto text-taller-suave hover:text-taller-texto">×</button></span>
            : <button type="button" onClick={() => ponSillas({ cantidad: pedida, colorCojin: SILLAS[sillas.tipo].cojin })} className="min-h-8 rounded-md bg-superficie-suave px-2 text-left text-xs text-taller-suave hover:text-taller-texto">+ cojín</button>)}
        </div>
      )}
      <p className="text-[0.7rem] text-taller-suave">La mesa y sus sillas se mueven, giran y duplican juntas. Cada cambio reparte las sillas por el borde de la mesa.</p>
    </div>
  );
}

/** Para saber si una pieza elegida es el grupo de sillas de una mesa (no se mueve sola). */
export const esSillasDeMesa = (n: NodoEscena): boolean => esGrupoDeSillas(n.pieza);
