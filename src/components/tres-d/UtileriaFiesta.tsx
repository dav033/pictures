"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { Colocacion, Escena, EscenaArmada } from "@/lib/globos3d/escena";
import type { Vec3 } from "@/lib/globos3d/modulos";
import { agregarUtileria, esMesa, productosDeFiesta, puntosBanderinEn, sobreMesa } from "@/lib/globos3d/utileria";
import { UTILERIA_LISTA, type UtileriaLista } from "@/lib/globos3d/utileria-escenas";
import { urlTienda } from "@/lib/globos3d/utileria-catalogo";
import { ACTIVO, BOTON, INACTIVO } from "./PanelFlor";

/** Miniatura de una pieza de utilería: un dibujo plano de lo que es, en sus colores. */
function MiniaturaUtileria({ u }: { u: UtileriaLista }) {
  const [a = "#f07a1a", b = "#1a1414"] = u.colores;
  const id = u.id;
  let dibujo: ReactNode;
  if (u.donde === "colgar") {
    const n = 5;
    dibujo = (
      <>
        <path d="M2,8 Q30,20 58,8" fill="none" stroke="#333" strokeWidth={1} />
        {Array.from({ length: n }, (_, i) => {
          const x = 8 + i * 11, y = 8 + 12 * (1 - ((x - 30) / 28) ** 2) * 0.85;
          const color = u.colores[i % u.colores.length] ?? a;
          return id === "guirnalda_recortes"
            ? <circle key={i} cx={x} cy={y + 6} r={4.5} fill={color} stroke="rgba(0,0,0,.25)" strokeWidth={0.4} />
            : id === "banderola_fiesta"
              ? <polygon key={i} points={`${x - 4.5},${y} ${x + 4.5},${y} ${x + 4.5},${y + 13} ${x},${y + 9} ${x - 4.5},${y + 13}`} fill={color} />
              : <polygon key={i} points={`${x - 5},${y} ${x + 5},${y} ${x},${y + 15}`} fill={color} />;
        })}
      </>
    );
  } else if (id.startsWith("plato")) {
    dibujo = id === "plato_de_pie"
      ? <><ellipse cx={30} cy={30} rx={20} ry={21} fill={a} /><ellipse cx={30} cy={30} rx={13} ry={14} fill={a} stroke="rgba(0,0,0,.2)" />{[0, 1, 2, 3, 4].map((k) => <circle key={k} cx={22 + (k % 3) * 8} cy={24 + Math.floor(k / 3) * 10} r={2} fill={b} />)}</>
      : <>{[0, 1, 2].map((k) => <ellipse key={k} cx={30} cy={40 - k * 3} rx={24} ry={8} fill={a} stroke="rgba(0,0,0,.25)" />)}{[0, 1, 2].map((k) => <circle key={k} cx={20 + k * 10} cy={34} r={1.8} fill={b} />)}</>;
  } else if (id === "vasos") {
    dibujo = <>{[0, 1].map((k) => <g key={k} transform={`translate(${14 + k * 20} 0)`}><polygon points="-6,14 6,14 9,10 0,2 -9,10" fill={b} opacity={0.85} /><polygon points="-9,18 9,18 6,48 -6,48" fill={a} /></g>)}</>;
  } else if (id === "servilletas") {
    dibujo = <>{[0, 1, 2].map((k) => <rect key={k} x={14} y={22 + k * 4} width={32} height={18} rx={1} fill={a} stroke="rgba(0,0,0,.2)" transform={`rotate(${k * 4 - 4} 30 30)`} />)}<circle cx={24} cy={30} r={2} fill={b} /><circle cx={36} cy={34} r={2} fill={b} /></>;
  } else if (id === "cubiertos") {
    dibujo = <><rect x={18} y={12} width={4} height={38} rx={2} fill={a} /><rect x={28} y={12} width={4} height={38} rx={2} fill={a} /><ellipse cx={40} cy={16} rx={4} ry={6} fill={a} /><rect x={38} y={20} width={4} height={30} rx={2} fill={a} /></>;
  } else if (id === "bandeja") {
    dibujo = <><ellipse cx={30} cy={34} rx={26} ry={12} fill={a} /><ellipse cx={30} cy={32} rx={22} ry={9} fill="rgba(255,255,255,.18)" /></>;
  } else if (id === "mantel") {
    dibujo = <><rect x={10} y={16} width={40} height={8} fill="#8a6a4a" /><polygon points="6,18 54,18 58,48 2,48" fill={a} /></>;
  } else if (id === "velas") {
    dibujo = <>{[0, 1, 2, 3].map((k) => <g key={k}><rect x={14 + k * 9} y={24} width={4} height={24} fill={a} /><ellipse cx={16 + k * 9} cy={19} rx={2.4} ry={4} fill={b} /></g>)}</>;
  } else if (id === "topper") {
    dibujo = <><rect x={29} y={30} width={2} height={24} fill="#c9b28f" /><rect x={12} y={12} width={36} height={18} rx={3} fill={a} /><rect x={17} y={19} width={26} height={4} fill={b} /></>;
  } else if (id === "calabaza_dulces") {
    dibujo = <><path d="M14,22 Q30,4 46,22" fill="none" stroke={b} strokeWidth={2} /><path d="M10,22 L50,22 L46,50 L14,50 Z" fill={a} /><polygon points="20,30 26,30 23,25" fill={b} /><polygon points="34,30 40,30 37,25" fill={b} /><path d="M20,38 Q30,46 40,38 Z" fill={b} /></>;
  } else if (id === "bolsa_dulces") {
    dibujo = <><path d="M22,22 Q30,8 38,22" fill="none" stroke={a} strokeWidth={2.5} /><rect x={12} y={22} width={36} height={30} fill={a} /><circle cx={30} cy={37} r={8} fill={b} opacity={0.85} /></>;
  } else if (id === "gorritos") {
    dibujo = <>{[0, 1, 2].map((k) => <g key={k}><polygon points={`${12 + k * 18},50 ${24 + k * 18},50 ${18 + k * 18},16`} fill={a} /><circle cx={18 + k * 18} cy={15} r={3} fill={b} /></g>)}</>;
  } else if (id === "letrero_calabaza") {
    dibujo = <><ellipse cx={30} cy={34} rx={22} ry={16} fill={a} /><rect x={28} y={12} width={4} height={8} fill="#3f7a2a" /><polygon points="20,32 26,32 23,27" fill={b} /><polygon points="34,32 40,32 37,27" fill={b} /><path d="M19,38 Q30,48 41,38 Z" fill={b} /></>;
  } else {
    dibujo = <><rect x={12} y={22} width={36} height={30} fill={a} /><rect x={10} y={18} width={40} height={7} fill={a} /><rect x={27} y={18} width={6} height={34} fill={b} /><path d="M30,18 Q20,6 22,16 Z M30,18 Q40,6 38,16 Z" fill={b} /></>;
  }
  return <svg viewBox="0 0 60 60" role="img" aria-label={`Dibujo de ${u.nombre}`} className="size-14">{dibujo}</svg>;
}

type Props = {
  escena: Escena;
  onEscena: (e: Escena) => void;
  armada: EscenaArmada;
  seleccion?: string | null;
  onSeleccion?: (id: string | null) => void;
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const medio = (a: Vec3, b: Vec3): Vec3 => ({ x: r1((a.x + b.x) / 2), y: r1((a.y + b.y) / 2), z: r1((a.z + b.z) / 2) });
const menos = (a: Vec3, b: Vec3): Vec3 => ({ x: r1(a.x - b.x), y: r1(a.y - b.y), z: r1(a.z - b.z) });

/**
 * Grupo «Utilería de fiesta» de «Decoraciones pequeñas»: banderines, platos, vasos, servilletas, cubiertos, bandeja,
 * mantel, velas, topper, cubeta y bolsa de dulces, gorritos, letrero y caja de regalo, cada una con el producto
 * Sempertex que representa. El banderín se cuelga entre dos puntos de la estructura elegida (la cara de dentro de sus
 * globos) o de pared a pared; lo de mesa va sobre la tapa de la mesa elegida; lo demás, en el piso.
 */
export function UtileriaFiesta({ escena, onEscena, armada, seleccion = null, onSeleccion }: Props) {
  const [elegida, setElegida] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const nodo = escena.nodos.find((n) => n.id === seleccion) ?? null;
  const armadoElegido = nodo ? armada.porNodo.find((n) => n.id === nodo.id) ?? null : null;
  const mesa = useMemo(() => (nodo && esMesa(escena, nodo.id, armada) ? nodo : null), [escena, nodo, armada]);
  // Una estructura de donde colgar: con globos o un fondo de escenografía de más de 1 m (no una mesa ni la utilería).
  const estructura = armadoElegido && nodo && !mesa && (armadoElegido.globos.length > 0 || (nodo.pieza.tipo === "escenografia" && !nodo.pieza.utileria && armadoElegido.caja.max.y - armadoElegido.caja.min.y > 100)) ? nodo : null;
  const productos = useMemo(() => productosDeFiesta(escena, armada), [escena, armada]);

  const poner = (u: UtileriaLista, colocacion: Colocacion, donde: string, entre?: { desde: Vec3; hasta: Vec3 }) => {
    const { escena: nueva, id } = agregarUtileria(escena, u.crear(entre), colocacion, u.nombre, `fiesta-${u.id.replace(/_/g, "-")}`);
    onEscena(nueva);
    onSeleccion?.(id);
    setAviso(`Listo: «${u.nombre}» quedó ${donde}. Va en «Productos de fiesta» de la ficha.`);
  };

  const colgarEntre = (u: UtileriaLista, desde: Vec3, hasta: Vec3, donde: string) => {
    const m = medio(desde, hasta);
    poner(u, { en: "libre", xCm: m.x, yCm: m.y, zCm: m.z, giroGrados: 0 }, donde, { desde: menos(desde, m), hasta: menos(hasta, m) });
  };

  /** La k-ésima cosa sobre una mesa se corre para no caer encima de las demás. */
  const sobreLaMesa = (u: UtileriaLista) => {
    if (!mesa) return;
    const caja = armada.porNodo.find((n) => n.id === mesa.id)?.caja;
    if (!caja) return;
    const encima = armada.porNodo.filter((n) => n.id !== mesa.id && n.solidos.length > 0 && n.caja.min.y >= caja.max.y - 12 && n.caja.min.x >= caja.min.x - 5 && n.caja.max.x <= caja.max.x + 5 && n.caja.min.z >= caja.min.z - 5 && n.caja.max.z <= caja.max.z + 5).length;
    const pasos: Array<[number, number]> = [[0, 0.15], [-0.25, 0.15], [0.25, 0.15], [-0.22, -0.18], [0.22, -0.18], [0, -0.2]];
    const [fx, fz] = pasos[encima % pasos.length]!;
    const c = sobreMesa(escena, mesa.id, (caja.max.x - caja.min.x) * fx, (caja.max.z - caja.min.z) * fz, 0, armada) ?? sobreMesa(escena, mesa.id, 0, 0, 0, armada);
    if (c) poner(u, c, `sobre «${mesa.nombre}»`);
  };

  const enElPiso = (u: UtileriaLista) => {
    const sueltas = escena.nodos.filter((n) => n.pieza.tipo === "escenografia" && n.pieza.utileria && n.colocacion.en === "piso").length;
    poner(u, { en: "piso", xCm: ((sueltas % 5) - 2) * 35, zCm: Math.round(escena.sala.fondoCm / 2 - 110), giroGrados: 0 }, "en el piso, al frente");
  };

  const abierta = UTILERIA_LISTA.find((u) => u.id === elegida) ?? null;
  return (
    <div className="flex flex-col gap-1" aria-label="Utilería de fiesta">
      <h3 className="text-xs font-semibold text-texto">Utilería de fiesta <span className="font-normal text-texto-suave">· productos Sempertex (no son globos)</span></h3>
      <div className="grid grid-cols-3 gap-1">
        {UTILERIA_LISTA.map((u) => {
          const activa = u.id === elegida;
          return (
            <button key={u.id} type="button" onClick={() => { setElegida(activa ? null : u.id); setAviso(null); }} aria-pressed={activa} aria-expanded={activa} title={u.descripcion}
              className={`flex min-h-24 flex-col items-center gap-0.5 rounded-xl p-1.5 text-center ring-1 transition-colors ${activa ? "bg-superficie-suave ring-2 ring-acento" : "bg-superficie ring-borde hover:bg-superficie-suave"}`}>
              <MiniaturaUtileria u={u} />
              <span className="text-[0.7rem] leading-tight text-texto">{u.nombre}</span>
              <span className="text-[0.65rem] text-texto-suave">{u.donde === "colgar" ? "se cuelga" : u.donde === "mesa" ? "de mesa" : "de piso"}</span>
            </button>
          );
        })}
      </div>
      {abierta && (
        <div className="flex flex-col gap-2 rounded-xl bg-superficie-suave p-2 ring-1 ring-acento/60" aria-label={`Dónde poner ${abierta.nombre}`}>
          <p className="text-xs text-texto"><b>{abierta.nombre}</b>. <span className="text-texto-suave">{abierta.descripcion}</span></p>
          {abierta.donde === "colgar" ? (
            <>
              {estructura && armadoElegido ? (
                <button type="button" className={`${BOTON} ${ACTIVO}`} onClick={() => { const p = puntosBanderinEn(armadoElegido); colgarEntre(abierta, p.desde, p.hasta, `colgado entre dos puntos de «${estructura.nombre}»`); }}>
                  Colgar entre dos puntos de «{estructura.nombre}»
                </button>
              ) : <p className="text-[0.7rem] text-texto-suave">Para colgarlo de un arco, un marco o dos columnas, primero toca esa pieza en la lista de arriba.</p>}
              <button type="button" className={`${BOTON} ${INACTIVO} text-xs`} onClick={() => {
                const y = Math.min(escena.sala.altoCm - 60, 240), z = -escena.sala.fondoCm / 2 + 40;
                colgarEntre(abierta, { x: -escena.sala.anchoCm / 2, y, z }, { x: escena.sala.anchoCm / 2, y, z }, "colgado de pared a pared");
              }}>De pared a pared</button>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-1">
              {mesa
                ? <button type="button" className={`${BOTON} ${ACTIVO} text-xs`} onClick={() => sobreLaMesa(abierta)}>Sobre «{mesa.nombre}»</button>
                : abierta.donde === "mesa" && <p className="col-span-2 text-[0.7rem] text-texto-suave">Para ponerlo sobre una mesa, primero toca la mesa en la lista de arriba.</p>}
              <button type="button" className={`${BOTON} ${INACTIVO} text-xs`} onClick={() => enElPiso(abierta)}>En el piso</button>
            </div>
          )}
          {aviso && <p role="status" className="rounded-lg bg-superficie p-2 text-xs text-texto ring-1 ring-borde">{aviso}</p>}
        </div>
      )}
      {productos.length > 0 && <p className="text-[0.7rem] text-texto-suave">En esta escena: {productos.reduce((s, p) => s + p.cantidad, 0)} productos de fiesta (lista en la ficha).</p>}
    </div>
  );
}

/** La sección «Productos de fiesta» de la ficha: cantidad × nombre exacto (con su color) y enlace a la tienda. */
export function ProductosFiesta({ escena, armada }: { escena: Escena; armada: EscenaArmada }) {
  const productos = useMemo(() => productosDeFiesta(escena, armada), [escena, armada]);
  if (!productos.length) return null;
  return (
    <div className="detalle-ficha mt-2" aria-label="Productos de fiesta">
      <p className="text-xs font-semibold text-texto">Productos de fiesta</p>
      <ul className={`mt-1 text-xs text-texto ${productos.length > 6 ? "gap-x-4 sm:columns-2" : ""}`}>
        {productos.map((p) => (
          <li key={`${p.url}|${p.nombre}|${p.variante ?? ""}`} className="break-inside-avoid" title={`En: ${p.piezas.join(", ")}`}>
            {p.cantidad} × {p.generico
              ? <span className="text-texto-suave">{p.nombre}</span>
              : <a href={urlTienda(p.url)} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-acento">{p.nombre}</a>}
            {p.variante && <span className="text-texto-suave"> · {p.variante}</span>}
            {!p.generico && <span className="font-mono text-[0.65rem] text-texto-suave"> {p.url}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
