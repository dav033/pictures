import { useEffect, useSyncExternalStore } from "react";
import { BIBLIOTECA_FABRICA, type ItemBiblioteca } from "@/lib/globos3d/biblioteca";
import { crearMotor, type AvisoMotor, type HechoItem, type PedidoMotor } from "./biblioteca-motor";

/**
 * El lado de la página del motor de la Biblioteca (`biblioteca-motor.ts`): crea el Web Worker la primera vez que se
 * abre la pestaña, junta lo que manda (firmas, huellas, resúmenes e índices) en un estado que sobrevive al cambiar de
 * pestaña, y atiende los pedidos de armar (ficha y miniaturas). Si el Worker no se puede crear o falla al cargar, el
 * mismo motor corre en la página, de a un item por vuelta.
 */

export type EstadoMotor = {
  /** Por id (de base o derivado): firma de su clave, huella de su contenido y resumen. */
  hechos: ReadonlyMap<string, HechoItem>;
  /** Derivados de cada escena ya indexada. */
  indices: ReadonlyMap<string, readonly ItemBiblioteca[]>;
  hechas: number;
  total: number;
  escenasHechas: number;
  escenas: number;
};

export type Armado = Extract<AvisoMotor, { tipo: "armado" }>;

const FABRICA = new Set(BIBLIOTECA_FABRICA.map((i) => i.id));
const esPropio = (id: string) => id.startsWith("propio:");

let estado: EstadoMotor = { hechos: new Map(), indices: new Map(), hechas: 0, total: BIBLIOTECA_FABRICA.length, escenasHechas: 0, escenas: 0 };
const oyentes = new Set<() => void>();
let enviar: ((p: PedidoMotor) => void) | null = null;
let ultimoEmpezar: PedidoMotor | null = null;
let ultimosPropios: readonly ItemBiblioteca[] | null = null;
let siguiente = 1;
const esperando = new Map<number, { pedido: PedidoMotor; listo: (r: Armado) => void }>();

function avisar(): void {
  for (const o of oyentes) o();
}

function recibir(aviso: AvisoMotor): void {
  if (aviso.tipo === "armado") {
    const e = esperando.get(aviso.pedido);
    esperando.delete(aviso.pedido);
    e?.listo(aviso);
    return;
  }
  let hechos = estado.hechos;
  if (aviso.hechos.length) { const m = new Map(hechos); for (const [id, h] of aviso.hechos) m.set(id, h); hechos = m; }
  let indices = estado.indices;
  if (aviso.indices.length) { const m = new Map(indices); for (const [id, d] of aviso.indices) m.set(id, d); indices = m; }
  estado = { hechos, indices, hechas: aviso.hechas, total: aviso.total, escenasHechas: aviso.escenasHechas, escenas: aviso.escenas };
  avisar();
}

/** El motor en la página (si no hay Worker): cede 16 ms entre item e item para que la página respire. */
function enLaPagina(): void {
  const motor = crearMotor(recibir, (paso) => { setTimeout(paso, 16); });
  enviar = (p) => motor.recibir(p);
  if (ultimoEmpezar) motor.recibir(ultimoEmpezar);
  for (const { pedido } of esperando.values()) motor.recibir(pedido);
}

function conectar(): (p: PedidoMotor) => void {
  if (enviar) return enviar;
  try {
    const trabajador = new Worker(new URL("./biblioteca.worker.ts", import.meta.url), { type: "module" });
    trabajador.addEventListener("message", (e: MessageEvent<AvisoMotor>) => recibir(e.data));
    trabajador.addEventListener("error", (e) => {
      console.error("[biblioteca] el Worker falló; el motor sigue en la página", e.message);
      trabajador.terminate();
      enLaPagina();
    });
    enviar = (p) => trabajador.postMessage(p);
  } catch (causa) {
    console.error("[biblioteca] sin Worker; el motor corre en la página", causa);
    enLaPagina();
  }
  return enviar!;
}

/** (Re)arranca el recorrido con lo propio: lo propio anterior se olvida (pudo cambiar con el mismo id). */
function empezar(propios: readonly ItemBiblioteca[]): void {
  // Varias partes del taller usan el motor a la vez (Añadir, Plantillas, la ficha): con lo mismo propio no se reinicia.
  if (ultimosPropios === propios) return;
  ultimosPropios = propios;
  const hechos = new Map([...estado.hechos].filter(([id]) => !esPropio(id)));
  const indices = new Map([...estado.indices].filter(([id]) => !esPropio(id)));
  estado = { ...estado, hechos, indices };
  avisar();
  ultimoEmpezar = { tipo: "empezar", propios: [...propios] };
  conectar()(ultimoEmpezar);
}

const suscribir = (oyente: () => void) => { oyentes.add(oyente); return () => { oyentes.delete(oyente); }; };
const leer = () => estado;

/** El estado del motor (se rehace cada ~200 ms mientras recorre); arranca el recorrido con lo propio del usuario. */
export function useMotorBiblioteca(propios: readonly ItemBiblioteca[]): EstadoMotor {
  const e = useSyncExternalStore(suscribir, leer, leer);
  useEffect(() => { empezar(propios); }, [propios]);
  return e;
}

/**
 * Arma un item en el motor: su vista (`armada`) y, con `ficha`, su contenido, productos y resumen. Lo de fábrica va por
 * id (su contenido es perezoso y se arma allá); lo demás viaja entero (es dato plano).
 */
export function armarEnMotor(item: ItemBiblioteca, ficha: boolean): Promise<Armado> {
  const numero = siguiente++;
  const pedido: PedidoMotor = { tipo: "armar", pedido: numero, id: item.id, ficha, ...(FABRICA.has(item.id) ? {} : { item }) };
  return new Promise<Armado>((listo) => {
    esperando.set(numero, { pedido, listo });
    conectar()(pedido);
  });
}
