"use client";

import { memo, useMemo, useState } from "react";
import { ASIGNACION_FONDOS, type RepositorioDeFondos } from "@/lib/catalogo/asignacion-fondos";
import { idNuevo, type Escena } from "@/lib/globos3d/escena";
import { FONDOS_CATALOGO } from "@/lib/globos3d/fondos-escenografia";
import { MAX_NODOS } from "@/lib/globos3d/limites-escena";
import { colocacionPorDefecto } from "@/lib/globos3d/mobiliario-colocar";
import { mesaDePedido, sillasParaMesa } from "@/lib/globos3d/mobiliario-conjunto";
import { agregarConjuntoPorDefecto } from "@/lib/globos3d/mobiliario-conjunto-escena";
import { armarMesa } from "@/lib/globos3d/mobiliario-mesas-param";
import { armarSillas } from "@/lib/globos3d/mobiliario-sillas-param";
import { piezaDeEntrada } from "@/lib/globos3d/mobiliario-pieza";
import type { FondoCatalogo } from "@/lib/globos3d/mobiliario-tipos";
import { useArrastreDesdePanel } from "./arrastre-decoracion";
import { DibujoFondo } from "./DibujoFondo";
import { MINI, TARJETA, coincide } from "./ui-taller";

const GRUPOS = [
  { id: "fondo", titulo: "Fondos y tapetes" }, { id: "asiento", titulo: "Sillas y asientos" }, { id: "mesa", titulo: "Mesas" }, { id: "decorado", titulo: "Decorado de pie" },
] as const;

/** El dibujo de la tarjeta «Mesa con sillas»: una mesa redonda de 1,5 m con ocho sillas Tiffany, como queda al añadirla. */
const elementosDelConjunto = () => {
  const mesa = mesaDePedido({ tipo: "redonda" });
  const sillas = sillasParaMesa(mesa, { cantidad: 8 }).sillas;
  return [...armarMesa(mesa), ...(sillas ? armarSillas(sillas) : [])];
};

const medidasDe = (f: FondoCatalogo) => (f.clase === "mueble" ? f.medidas : { anchoCm: 100, fondoCm: 100, altoCm: 100 });

const NOMBRE_REPOSITORIO: Readonly<Record<RepositorioDeFondos, string>> = { mobiliario: "Mobiliario", escenografia: "Escenografía" };
/** Lo que también encuentra la búsqueda sin repositorio (el panel de siempre: cada una de estas palabras encuentra todo). Dentro de un repositorio solo cuentan el nombre y la descripción: si no, «silla» o «fondo» no acotarían nada. */
const PALABRAS_DE_SIEMPRE = "fondo mueble mobiliario escenografia silla mesa";
const TEXTO_CONJUNTO = "mesa silla conjunto banquete redonda cuadrada ovalada media luna serpentina en U";

/** Los fondos y muebles de un repositorio (por la asignación del registro, en su orden de siempre) o todos, que coinciden con la búsqueda. */
function fondosQueCoinciden(filtro: string, repositorio?: RepositorioDeFondos): FondoCatalogo[] {
  const palabras = repositorio ? undefined : PALABRAS_DE_SIEMPRE;
  return FONDOS_CATALOGO.filter((f) => (!repositorio || ASIGNACION_FONDOS.get(f.id) === repositorio) && coincide(filtro, f.nombre, f.descripcion, palabras));
}

/** La tarjeta de la mesa con sillas a medida es de mobiliario: solo sale sin repositorio o en el de mobiliario. */
const hayConjunto = (filtro: string, repositorio?: RepositorioDeFondos) => (!repositorio || repositorio === "mobiliario") && coincide(filtro, "Mesa con sillas a medida", TEXTO_CONJUNTO);

/** Cuántas tarjetas muestra con esta búsqueda (para el contador del panel). */
export const contarFondosYMuebles = (filtro: string, repositorio?: RepositorioDeFondos): number => fondosQueCoinciden(filtro, repositorio).length + (hayConjunto(filtro, repositorio) ? 1 : 0);

/**
 * «Fondos y muebles» (pestaña Utilería): los paneles, pedestales, tapete, cortina y letrero de las fotos y el mobiliario de
 * eventos (sillas, mesas, sofás, aros y arcos metálicos, carrito de dulces…), por grupos. Se arrastran al visor (con el
 * ratón) o se tocan y entran en su sitio de siempre (corridos si ya hay algo ahí, y encima de la mesa lo que va en una); luego
 * se mueven con el arrastre y los muebles se cambian de medida y color en su inspector, como cualquier pieza.
 */
export const FondosYMuebles = memo(function FondosYMuebles({ escena, onEscena, onSeleccion, filtro = "", repositorio, procedencias }: {
  escena: Escena; onEscena: (e: Escena) => void; onSeleccion?: (id: string | null) => void; filtro?: string;
  /** Solo los de este repositorio (REQ-013): su nombre es el título. Sin él, todos, como siempre. */
  repositorio?: RepositorioDeFondos;
  /** De dónde viene cada repositorio (`procedenciaDe`): va en la ayuda de cada tarjeta y en el aviso al añadirla; con `repositorio`, también bajo el título. */
  procedencias?: Partial<Record<RepositorioDeFondos, string>>;
}) {
  const arrastre = useArrastreDesdePanel();
  const [aviso, setAviso] = useState<string | null>(null);
  const visibles = useMemo(() => fondosQueCoinciden(filtro, repositorio), [filtro, repositorio]);
  const conConjunto = hayConjunto(filtro, repositorio);
  if (!visibles.length && !conConjunto) return null;
  const procedenciaDe = (f: FondoCatalogo) => { const dueno = ASIGNACION_FONDOS.get(f.id); return dueno ? procedencias?.[dueno] : undefined; };
  const ponerConjunto = () => {
    const r = agregarConjuntoPorDefecto(escena, MAX_NODOS);
    if (r.mesaId) { onEscena(r.escena); onSeleccion?.(r.mesaId); }
    setAviso(r.aviso ?? "Listo: la mesa con sus sillas quedó en la escena. Elígela para cambiar su tipo, su medida y las sillas.");
  };
  const poner = (f: FondoCatalogo) => {
    const id = idNuevo(escena, f.id.replace(/_/g, "-"));
    const { colocacion, aviso: sinLugar } = colocacionPorDefecto(escena, f, medidasDe(f));
    onEscena({ ...escena, nodos: [...escena.nodos, { id, nombre: f.nombre, pieza: piezaDeEntrada(f), colocacion }] });
    onSeleccion?.(id);
    const procedencia = procedenciaDe(f);
    setAviso(sinLugar ?? `Listo: «${f.nombre}» quedó en la escena. Arrástralo para moverlo.${procedencia ? ` Procedencia: ${procedencia}.` : ""}`);
  };
  return (
    <section className="flex flex-col gap-2" aria-label={repositorio ? NOMBRE_REPOSITORIO[repositorio] : "Fondos y muebles"}>
      {repositorio ? (
        <>
          <h3 className="taller-rotulo">{NOMBRE_REPOSITORIO[repositorio]}</h3>
          {procedencias?.[repositorio] && <p className="text-xs leading-snug text-taller-suave" data-testid="procedencia-repositorio">{procedencias[repositorio]}</p>}
        </>
      ) : <h3 className="taller-rotulo">Fondos y muebles <span className="font-normal normal-case tracking-normal">· no son globos: no cotizan</span></h3>}
      {GRUPOS.map((g) => {
        const delGrupo = visibles.filter((f) => (f.grupo ?? "fondo") === g.id);
        const conjunto = g.id === "mesa" && conConjunto;
        if (!delGrupo.length && !conjunto) return null;
        return (
          <div key={g.id} className="flex flex-col gap-1.5">
            <h4 className="text-xs font-medium text-taller-suave">{g.titulo}</h4>
            <div className="grid grid-cols-3 gap-2">
              {delGrupo.map((f) => (
                <button key={f.id} type="button" title={`${f.descripcion}${procedenciaDe(f) ? ` ${procedenciaDe(f)}.` : ""}${arrastre.arrastrable ? " Arrástralo al visor o tócalo." : ""}`}
                  onPointerDown={(e) => arrastre.apretar(e, () => ({ pieza: piezaDeEntrada(f), nombre: f.nombre, idBase: f.id.replace(/_/g, "-") }))}
                  onClick={(e) => { if (!arrastre.fueArrastre(e)) poner(f); }}
                  className={`${TARJETA} cursor-grab select-none active:cursor-grabbing`}>
                  <span className={MINI} aria-hidden><DibujoFondo id={f.id} elementos={f.elementos} /></span>
                  <span>{f.nombre}</span>
                </button>
              ))}
              {conjunto && (
                <button type="button" title="Mesa y sillas a medida: redonda, cuadrada, rectangular, ovalada, cóctel, media luna, serpentina o en U, con las sillas que quieras. Se cambia en su inspector." onClick={ponerConjunto} className={`${TARJETA} select-none`}>
                  <span className={MINI} aria-hidden><DibujoFondo id="mesa_con_sillas" elementos={elementosDelConjunto} /></span>
                  <span>Mesa con sillas a medida</span>
                </button>
              )}
            </div>
          </div>
        );
      })}
      {aviso && <p role="status" className="text-xs text-taller-suave">{aviso}</p>}
    </section>
  );
});
