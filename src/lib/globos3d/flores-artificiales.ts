import type { Vec3 } from "./modulos";
import { crearAzar, type AnclaHueco } from "./organico";

/**
 * Flores artificiales (de tela) metidas en los huecos de una estructura orgánica: son **datos, no globos**. Van
 * en racimos sobre las anclas de hueco que deja `armarOrganico` y salen en los materiales aparte, como follaje,
 * porque no se cotizan como globo.
 *
 * Tamaños de las flores de tela de decoración más comunes: la cabeza de hortensia mide 15–18 cm, la rosa abierta
 * 6–8 cm y la ramita de gypsophila (nube) unos 10 cm de mata. Unidades: cm.
 */
export type TipoFlorArtificial = "hortensia" | "rosa" | "gypsophila";

export type ColorFlor = { id: string; nombre: string; hex: string };

export type FlorArtificial = { tipo: TipoFlorArtificial; nombre: string; diametroCm: number; colores: readonly ColorFlor[]; descripcion: string };

export const FLORES_ARTIFICIALES: Readonly<Record<TipoFlorArtificial, FlorArtificial>> = {
  hortensia: {
    tipo: "hortensia", nombre: "Hortensia", diametroCm: 16,
    colores: [
      { id: "azul", nombre: "azul", hex: "#7f97cf" },
      { id: "blanca", nombre: "blanca", hex: "#eef0ec" },
      { id: "celeste", nombre: "celeste", hex: "#a9c3e6" },
    ],
    descripcion: "Cabeza grande de florecitas: tapa el hueco que deja un R-12 y es la flor protagonista del racimo.",
  },
  rosa: {
    tipo: "rosa", nombre: "Rosa", diametroCm: 7,
    colores: [
      { id: "blanca", nombre: "blanca", hex: "#f6f2ea" },
      { id: "marfil", nombre: "marfil", hex: "#efe6d2" },
    ],
    descripcion: "Rosa abierta de tela: acompaña a la hortensia, una o dos por racimo.",
  },
  gypsophila: {
    tipo: "gypsophila", nombre: "Gypsophila (nube)", diametroCm: 10,
    colores: [{ id: "blanca", nombre: "blanca", hex: "#fbfbf8" }],
    descripcion: "Ramita de florecitas blancas que asoma entre los globos y suaviza los bordes.",
  },
};

export type ProporcionFlor = { tipo: TipoFlorArtificial; colorId: string; peso: number };

export type OpcionesFlores = {
  semilla: number;
  proporcion: readonly ProporcionFlor[];
  /** Tallos (flores sueltas) por racimo. */
  tallosPorRacimo: number;
};

export type FlorColocada = { tipo: TipoFlorArtificial; colorId: string; hex: string; diametroCm: number; posicion: Vec3; normal: Vec3 };

export type RacimoFloral = { ancla: number; posicion: Vec3; normal: Vec3; flores: FlorColocada[] };

export type MaterialFollaje = {
  tipo: TipoFlorArtificial;
  colorId: string;
  nombre: string;
  cantidad: number;
  categoria: "follaje";
  cotizaComoGlobo: false;
  nota: string;
};

export type FloresRepartidas = { racimos: RacimoFloral[]; materiales: MaterialFollaje[]; avisos: string[] };

const unitario = (v: Vec3): Vec3 => {
  const n = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / n, y: v.y / n, z: v.z / n };
};

/**
 * Reparte tallos en las anclas: el total (anclas × tallos por racimo) se divide por cuotas según la proporción,
 * se baraja con la semilla y se reparte de mayor a menor flor en ronda, para que cada racimo lleve una flor grande
 * en el centro y las pequeñas alrededor (como la hortensia con rosas y gypsophila de la foto de referencia).
 */
export function repartirFlores(anclas: readonly AnclaHueco[], opciones: OpcionesFlores): FloresRepartidas {
  const azar = crearAzar(opciones.semilla);
  const avisos: string[] = [];
  const validas = opciones.proporcion.filter((p) => {
    const ok = p.peso > 0 && FLORES_ARTIFICIALES[p.tipo].colores.some((c) => c.id === p.colorId);
    if (!ok) avisos.push(`La flor ${p.tipo} ${p.colorId} no existe (o pesa 0): se quita.`);
    return ok;
  });
  const porRacimo = Math.max(1, Math.round(opciones.tallosPorRacimo));
  const total = validas.length > 0 ? anclas.length * porRacimo : 0;
  const pesoTotal = validas.reduce((a, p) => a + p.peso, 0);
  const exactas = validas.map((p) => (p.peso / pesoTotal) * total);
  const cuotas = exactas.map(Math.floor);
  const sobrante = total - cuotas.reduce((a, b) => a + b, 0);
  [...exactas.keys()].sort((a, b) => (exactas[b]! - cuotas[b]!) - (exactas[a]! - cuotas[a]!) || a - b).slice(0, sobrante).forEach((k) => { cuotas[k]! += 1; });

  const tallos: ProporcionFlor[] = validas.flatMap((p, k) => Array.from({ length: cuotas[k]! }, () => p));
  for (let i = tallos.length - 1; i > 0; i--) {
    const j = Math.floor(azar() * (i + 1));
    [tallos[i], tallos[j]] = [tallos[j]!, tallos[i]!];
  }
  tallos.sort((a, b) => FLORES_ARTIFICIALES[b.tipo].diametroCm - FLORES_ARTIFICIALES[a.tipo].diametroCm);

  const asignados: ProporcionFlor[][] = anclas.map(() => []);
  tallos.forEach((t, i) => asignados[i % anclas.length]!.push(t));

  const racimos: RacimoFloral[] = anclas.map((ancla, k) => {
    const n = unitario(ancla.normal);
    const aux: Vec3 = Math.abs(n.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    const e1 = unitario({ x: aux.y * n.z - aux.z * n.y, y: aux.z * n.x - aux.x * n.z, z: aux.x * n.y - aux.y * n.x });
    const e2 = { x: n.y * e1.z - n.z * e1.y, y: n.z * e1.x - n.x * e1.z, z: n.x * e1.y - n.y * e1.x };
    const lista = asignados[k]!;
    const centro = lista[0] ? FLORES_ARTIFICIALES[lista[0].tipo].diametroCm : 0;
    const giro = azar() * Math.PI * 2;
    const flores = lista.map((t, i): FlorColocada => {
      const flor = FLORES_ARTIFICIALES[t.tipo];
      const color = flor.colores.find((c) => c.id === t.colorId)!;
      // La primera (la más grande) en el centro; las demás alrededor, medio metidas bajo su borde.
      const radio = i === 0 ? 0 : (centro / 2 + flor.diametroCm / 2) * 0.65;
      const a = giro + ((i - 1) / Math.max(1, lista.length - 1)) * Math.PI * 2 + (azar() - 0.5) * 0.5;
      const sale = i === 0 ? flor.diametroCm * 0.15 : flor.diametroCm * 0.25;
      const posicion = {
        x: ancla.posicion.x + (e1.x * Math.cos(a) + e2.x * Math.sin(a)) * radio + n.x * sale,
        y: ancla.posicion.y + (e1.y * Math.cos(a) + e2.y * Math.sin(a)) * radio + n.y * sale,
        z: ancla.posicion.z + (e1.z * Math.cos(a) + e2.z * Math.sin(a)) * radio + n.z * sale,
      };
      const inclinada = unitario({ x: n.x + (e1.x * Math.cos(a) + e2.x * Math.sin(a)) * (radio > 0 ? 0.35 : 0), y: n.y + (e1.y * Math.cos(a) + e2.y * Math.sin(a)) * (radio > 0 ? 0.35 : 0), z: n.z + (e1.z * Math.cos(a) + e2.z * Math.sin(a)) * (radio > 0 ? 0.35 : 0) });
      return { tipo: t.tipo, colorId: t.colorId, hex: color.hex, diametroCm: flor.diametroCm, posicion, normal: inclinada };
    });
    return { ancla: ancla.indice, posicion: ancla.posicion, normal: n, flores };
  });

  const materiales = new Map<string, MaterialFollaje>();
  for (const r of racimos) {
    for (const f of r.flores) {
      const clave = `${f.tipo}|${f.colorId}`;
      const actual = materiales.get(clave);
      if (actual) actual.cantidad++;
      else {
        const flor = FLORES_ARTIFICIALES[f.tipo];
        const color = flor.colores.find((c) => c.id === f.colorId)!;
        materiales.set(clave, { tipo: f.tipo, colorId: f.colorId, nombre: `${flor.nombre} ${color.nombre}`, cantidad: 1, categoria: "follaje", cotizaComoGlobo: false, nota: "follaje, no cotiza como globo" });
      }
    }
  }
  return { racimos, materiales: [...materiales.values()], avisos };
}
