import type { Vec3 } from "./modulos";
import { crearAzar, type AnclaHueco, type ApoyoHueco } from "./organico";

/**
 * Flores artificiales (de tela) metidas en los huecos de una estructura orgánica: son **datos, no globos**. Van
 * en racimos sobre las anclas de hueco que deja `armarOrganico` y salen en los materiales aparte, como follaje,
 * porque no se cotizan como globo.
 *
 * Tamaños de las flores de tela de decoración más comunes: la cabeza de hortensia mide 15–18 cm, la rosa abierta
 * 6–8 cm y la ramita de gypsophila (nube) unos 10 cm de mata. Unidades: cm.
 */
export type TipoFlorArtificial = "hortensia" | "rosa" | "gypsophila" | "monstera" | "palma" | "helecho" | "eucalipto" | "hoja_seca" | "pampa";

/**
 * El follaje que no es flor (hojas de las guirnaldas tropicales, de jungla, de boda): se dibuja tendido sobre los globos. La
 * `pampa` no está aquí: sus plumas salen erguidas de entre los globos, con su tallo.
 */
export const HOJAS: readonly TipoFlorArtificial[] = ["monstera", "palma", "helecho", "eucalipto", "hoja_seca"];
export const esHoja = (t: TipoFlorArtificial) => HOJAS.includes(t);

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
  monstera: {
    tipo: "monstera", nombre: "Hoja de monstera", diametroCm: 34,
    colores: [{ id: "verde", nombre: "verde", hex: "#3a7d45" }, { id: "dorada", nombre: "dorada", hex: "#c9a14a" }],
    descripcion: "Hoja tropical calada de tela o papel: el toque de las guirnaldas de verano, safari y jungla.",
  },
  palma: {
    tipo: "palma", nombre: "Hoja de palma", diametroCm: 46,
    colores: [{ id: "verde", nombre: "verde", hex: "#4f8a3c" }, { id: "dorada", nombre: "dorada", hex: "#c9a14a" }],
    descripcion: "Penca de palma artificial que sale de entre los globos hacia fuera.",
  },
  helecho: {
    tipo: "helecho", nombre: "Helecho", diametroCm: 36,
    colores: [{ id: "verde", nombre: "verde", hex: "#4c7f3b" }],
    descripcion: "Fronda de helecho artificial: guirnaldas de jungla y dinosaurios.",
  },
  eucalipto: {
    tipo: "eucalipto", nombre: "Rama de eucalipto", diametroCm: 26,
    colores: [{ id: "verde_gris", nombre: "verde grisáceo", hex: "#8fa58c" }],
    descripcion: "Ramita de hojas redondas verde grisáceo: bodas y bautizos.",
  },
  hoja_seca: {
    tipo: "hoja_seca", nombre: "Hoja seca (abanico)", diametroCm: 32,
    colores: [{ id: "dorada", nombre: "dorada", hex: "#c8a24f" }, { id: "beige", nombre: "beige", hex: "#d8c3a0" }],
    descripcion: "Abanico de hojas de palma secas pintadas: el acento dorado de las guirnaldas elegantes.",
  },
  pampa: {
    tipo: "pampa", nombre: "Pampa (plumas)", diametroCm: 65,
    colores: [
      { id: "beige", nombre: "beige", hex: "#c2a67c" },
      { id: "crema", nombre: "crema", hex: "#e8dcc2" },
      { id: "blanca", nombre: "blanca", hex: "#f6f1e8" },
      { id: "dorada", nombre: "dorada", hex: "#c29d57" },
      { id: "rosa", nombre: "rosa", hex: "#e3b8b0" },
      { id: "terracota", nombre: "terracota", hex: "#b9714f" },
    ],
    descripcion: "Pluma esponjosa de hierba de la pampa en su tallo fino, de 30 a 60 cm: sale de entre los globos de las guirnaldas boho.",
  },
};

const sinTildes = (t: string) => t.normalize("NFD").replace(/\p{Diacritic}/gu, "");

/** Cómo llaman al follaje en la calle y en las fotos, además del nombre del catálogo (los más largos primero). */
const ALIAS_FOLLAJE: ReadonlyArray<readonly [string, TipoFlorArtificial]> = [
  ["pasto de la pampa", "pampa"], ["pasto de pampa", "pampa"], ["hierba de la pampa", "pampa"], ["hierba de pampa", "pampa"], ["pampas grass", "pampa"], ["pampa grass", "pampa"],
  ["plumas de pampas", "pampa"], ["plumas de pampa", "pampa"], ["pluma de pampa", "pampa"], ["pampas", "pampa"],
];

/** Separa «pasto de la pampa beige» o «palma dorada» en el nombre del follaje (el del catálogo o uno de sus alias) y el color que lo sigue. */
export function separarFollaje(pedido: string): { tipo: string; resto: string } {
  const texto = pedido.trim().toLowerCase().replace(/\s+/g, " ");
  const limpio = sinTildes(texto);
  for (const [alias, tipo] of ALIAS_FOLLAJE) {
    if (limpio === alias || limpio.startsWith(`${alias} `)) return { tipo, resto: limpio.slice(alias.length).trim() };
  }
  const [nombre = "", ...resto] = texto.split(" ");
  // «rosas», «hortensias», «palmas»…: el plural es el mismo follaje.
  const tipo = [nombre, nombre.replace(/s$/, ""), nombre.replace(/es$/, "")].find((n) => Object.hasOwn(FLORES_ARTIFICIALES, n)) ?? nombre;
  return { tipo, resto: resto.join(" ") };
}

/** Cómo llaman a un color de follaje además de su nombre: «natural», «café» y «tostada» son el beige de la pampa. */
const SINONIMOS_COLOR: Readonly<Record<string, string>> = { natural: "beige", cafe: "beige", marron: "beige", tostada: "beige", arena: "beige", champana: "beige" };

/**
 * El color de `flor` que nombra `texto`, aunque venga en plural o concordado («doradas», «dorado», «blancas», «rosas», «beiges»,
 * «natural», «café»); `undefined` si esa flor no viene en ese color.
 */
export function colorDeFollaje(flor: FlorArtificial, texto: string): ColorFlor | undefined {
  const palabra = sinTildes(texto.trim().toLowerCase()).replace(/[_\s]+/g, " ");
  const claves = new Set<string>();
  for (const base of [palabra, palabra.replace(/s$/, ""), palabra.replace(/es$/, "")]) {
    claves.add(base);
    claves.add(base.replace(/o$/, "a"));
    const sinonimo = SINONIMOS_COLOR[base];
    if (sinonimo) claves.add(sinonimo);
  }
  return flor.colores.find((c) => claves.has(sinTildes(c.id).replace(/_/g, " ")) || claves.has(sinTildes(c.nombre)));
}

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

const distanciaA = (p: Vec3, g: ApoyoHueco) => Math.hypot(p.x - g.centro.x, p.y - g.centro.y, p.z - g.centro.z);

/** Distancia (con signo: negativa por dentro) del punto a la cara del globo más cercano, y cuál es. */
function caraMasCercana(p: Vec3, apoyos: readonly ApoyoHueco[]): { d: number; globo: ApoyoHueco } {
  let globo = apoyos[0]!, d = Infinity;
  for (const g of apoyos) {
    const h = distanciaA(p, g) - g.radioCm;
    if (h < d) { d = h; globo = g; }
  }
  return { d, globo };
}

/** El punto de la cara de `g` que mira hacia `p`, `holgura` cm por fuera. */
function sobreLaCara(p: Vec3, g: ApoyoHueco, holgura: number): Vec3 {
  const u = unitario({ x: p.x - g.centro.x, y: p.y - g.centro.y, z: p.z - g.centro.z });
  return { x: g.centro.x + u.x * (g.radioCm + holgura), y: g.centro.y + u.y * (g.radioCm + holgura), z: g.centro.z + u.z * (g.radioCm + holgura) };
}

/**
 * Asienta una flor en el hueco: la hunde por la normal del ancla hasta que toca un globo (como cuando se mete el tallo
 * entre los globos hasta que la cabeza queda apoyada); si por ahí no toca nada, se apoya en la cara del globo más
 * cercano; y si quedó metida dentro de un globo, sale a su cara. El tallo queda a menos de 1 cm de una cara.
 */
function asentar(p: Vec3, n: Vec3, apoyos: readonly ApoyoHueco[]): { posicion: Vec3; cara: Vec3 } {
  let q = p, recorrido = 0;
  for (let i = 0; i < 40 && recorrido < 16; i++) {
    const { d } = caraMasCercana(q, apoyos);
    if (d <= 0.8) break;
    const paso = Math.min(d, 3, 16 - recorrido);
    q = { x: q.x - n.x * paso, y: q.y - n.y * paso, z: q.z - n.z * paso };
    recorrido += paso;
  }
  if (caraMasCercana(q, apoyos).d > 0.8) q = sobreLaCara(p, caraMasCercana(p, apoyos).globo, 0.3);
  for (let i = 0; i < 6; i++) {
    let peor: ApoyoHueco | null = null, hondo = 0.5;
    for (const g of apoyos) {
      const dentro = g.radioCm - distanciaA(q, g);
      if (dentro > hondo) { hondo = dentro; peor = g; }
    }
    if (!peor) break;
    q = sobreLaCara(q, peor, 0.3);
  }
  const { globo } = caraMasCercana(q, apoyos);
  return { posicion: q, cara: unitario({ x: q.x - globo.centro.x, y: q.y - globo.centro.y, z: q.z - globo.centro.z }) };
}

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
      if (!ancla.apoyos?.length) return { tipo: t.tipo, colorId: t.colorId, hex: color.hex, diametroCm: flor.diametroCm, posicion, normal: inclinada };
      // Metida en el hueco hasta tocar los globos; mira entre la salida del hueco y la cara donde se apoya.
      const asentada = asentar(posicion, n, ancla.apoyos);
      const normal = unitario({ x: inclinada.x * 0.65 + asentada.cara.x * 0.35, y: inclinada.y * 0.65 + asentada.cara.y * 0.35, z: inclinada.z * 0.65 + asentada.cara.z * 0.35 });
      return { tipo: t.tipo, colorId: t.colorId, hex: color.hex, diametroCm: flor.diametroCm, posicion: asentada.posicion, normal };
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

const EN_INGLES: Readonly<Record<TipoFlorArtificial, string>> = {
  hortensia: "hydrangeas", rosa: "roses", gypsophila: "baby's breath sprigs", monstera: "monstera leaves", palma: "palm fronds",
  helecho: "fern fronds", eucalipto: "eucalyptus sprigs", hoja_seca: "dried palm fans", pampa: "pampas grass plumes",
};

const COLOR_EN_INGLES: Readonly<Record<string, string>> = { dorada: "gold", beige: "beige", crema: "cream", blanca: "white", rosa: "pink", terracota: "terracotta" };

/** El color que FLUX necesita oír: el dorado y el beige de cualquier follaje, y todos los de la pampa (su color es lo que más se ve). */
const colorEnIngles = (tipo: TipoFlorArtificial, id: string) => (tipo === "pampa" || id === "dorada" || id === "beige" ? COLOR_EN_INGLES[id] : undefined);

/** Lo que va metido entre los globos, para el texto de FLUX: «Artificial monstera leaves (green) tucked between…». */
export function follajeEnIngles(flores: ReadonlyArray<{ tipo: TipoFlorArtificial; hex: string }>): string {
  if (!flores.length) return "";
  const porTipo = new Map<TipoFlorArtificial, Set<string>>();
  for (const f of flores) {
    const color = FLORES_ARTIFICIALES[f.tipo].colores.find((c) => c.hex.toLowerCase() === f.hex.toLowerCase());
    const nombres = porTipo.get(f.tipo) ?? new Set<string>();
    const nombre = color ? colorEnIngles(f.tipo, color.id) : undefined;
    if (nombre) nombres.add(nombre);
    porTipo.set(f.tipo, nombres);
  }
  const partes = [...porTipo].map(([t, c]) => `${c.size ? `${[...c].join(" and ")} ` : ""}${EN_INGLES[t]}`);
  const lista = partes.length > 1 ? `${partes.slice(0, -1).join(", ")} and ${partes[partes.length - 1]}` : partes[0]!;
  return `Artificial ${lista} tucked between the balloons, exactly where the input shows them`;
}
