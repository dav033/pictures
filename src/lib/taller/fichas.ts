import { createHash } from "node:crypto";
import { armarEscena, type EscenaArmada } from "@/lib/globos3d/escena";
import { claveContenido, escenaDeItem, productosDe, type ItemBiblioteca, type ProductosDeItem } from "@/lib/globos3d/biblioteca";
import { inventarioDe } from "@/lib/globos3d/partes-globos";
import type { PiezaArmada } from "@/lib/globos3d/piezas";
import { referenciaPorCodigo } from "@/lib/plan/referencia-sempertex";
import { redactarFicha } from "./ficha-texto";
import type { ClasificacionTaller, ColorRegistro, FuenteRegistro, MedidasRegistro, ProductoRegistro, RegistroTaller } from "./fichas-tipos";
import { esTubito, ordenFormato } from "./fichas-vocabulario";

export type { ClasificacionTaller, RegistroTaller } from "./fichas-tipos";
export { contarPalabras, PALABRAS_MAX_FICHA, PALABRAS_MIN_FICHA } from "./ficha-texto";

/** Súbela al cambiar la forma de la ficha: así cambian los hashes y se vuelve a embeber todo. */
export const VERSION_FICHA = 1;

export type OpcionesFicha = {
  /** Lo que decide la taxonomía de celebraciones y temáticas para este item (ids o nombres). */
  clasificacion?: ClasificacionTaller;
  /** Piezas ya armadas, para no rehacerlas entre items (las derivadas repiten las de su escena). */
  cache?: Map<string, PiezaArmada>;
};

const redondear = (n: number): number => Math.round(n);

/** La caja que ocupa lo puesto (todas sus copias), en cm. Sin nada puesto, ceros. */
function medidasDe(armada: EscenaArmada): MedidasRegistro {
  const cajas = armada.porNodo.filter((n) => n.copias > 0).map((n) => n.caja).filter((c) => [c.min.x, c.min.y, c.min.z, c.max.x, c.max.y, c.max.z].every(Number.isFinite));
  if (!cajas.length) return { altoCm: 0, anchoCm: 0, fondoCm: 0 };
  const min = (eje: "x" | "y" | "z") => Math.min(...cajas.map((c) => c.min[eje]));
  const max = (eje: "x" | "y" | "z") => Math.max(...cajas.map((c) => c.max[eje]));
  return { altoCm: redondear(max("y") - min("y")), anchoCm: redondear(max("x") - min("x")), fondoCm: redondear(max("z") - min("z")) };
}

function productosRegistro(p: ProductosDeItem): ProductoRegistro[] {
  return [
    ...p.globos.map((g): ProductoRegistro => ({ origen: "globo", nombre: g.producto.nombre, url: g.producto.url || null, cantidad: g.cantidad, generico: false })),
    ...p.tienda.map((t): ProductoRegistro => ({ origen: t.seccion === "impresos" ? "impreso" : "metalizado", nombre: t.nombre, url: t.url || null, cantidad: t.cantidad, generico: t.generico === true })),
    ...p.utileria.map((u): ProductoRegistro => ({ origen: "utileria", nombre: u.nombre, url: u.url || null, cantidad: u.cantidad, generico: u.generico })),
  ];
}

const nombreDeColor = (codigo: string): string => referenciaPorCodigo(codigo)?.nombreCompleto ?? codigo;

/** Todo lo que alimenta la ficha, en JSON canónico (el contenido ya viene con claves ordenadas y números redondeados). */
function huellaDe(item: ItemBiblioteca, clasificacion: ClasificacionTaller | null): string {
  const entrada = JSON.stringify({
    v: VERSION_FICHA, id: item.id, tipo: item.tipo, nombre: item.nombre, descripcion: item.descripcion, ocasiones: item.ocasiones, fuente: item.fuente ?? null,
    clasificacion: clasificacion && { celebraciones: [...clasificacion.celebraciones].sort(), tematicas: [...clasificacion.tematicas].sort() },
    contenido: claveContenido(item.contenido),
  });
  return createHash("sha256").update(entrada).digest("hex");
}

/**
 * El registro buscable de un item: arma su escena (la suya, el conjunto solo o la pieza sola), saca sus facetas del
 * contrato de partes (`inventarioDe`: con las copias ya contadas), sus productos de la tienda y sus medidas, y redacta la
 * ficha que se embebe. Puro y determinista: el mismo item da el mismo registro y la misma huella.
 */
export function fichaDeItem(item: ItemBiblioteca, opciones: OpcionesFicha = {}): RegistroTaller {
  const escena = escenaDeItem(item);
  const armada = armarEscena(escena, opciones.cache);
  const lineas = inventarioDe(armada);
  const clasificacion = opciones.clasificacion ?? null;

  const lineasPartes = lineas.map(({ parte, formatoId, codigo, cantidad }) => ({ parte, formatoId, codigo, cantidad }));
  const porCodigo = new Map<string, number>();
  for (const l of lineas) porCodigo.set(l.codigo, (porCodigo.get(l.codigo) ?? 0) + l.cantidad);
  const colores: ColorRegistro[] = [...porCodigo.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([codigo]) => ({ codigo, nombre: nombreDeColor(codigo) }));
  const puestos = new Set(armada.porNodo.filter((n) => n.copias > 0).map((n) => n.id));
  const fuente: FuenteRegistro | null = item.fuente ? { tipo: item.fuente.tipo, titulo: item.fuente.titulo, url: item.fuente.url ?? null, foto: item.fuente.fotoUrl ?? null } : null;

  const datos: Omit<RegistroTaller, "ficha" | "hash"> = {
    id: item.id, tipo: item.tipo, nombre: item.nombre, descripcion: item.descripcion, fuente, ocasiones: [...item.ocasiones],
    tiposPieza: [...new Set(escena.nodos.filter((n) => puestos.has(n.id)).map((n) => n.pieza.tipo))],
    formatos: [...new Set(lineas.map((l) => l.formatoId))].sort((a, b) => ordenFormato(a) - ordenFormato(b)),
    colores,
    partes: [...new Set(lineas.map((l) => l.parte))],
    lineasPartes,
    productos: productosRegistro(productosDe(item, armada, opciones.cache)),
    medidas: medidasDe(armada),
    globos: lineas.filter((l) => !esTubito(l.formatoId)).reduce((s, l) => s + l.cantidad, 0),
    tubos: lineas.filter((l) => esTubito(l.formatoId)).reduce((s, l) => s + l.cantidad, 0),
    clasificacion: clasificacion && { celebraciones: [...clasificacion.celebraciones], tematicas: [...clasificacion.tematicas] },
  };
  return { ...datos, hash: huellaDe(item, clasificacion), ficha: redactarFicha(datos) };
}
