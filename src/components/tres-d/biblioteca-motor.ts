import {
  BIBLIOTECA_FABRICA, claveContenido, escenaDeItem, firmaDeClave, huellaDeClave, indexarEscena, productosDe, resumenDe,
  type ContenidoItem, type ItemBiblioteca, type ProductosDeItem, type ResumenItem,
} from "@/lib/globos3d/biblioteca";
import { armarEscena, type EscenaArmada } from "@/lib/globos3d/escena";
import type { PiezaArmada } from "@/lib/globos3d/piezas";

/**
 * **El motor de la pestaña Biblioteca**: todo lo que arma escenas (claves para no repetir, índice de cada escena,
 * resúmenes de globos y colores, la vista 3D y los productos de una ficha) fuera del hilo de la página. Corre en un Web
 * Worker (`biblioteca.worker.ts`); si el navegador no deja crearlo, la página lo corre ella misma de a un item por
 * vuelta. Armar una idea puede tardar segundos (el empaque orgánico de la #471 tarda ~7 s): en el Worker no traba nada.
 *
 * Recorre lo de fábrica y lo propio EN ORDEN (así `unirBiblioteca` llega al mismo resultado que si lo armara todo de
 * una) y manda lo hecho cada ~200 ms. Lo que se pide (la vista de una ficha, una miniatura) pasa delante del recorrido.
 * De cada item manda la firma de su clave (no la clave entera, que en una escena pesa cientos de kB) y la huella de su
 * contenido (para guardar su miniatura como antes).
 */

/** Lo que la página pide al motor. */
export type PedidoMotor =
  /** (Re)arranca el recorrido con lo propio del usuario (lo de fábrica ya hecho no se repite). */
  | { tipo: "empezar"; propios: ItemBiblioteca[] }
  /**
   * Arma un item: el de fábrica por su `id` (su contenido es perezoso y no viaja); lo demás (propio, derivado, la vista
   * de una pieza de la pestaña Escena) viaja en `item`. Con `ficha`, también su contenido, productos y resumen.
   */
  | { tipo: "armar"; pedido: number; id: string; item?: ItemBiblioteca; ficha: boolean };

/** De un item ya pasado por el motor: con qué se compara (`firma`), su huella de contenido y su resumen. */
export type HechoItem = { firma: string; huella: string; resumen: ResumenItem };

/** Lo que el motor manda a la página. */
export type AvisoMotor =
  | {
    tipo: "avance";
    /** Por id: base (fábrica y propios) y derivados. */
    hechos: Array<[string, HechoItem]>;
    /** Los derivados de cada escena indexada (id de la escena → items), ya con sus `hechos`. */
    indices: Array<[string, ItemBiblioteca[]]>;
    /** Cuántos items de base van y cuántos hay; cuántas escenas van indexadas y cuántas hay. */
    hechas: number; total: number; escenasHechas: number; escenas: number;
  }
  | { tipo: "armado"; pedido: number; armada: EscenaArmada; contenido?: ContenidoItem; productos?: ProductosDeItem; resumen?: ResumenItem }
  | { tipo: "armado"; pedido: number; error: string };

export type Motor = { recibir: (pedido: PedidoMotor) => void };

const RESUMEN_VACIO: ResumenItem = { globos: 0, colores: [], productos: [], piezas: 0 };
/** Cada cuánto se manda lo hecho (ms): más seguido rehace la grilla de la página sin necesidad. */
const CADA_MS = 200;
/** Piezas armadas en memoria como mucho (cada escena trae las suyas; sin tope, la memoria del Worker crece sin fin). */
const TOPE_CACHE = 800;

/**
 * Crea el motor. `enviar` recibe lo que va a la página; `ceder` programa el paso siguiente (por defecto `setTimeout`
 * 0: entre paso y paso entran los pedidos).
 */
export function crearMotor(enviar: (aviso: AvisoMotor) => void, ceder: (paso: () => void) => void = (paso) => { setTimeout(paso, 0); }): Motor {
  const cache = new Map<string, PiezaArmada>();
  /** Lo de base y lo derivado, por id (para atender pedidos por id). */
  const porId = new Map<string, ItemBiblioteca>(BIBLIOTECA_FABRICA.map((i) => [i.id, i]));
  const fabrica = new Set(BIBLIOTECA_FABRICA.map((i) => i.id));
  let base: readonly ItemBiblioteca[] = BIBLIOTECA_FABRICA;
  /** Ids de base ya recorridos (lo de fábrica se conserva entre arranques: no cambia). */
  const recorridos = new Set<string>();
  let cursor = 0;
  let empezado = false;
  const cola: Array<Extract<PedidoMotor, { tipo: "armar" }>> = [];
  let programado = false;
  let ultimoEnvio = 0;
  let hechos: Array<[string, HechoItem]> = [];
  let indices: Array<[string, ItemBiblioteca[]]> = [];
  let escenasHechas = 0;

  const armar = (item: ItemBiblioteca): EscenaArmada => {
    if (cache.size > TOPE_CACHE) cache.clear();
    return armarEscena(escenaDeItem(item), cache);
  };

  /** Firma, huella y resumen de un item (si no se puede armar, resumen vacío: como antes en la página). */
  const hechoDe = (item: ItemBiblioteca, armada?: EscenaArmada): HechoItem => {
    let clave: string;
    try { clave = claveContenido(item.contenido); } catch { clave = `sin-contenido:${item.id}`; }
    let resumen = RESUMEN_VACIO;
    try { resumen = resumenDe(item, armada ?? armar(item)); } catch { /* resumen vacío */ }
    return { firma: firmaDeClave(clave), huella: huellaDeClave(clave), resumen };
  };

  const totalEscenas = () => base.filter((i) => i.tipo === "escena").length;

  function mandar(): void {
    ultimoEnvio = performance.now();
    enviar({ tipo: "avance", hechos, indices, hechas: base.filter((i) => recorridos.has(i.id)).length, total: base.length, escenasHechas, escenas: totalEscenas() });
    hechos = [];
    indices = [];
  }

  /** Un item de base: su firma y resumen; si es escena, además su índice (cada derivado con lo suyo). */
  function recorrer(item: ItemBiblioteca): void {
    recorridos.add(item.id);
    if (item.tipo !== "escena") { hechos.push([item.id, hechoDe(item)]); return; }
    let armada: EscenaArmada | undefined;
    try { armada = armar(item); } catch (causa) { console.error("[biblioteca] no se pudo armar", item.id, causa); }
    hechos.push([item.id, hechoDe(item, armada)]);
    let derivados: ItemBiblioteca[] = [];
    try { derivados = indexarEscena(item, armada, cache); } catch (causa) { console.error("[biblioteca] no se pudo indexar", item.id, causa); }
    for (const d of derivados) { porId.set(d.id, d); hechos.push([d.id, hechoDe(d)]); }
    indices.push([item.id, derivados]);
    escenasHechas += 1;
  }

  function atender(p: Extract<PedidoMotor, { tipo: "armar" }>): void {
    const item = p.item ?? porId.get(p.id);
    if (!item) { enviar({ tipo: "armado", pedido: p.pedido, error: `No está en la biblioteca: ${p.id}` }); return; }
    try {
      const armada = armar(item);
      if (!p.ficha) { enviar({ tipo: "armado", pedido: p.pedido, armada }); return; }
      enviar({ tipo: "armado", pedido: p.pedido, armada, contenido: item.contenido, productos: productosDe(item, armada), resumen: resumenDe(item, armada) });
    } catch (causa) {
      enviar({ tipo: "armado", pedido: p.pedido, error: causa instanceof Error ? causa.message : String(causa) });
    }
  }

  function paso(): void {
    programado = false;
    const pedido = cola.shift();
    if (pedido) atender(pedido);
    // Sin «empezar» (nadie abrió la biblioteca) solo se atienden los pedidos de armar (la lista de compra, una ficha).
    else if (!empezado) return;
    else {
      while (cursor < base.length && recorridos.has(base[cursor]!.id)) cursor++;
      const item = base[cursor];
      if (!item) { if (hechos.length || indices.length) mandar(); return; }
      cursor++;
      recorrer(item);
      if (performance.now() - ultimoEnvio > CADA_MS || cursor >= base.length) mandar();
    }
    programar();
  }

  function programar(): void {
    if (programado || (!empezado && cola.length === 0)) return;
    programado = true;
    ceder(paso);
  }

  return {
    recibir(p) {
      if (p.tipo === "armar") { cola.push(p); programar(); return; }
      // Lo propio cambió: se olvida lo propio anterior (y sus derivados) y se recorre de nuevo lo que falte.
      for (const id of [...recorridos]) if (!fabrica.has(id)) recorridos.delete(id);
      for (const id of [...porId.keys()]) if (!fabrica.has(id.split("~")[0] ?? "")) porId.delete(id);
      for (const i of p.propios) porId.set(i.id, i);
      base = [...BIBLIOTECA_FABRICA, ...p.propios];
      escenasHechas = base.filter((i) => i.tipo === "escena" && recorridos.has(i.id)).length;
      cursor = 0;
      empezado = true;
      mandar();
      programar();
    },
  };
}
