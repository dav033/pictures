import { esMismaFamiliaQueAlguno, ordenarConDiversidad } from "../retrieval/diversidad";
import type { CandidatoPuntuado } from "../retrieval/rerank";
import type { RolPresupuesto } from "./franjas";
import type { PlanCanasta } from "./plan";

export type PiezaCanasta = {
  rol: RolPresupuesto;
  productId: string;
  variantId: string;
  titulo: string;
  categoria: string | null;
  imagen: string | null;
  precio: number;
  cantidad: number;
  subtotal: number;
  porque: string[];
};

export type Canasta = {
  piezas: PiezaCanasta[];
  total: number;
  techoCop: number;
  utilizacion: number;
  cumplePresupuesto: boolean;
  holgura: number;
  /** Cuota mínima de algún rol que no se pudo llenar con el pool disponible
   * — no se fuerza a inventar, se reporta (§3, Etapa 4). */
  rolesIncompletos: RolPresupuesto[];
};

/** Roles que se recortan primero cuando la canasta se pasa del techo — el
 * protagonista (`focal`) es el último en perder piezas. */
const ORDEN_RECORTE: RolPresupuesto[] = ["servicio", "acento", "soporte", "relleno", "focal"];
const ITERACIONES_MAX_REPARACION = 8;

function aPieza(rol: RolPresupuesto, c: CandidatoPuntuado): PiezaCanasta {
  return {
    rol,
    productId: c.productId,
    variantId: c.variantId,
    titulo: c.titulo,
    categoria: c.categoria,
    imagen: c.imagen,
    precio: c.precio,
    cantidad: 1,
    subtotal: c.precio,
    porque: c.porque,
  };
}

/**
 * Ensamblaje determinista de la canasta (§3, Etapa 4): greedy por densidad
 * score/precio respetando cuotas de rol, con reparación acotada para caer
 * dentro de la banda de utilización objetivo. Nunca corre un LLM — el total
 * es una suma en código, igual que `cotizarProductos` (motor.ts).
 */
export function ensamblarCanasta(
  plan: PlanCanasta,
  poolsPorRol: Record<RolPresupuesto, CandidatoPuntuado[]>,
): Canasta {
  const poolsOrdenados = new Map<RolPresupuesto, CandidatoPuntuado[]>();
  for (const cuota of plan.roles) poolsOrdenados.set(cuota.rol, ordenarConDiversidad(poolsPorRol[cuota.rol] ?? []));

  const elegidas: PiezaCanasta[] = [];
  const punteros = new Map<RolPresupuesto, number>(); // siguiente índice sin usar en el pool de ese rol
  const rolesIncompletos: RolPresupuesto[] = [];

  const titulosElegidos = () => elegidas.map((p) => p.titulo);

  function siguienteCandidato(rol: RolPresupuesto): CandidatoPuntuado | null {
    const pool = poolsOrdenados.get(rol) ?? [];
    let i = punteros.get(rol) ?? 0;
    while (i < pool.length) {
      if (!esMismaFamiliaQueAlguno(pool[i].titulo, titulosElegidos())) {
        punteros.set(rol, i + 1);
        return pool[i];
      }
      i++;
    }
    punteros.set(rol, i);
    return null;
  }

  // 1) Semilla: satisfacer el mínimo de cada rol.
  for (const cuota of plan.roles) {
    let tomadas = 0;
    while (tomadas < cuota.min) {
      const candidato = siguienteCandidato(cuota.rol);
      if (!candidato) break;
      elegidas.push(aPieza(cuota.rol, candidato));
      tomadas++;
    }
    if (tomadas < cuota.min) rolesIncompletos.push(cuota.rol);
  }

  const totalActual = () => elegidas.reduce((s, p) => s + p.subtotal, 0);
  const cuentaPorRol = (rol: RolPresupuesto) => elegidas.filter((p) => p.rol === rol).length;

  // 2) Llenado: mientras haya presupuesto y roles con cupo, agrega el
  // candidato de mayor densidad score/precio entre TODOS los roles con cupo.
  for (let vueltas = 0; vueltas < plan.piezasMax + plan.roles.length; vueltas++) {
    if (elegidas.length >= plan.piezasMax) break;

    let mejorRol: RolPresupuesto | null = null;
    let mejorCandidato: CandidatoPuntuado | null = null;
    let mejorDensidad = -Infinity;

    for (const cuota of plan.roles) {
      if (cuentaPorRol(cuota.rol) >= cuota.max) continue;
      const pool = poolsOrdenados.get(cuota.rol) ?? [];
      const idx = punteros.get(cuota.rol) ?? 0;
      // Sólo mira el siguiente candidato no usado de este rol (ya viene
      // ordenado por score+diversidad) — no relee todo el pool cada vuelta.
      for (let i = idx; i < pool.length; i++) {
        if (esMismaFamiliaQueAlguno(pool[i].titulo, titulosElegidos())) continue;
        const densidad = pool[i].score / Math.max(pool[i].precio, 1);
        if (densidad > mejorDensidad && totalActual() + pool[i].precio <= plan.utilizacionMaxCop) {
          mejorDensidad = densidad;
          mejorRol = cuota.rol;
          mejorCandidato = pool[i];
        }
        break; // sólo el primero elegible de este rol en esta vuelta
      }
    }

    if (!mejorRol || !mejorCandidato) break;
    elegidas.push(aPieza(mejorRol, mejorCandidato));
    punteros.set(mejorRol, (punteros.get(mejorRol) ?? 0) + 1);
  }

  // 3) Reparación: por encima del techo, recorta empezando por los roles
  // menos esenciales; por debajo de la utilización mínima, intenta subir de
  // variante en algún rol con cupo.
  for (let i = 0; i < ITERACIONES_MAX_REPARACION && totalActual() > plan.techoCop; i++) {
    let recortado = false;
    for (const rol of ORDEN_RECORTE) {
      const cuota = plan.roles.find((r) => r.rol === rol);
      if (!cuota) continue;
      const piezasDelRol = elegidas.filter((p) => p.rol === rol);
      if (piezasDelRol.length <= cuota.min) continue;
      // Quita la más cara de ese rol (la que menos ayuda a la utilización
      // mínima y más rápido resuelve el exceso).
      const masCara = piezasDelRol.reduce((a, b) => (b.precio > a.precio ? b : a));
      const idx = elegidas.indexOf(masCara);
      elegidas.splice(idx, 1);
      recortado = true;
      break;
    }
    if (!recortado) break; // no se puede bajar más sin romper mínimos — se reporta como excede
  }

  for (
    let i = 0;
    i < ITERACIONES_MAX_REPARACION && totalActual() < plan.utilizacionMinCop && elegidas.length < plan.piezasMax;
    i++
  ) {
    let agregado = false;
    for (const cuota of plan.roles) {
      if (cuentaPorRol(cuota.rol) >= cuota.max) continue;
      const candidato = siguienteCandidato(cuota.rol);
      if (!candidato) continue;
      if (totalActual() + candidato.precio > plan.techoCop) continue;
      elegidas.push(aPieza(cuota.rol, candidato));
      agregado = true;
      break;
    }
    if (!agregado) break; // no hay más inventario que quepa — utilización queda honesta, no se fuerza
  }

  // 4) Si ya se llegó a `piezasMax` (o no hay más piezas que sumar) y la
  // utilización sigue por debajo del objetivo, sube de variante dentro del
  // mismo rol en vez de agregar más piezas — cambia UNA pieza elegida por
  // otra más cara del mismo pool que quepa en el techo de la franja.
  for (let i = 0; i < ITERACIONES_MAX_REPARACION && totalActual() < plan.utilizacionMinCop; i++) {
    let mejorMejora = 0;
    let mejorIdx = -1;
    let mejorReemplazo: CandidatoPuntuado | null = null;

    for (let idx = 0; idx < elegidas.length; idx++) {
      const pieza = elegidas[idx];
      const pool = poolsOrdenados.get(pieza.rol) ?? [];
      const otrosTitulos = elegidas.filter((_, i) => i !== idx).map((p) => p.titulo);
      for (const candidato of pool) {
        if (candidato.variantId === pieza.variantId || candidato.precio <= pieza.precio) continue;
        if (esMismaFamiliaQueAlguno(candidato.titulo, otrosTitulos)) continue;
        const nuevoTotal = totalActual() - pieza.precio + candidato.precio;
        if (nuevoTotal > plan.techoCop) continue;
        const mejora = candidato.precio - pieza.precio;
        if (mejora > mejorMejora) {
          mejorMejora = mejora;
          mejorIdx = idx;
          mejorReemplazo = candidato;
        }
      }
    }

    if (mejorIdx === -1 || !mejorReemplazo) break; // no hay upgrade que quepa — utilización queda honesta
    elegidas[mejorIdx] = aPieza(elegidas[mejorIdx].rol, mejorReemplazo);
  }

  const total = totalActual();
  return {
    piezas: elegidas,
    total,
    techoCop: plan.techoCop,
    utilizacion: plan.techoCop > 0 ? total / plan.techoCop : 0,
    cumplePresupuesto: total <= plan.techoCop,
    holgura: plan.techoCop - total,
    rolesIncompletos,
  };
}
