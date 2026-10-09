import type { EscenaArmada, NodoArmado, Sala } from "@/lib/globos3d/escena";
import type { GloboDePieza, FlorDePieza } from "@/lib/globos3d/piezas";
import type { TuboDecoracion } from "@/lib/globos3d/decoraciones";
import type { ArmadaCompactaV1 } from "@/lib/globos3d/motor/v1";
import { TABLA_SEMPERTEX } from "@/lib/plan/referencia-sempertex";
import { salaNeutra } from "@/components/tres-d/sala-neutra";

/**
 * **De la armada compacta a lo que dibuja el visor** (REQ-007, fase 3). El servidor manda solo posición, diámetro y color
 * de cada globo (`ArmadaCompactaV1`); el visor del Taller (`mostrarArmada`) entiende `EscenaArmada`. Esta función arma ese
 * subconjunto —globos redondos, tubitos, flores y la caja de cada pieza— sin tocar three.js ni el motor: la receta no viaja.
 *
 * - el color llega como `#rrggbb` y el visor lo pide por código Sempertex (de ahí saca el acabado: mate, cromado, perlado).
 *   Cada tono de la tabla es único, así que el código sale del hex sin ambigüedad; un hex fuera de la tabla toma la
 *   referencia más cercana;
 * - la compacta guarda el centro del globo, el visor su nudo: el nudo queda debajo del centro (un globo de pie);
 * - la sala es la neutra de las capturas: sin techo ni paredes laterales, ni rejilla ni ayudas.
 */
const ARRIBA = { x: 0, y: 1, z: 0 } as const;
const FORMATO_GLOBO = "R-12";
const FORMATO_TUBO = "T-260";
const ZONA_SALA = { tonos: { piso: "#d6d6da", paredes: "#dcdce0", techo: "#e6e6e9" }, mostrar: { piso: true, fondo: true, laterales: false, techo: false } } as const;

const HEX_A_CODIGO = new Map(TABLA_SEMPERTEX.referencias.map((r) => [r.hexGlobo, r.codigo]));

const canales = (hex: string): [number, number, number] => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

/** El código Sempertex de un tono de la armada: el exacto o, si el hex no es de la tabla, el más cercano. */
export function codigoDeHex(hex: string): string {
  const exacto = HEX_A_CODIGO.get(hex.toLowerCase());
  if (exacto) return exacto;
  const [r, g, b] = canales(hex);
  let mejor = TABLA_SEMPERTEX.referencias[0]!;
  let distancia = Infinity;
  for (const ref of TABLA_SEMPERTEX.referencias) {
    const [rr, gg, bb] = canales(ref.hexGlobo);
    const d = (r - rr) ** 2 + (g - gg) ** 2 + (b - bb) ** 2;
    if (d < distancia) { distancia = d; mejor = ref; }
  }
  return mejor.codigo;
}

/** ¿Es una armada que se puede dibujar? Lo que llega por la red no se da por bueno: se mira antes de pasárselo al visor. */
export function armadaDibujable(valor: unknown): valor is ArmadaCompactaV1 {
  if (typeof valor !== "object" || valor === null) return false;
  const a = valor as Partial<ArmadaCompactaV1>;
  const numeros = (v: unknown): v is number[] => Array.isArray(v) && v.every((n) => typeof n === "number" && Number.isFinite(n));
  if (a.version !== "armada-compacta.v1" || !a.sala || !Array.isArray(a.paleta) || !a.paleta.every((h) => typeof h === "string" && /^#[0-9a-f]{6}$/.test(h))) return false;
  if (!numeros(a.globos) || a.globos.length % 5 !== 0 || !numeros(a.flores) || a.flores.length % 5 !== 0) return false;
  if (!Array.isArray(a.tubos) || !a.tubos.every((t) => t && numeros(t.puntos) && t.puntos.length % 3 === 0 && Number.isInteger(t.color))) return false;
  const colores = a.paleta.length;
  for (let i = 4; i < a.globos.length; i += 5) if (!Number.isInteger(a.globos[i]) || a.globos[i]! < 0 || a.globos[i]! >= colores) return false;
  return Array.isArray(a.piezas) && a.piezas.every((p) => p && typeof p.id === "string" && Array.isArray(p.caja) && p.caja.length === 6);
}

function nodoDePieza(armada: ArmadaCompactaV1, indice: number): NodoArmado {
  const pieza = armada.piezas[indice]!;
  const hexDe = (color: number) => armada.paleta[color] ?? "#9ca3af";
  const globos: GloboDePieza[] = [];
  for (let i = pieza.globos[0]; i < pieza.globos[0] + pieza.globos[1]; i++) {
    const [x, y, z, diametro, color] = armada.globos.slice(i * 5, i * 5 + 5) as [number, number, number, number, number];
    globos.push({ formatoId: FORMATO_GLOBO, infladoCm: diametro, codigo: codigoDeHex(hexDe(color)), nudo: { x, y: y - diametro / 2, z }, direccion: ARRIBA, cuelloExtraCm: 0 });
  }
  const tubos: TuboDecoracion[] = armada.tubos.slice(pieza.tubos[0], pieza.tubos[0] + pieza.tubos[1]).map((t) => ({
    formatoId: FORMATO_TUBO, grosorCm: t.grosorCm, codigo: codigoDeHex(hexDe(t.color)), cerrado: false,
    puntos: Array.from({ length: t.puntos.length / 3 }, (_, k) => ({ x: t.puntos[k * 3]!, y: t.puntos[k * 3 + 1]!, z: t.puntos[k * 3 + 2]! })),
  }));
  const flores: FlorDePieza[] = [];
  for (let i = pieza.flores[0]; i < pieza.flores[0] + pieza.flores[1]; i++) {
    const [x, y, z, diametro, color] = armada.flores.slice(i * 5, i * 5 + 5) as [number, number, number, number, number];
    flores.push({ tipo: "hortensia", hex: hexDe(color), diametroCm: diametro, posicion: { x, y, z }, normal: { x: 0, y: 0, z: 1 } });
  }
  const [minx, miny, minz, maxx, maxy, maxz] = pieza.caja;
  return { id: pieza.id, nombre: pieza.id, copias: 1, globos, tubos, flores, solidos: [], anclas: [], materiales: [], caja: { min: { x: minx, y: miny, z: minz }, max: { x: maxx, y: maxy, z: maxz } }, avisos: [], puestas: [] };
}

/** La sala neutra de la armada: la medida del motor y los tonos lisos de las capturas. */
export function salaDeArmada(armada: ArmadaCompactaV1): Sala {
  return salaNeutra({ ...armada.sala, tonos: { ...ZONA_SALA.tonos }, mostrar: { ...ZONA_SALA.mostrar } });
}

/**
 * El subconjunto de `EscenaArmada` que `mostrarArmada` usa. Con `pieza`, solo esa (su miniatura, encuadrada por su caja).
 * Una pieza que no existe da una escena sin nada: quien llama lo ve como «no hay nada que dibujar».
 */
export function escenaDesdeArmada(armada: ArmadaCompactaV1, opciones: { pieza?: string } = {}): EscenaArmada {
  const indices = armada.piezas.flatMap((p, i) => (opciones.pieza === undefined || p.id === opciones.pieza ? [i] : []));
  const porNodo = indices.map((i) => nodoDePieza(armada, i));
  return {
    globos: porNodo.flatMap((n) => n.globos), tubos: porNodo.flatMap((n) => n.tubos), flores: porNodo.flatMap((n) => n.flores),
    solidos: [], cilindros: [], sala: salaDeArmada(armada), materiales: [], porNodo, avisos: [],
  };
}
