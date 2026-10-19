import type { Vec3 } from "./modulos";
import { armarPieza, type Pieza, type PiezaArmada } from "./piezas";
import { idNuevo, type Colocacion, type Escena, type NodoEscena } from "./escena";
import type { Miniatura } from "./decoraciones-escena";
import { miniaturaPieza } from "./ideas-formas";
import { MURALES_PREDEFINIDOS } from "./murales";
import { TECHOS_PREDEFINIDOS } from "./techo";
import { ARBOLES_PREDEFINIDOS } from "./arboles-globos";

/**
 * Los murales pixelados, las decoraciones de techo y las palmeras y árboles listos para la sección «Decoraciones
 * pequeñas» (grupos «Murales», «Techo» y «Árboles y palmeras»): cada uno con su pieza, su miniatura (de frente; la red
 * de techo, vista desde abajo) y cómo se pone en la sala (el mural en la pared del fondo, apoyado en el piso; lo de techo
 * pegado al techo; el árbol de pie en el piso).
 */
export type GrupoMuralTechoArbol = "murales" | "techo" | "arboles";

export const GRUPOS_MURAL_TECHO_ARBOL: ReadonlyArray<{ id: GrupoMuralTechoArbol; nombre: string }> = [
  { id: "murales", nombre: "Murales" },
  { id: "techo", nombre: "Techo" },
  { id: "arboles", nombre: "Árboles y palmeras" },
];

export type PiezaMuralTechoArbol = { id: string; nombre: string; descripcion: string; grupo: GrupoMuralTechoArbol; pieza: Pieza };

export function piezasMuralTechoArbol(): PiezaMuralTechoArbol[] {
  return [
    ...MURALES_PREDEFINIDOS.map((m) => ({ id: m.id, nombre: m.nombre, descripcion: m.descripcion, grupo: "murales" as const, pieza: { tipo: "mural" as const, mural: m.mural } })),
    ...TECHOS_PREDEFINIDOS.map((t) => ({ id: t.id, nombre: t.nombre, descripcion: t.descripcion, grupo: "techo" as const, pieza: { tipo: "techo" as const, techo: t.techo } })),
    ...ARBOLES_PREDEFINIDOS.map((a) => ({ id: a.id, nombre: a.nombre, descripcion: a.descripcion, grupo: "arboles" as const, pieza: { tipo: "arbol_globos" as const, arbol: a.arbol } })),
  ];
}

/** Vista desde abajo (el piso de la pieza mira a quien la ve): para la red de techo, que de frente es una raya. */
function desdeAbajo(armada: PiezaArmada): PiezaArmada {
  const g = (p: Vec3): Vec3 => ({ x: p.x, y: p.z, z: -p.y });
  const globos = armada.globos.map((x) => ({ ...x, nudo: g(x.nudo), direccion: g(x.direccion) }));
  const tubos = armada.tubos.map((t) => ({ ...t, puntos: t.puntos.map(g) }));
  const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const x of globos) {
    const r = x.infladoCm / 2;
    const c = { x: x.nudo.x + x.direccion.x * r, y: x.nudo.y + x.direccion.y * r, z: x.nudo.z + x.direccion.z * r };
    min.x = Math.min(min.x, c.x - r); min.y = Math.min(min.y, c.y - r); min.z = Math.min(min.z, c.z - r);
    max.x = Math.max(max.x, c.x + r); max.y = Math.max(max.y, c.y + r); max.z = Math.max(max.z, c.z + r);
  }
  return { ...armada, globos, tubos, solidos: [], caja: Number.isFinite(min.x) ? { min, max } : armada.caja };
}

/** El dibujo de la pieza: de frente, salvo lo de techo que es solo red (desde abajo). */
export function miniaturaMuralTechoArbol(p: PiezaMuralTechoArbol, armada: PiezaArmada = armarPieza(p.pieza)): Miniatura {
  const soloRed = p.pieza.tipo === "techo" && p.pieza.techo.elementos.every((e) => e.tipo === "red" || e.tipo === "helio");
  return miniaturaPieza(soloRed ? desdeAbajo(armada) : armada);
}

/** Todas, armadas, con su dibujo y cuántos globos llevan (los tubitos cuentan por tubito). */
export function muralesTechoArbolesConMiniatura(): Array<PiezaMuralTechoArbol & { miniatura: Miniatura; globos: number }> {
  return piezasMuralTechoArbol().map((p) => {
    const armada = armarPieza(p.pieza);
    return { ...p, miniatura: miniaturaMuralTechoArbol(p, armada), globos: armada.materiales.reduce((s, m) => s + m.cantidad, 0) };
  });
}

/** Dónde va cada grupo en la sala, corrida a un lado si ya hay otras del mismo grupo ahí. */
export function colocacionDe(escena: Escena, grupo: GrupoMuralTechoArbol): Colocacion {
  const tipo = grupo === "murales" ? "mural" : grupo === "techo" ? "techo" : "arbol_globos";
  const ya = escena.nodos.filter((n) => n.pieza.tipo === tipo).length;
  const desfase = ya === 0 ? 0 : (ya % 2 === 1 ? 1 : -1) * Math.ceil(ya / 2) * 120;
  const dentro = (x: number, medio: number) => Math.max(-medio + 60, Math.min(medio - 60, x));
  if (grupo === "murales") return { en: "pared", pared: "fondo", aLoLargoCm: dentro(desfase, escena.sala.anchoCm / 2), alturaCm: 0 };
  if (grupo === "techo") return { en: "techo", xCm: dentro(desfase, escena.sala.anchoCm / 2), zCm: 0, cuelgaCm: 0, giroGrados: 0, volteada: false };
  return { en: "piso", xCm: dentro(desfase, escena.sala.anchoCm / 2), zCm: Math.round(escena.sala.fondoCm * 0.15), giroGrados: 0 };
}

/** Mete la pieza en la escena (la de entrada no cambia) donde va su grupo. */
export function agregarMuralTechoArbol(escena: Escena, p: PiezaMuralTechoArbol): { escena: Escena; id: string } {
  const id = idNuevo(escena, p.id.replace(/_/g, "-"));
  const nodo: NodoEscena = { id, nombre: p.nombre, pieza: structuredClone(p.pieza), colocacion: colocacionDe(escena, p.grupo) };
  return { escena: { ...escena, nodos: [...escena.nodos, nodo] }, id };
}
