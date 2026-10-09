import { z } from "zod";
import { armarEscena, idNuevo, type Colocacion, type Escena, type NodoEscena } from "./escena";
import type { AcabadoEscenografia, ElementoEscenografia } from "./escenografia";
import { FONDOS_CATALOGO, type FondoCatalogo } from "./fondos-escenografia";
import { buscarPorNombre, fallar, plegar } from "./herramientas-escena-colores";
import type { HerramientaExtra } from "./herramientas-escena-grupos";
import { CATALOGO_MOBILIARIO, type MedidasMueble, type MuebleCatalogo } from "./mobiliario-catalogo";
import { puestosAlrededor, puestosEnFila, type Puesto } from "./mobiliario-disposicion";

/**
 * **agregar_mobiliario**: la herramienta con que la IA de escena pone fondos y muebles que no son globos (sillas,
 * mesas, sofás, aros y arcos metálicos, carrito de dulces, neón…; la lista sale de `FONDOS_CATALOGO`) con sus medidas
 * y colores, y los reparte: `cantidad` en fila, o `alrededor_de` una mesa que ya está en la escena («6 sillas
 * alrededor de la mesa redonda»). Es escenografía: no cotiza.
 */

const MUEBLES = new Map(CATALOGO_MOBILIARIO.map((m) => [m.id, m]));
const IDS = FONDOS_CATALOGO.map((f) => f.id) as [string, ...string[]];

const ACABADOS = ["mate", "satinado", "brillante", "tela", "madera", "metal"] as const satisfies readonly AcabadoEscenografia[];

/** Colores de decoradora que se piden por nombre (los que no están se buscan en la tabla Sempertex). */
const COLORES_NOMBRE: Readonly<Record<string, string>> = {
  blanco: "#f7f6f2", negro: "#1c1c1c", dorado: "#d6b25a", oro: "#d6b25a", plata: "#c9c9c9", plateado: "#c9c9c9", cromado: "#c9c9c9", madera: "#8a6a45", nogal: "#5c3d24",
  beige: "#d8cbb4", crema: "#f1e8d4", marfil: "#f1e8d4", rosa: "#f0b8c8", rosado: "#f0b8c8", fucsia: "#d6336c", rojo: "#b3262d", vino: "#6d1f2c", naranja: "#e8793a",
  amarillo: "#f2d36b", verde: "#4f7a4b", salvia: "#a9b79a", menta: "#a9d6c9", turquesa: "#2fa6a0", celeste: "#9ec9ea", azul: "#3d8fd6", marino: "#1f3366", lila: "#b9a3d6",
  morado: "#6b3fa0", gris: "#8a8a8a", cobre: "#b87333", terracota: "#c4704f", champana: "#e8d6b0", champagne: "#e8d6b0", cafe: "#6b4a2f", chocolate: "#4a2e1f",
};

/** Un color pedido (`#rrggbb`, nombre de decoradora o color Sempertex) → `#rrggbb`. */
export function hexDeColor(pedido: string, notas: string[]): string {
  const t = pedido.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(t)) return t.toLowerCase();
  const claves = plegar(t).split(/[^a-z0-9]+/).filter(Boolean);
  const hallado = claves.map((c) => COLORES_NOMBRE[c]).find(Boolean);
  if (hallado) return hallado;
  const sempertex = buscarPorNombre(t);
  if (!sempertex) return fallar(`No reconozco el color «${pedido}»: pásalo como nombre común («blanco», «dorado», «madera», «rosa») o como #rrggbb.`);
  notas.push(`«${pedido}» → ${sempertex.mejor.nombreCompleto}`);
  return sempertex.mejor.hexGlobo;
}

const MobiliarioSchema = z.object({
  id: z.enum(IDS).describe(FONDOS_CATALOGO.map((f) => `${f.id}: ${f.descripcion}`).join(" ")),
  nombre: z.string().min(1).max(60).optional().describe("nombre visible (por defecto, el del catálogo)"),
  cantidad: z.number().int().min(1).max(24).optional().describe("cuántos iguales (1 por defecto); más de uno se reparte con disposicion"),
  disposicion: z.enum(["fila", "alrededor"]).optional().describe("fila: en línea de izquierda a derecha, centrados en x_cm/z_cm; alrededor: repartidos alrededor de la mesa alrededor_de, mirando a ella (sillas y taburetes)"),
  alrededor_de: z.string().min(1).max(80).optional().describe("disposicion alrededor: id de la mesa (u otra pieza) que ya está en la escena (los da ver_escena)"),
  holgura_cm: z.number().min(0).max(80).optional().describe("alrededor: separación entre el borde de la mesa y el frente de cada asiento (8 por defecto)"),
  separacion_cm: z.number().min(10).max(600).optional().describe("fila: distancia entre centros (el ancho de cada uno + 8 por defecto)"),
  ancho_cm: z.number().min(5).max(1200).optional().describe("ancho (en lo redondo, el diámetro); si falta, el del catálogo"),
  fondo_cm: z.number().min(2).max(600).optional().describe("fondo (de frente a atrás); si falta, el del catálogo"),
  alto_cm: z.number().min(1).max(500).optional().describe("alto total; si falta, el del catálogo"),
  colores: z.array(z.string().min(1).max(40)).min(1).max(3).optional().describe("colores en el orden que dice la descripción de cada mueble (el primero es el principal: silla = estructura, sofá = tela, mesa con mantel = mantel); nombre común («blanco», «dorado», «rosa») o #rrggbb"),
  acabado: z.enum(ACABADOS).optional().describe("material del color principal (madera, metal, tela, mate, satinado, brillante)"),
  texto: z.string().min(1).max(40).optional().describe("solo neon_cursiva: lo que dice"),
  x_cm: z.number().optional().describe("izquierda (−) a derecha (+) desde el centro de la sala; el centro de la fila o del mueble"),
  z_cm: z.number().optional().describe("fondo (−) a frente (+); la pared del fondo está en z = −fondo/2"),
  giro_grados: z.number().min(-180).max(180).optional().describe("giro sobre el eje vertical; 0 = de frente al público"),
  a_lo_largo_cm: z.number().optional().describe("solo de pared (neón, letrero, cortina): desde el centro de la pared del fondo, + a la derecha"),
  altura_cm: z.number().min(0).max(500).optional().describe("solo de pared: altura del borde de abajo"),
});
type Pedido = z.infer<typeof MobiliarioSchema>;

const r0 = (n: number) => Math.round(n);

type Armado = { elementos: ElementoEscenografia[]; medidas: MedidasMueble | undefined };

function armarPedido(entrada: FondoCatalogo, mueble: MuebleCatalogo | undefined, a: Pedido, notas: string[]): Armado {
  if (!mueble) {
    if (a.ancho_cm || a.fondo_cm || a.alto_cm || a.colores || a.acabado) notas.push(`«${entrada.nombre}» es un fondo de foto: va con sus medidas y colores de catálogo (el mobiliario sí cambia de medida y color).`);
    return { elementos: entrada.elementos(), medidas: undefined };
  }
  const pedidos = a.colores ? a.colores.map((c) => hexDeColor(c, notas)) : [];
  const colores = [...pedidos, ...mueble.colores.slice(pedidos.length)];
  const medidas = { anchoCm: a.ancho_cm ?? mueble.medidas.anchoCm, fondoCm: a.fondo_cm ?? mueble.medidas.fondoCm, altoCm: a.alto_cm ?? mueble.medidas.altoCm };
  const elementos = mueble.armar({ ...medidas, colores, ...(a.acabado ? { acabado: a.acabado } : {}), ...(a.texto ? { texto: a.texto } : {}) });
  return { elementos, medidas };
}

function aplicar(escena: Escena, argumentos: unknown): { escena: Escena; resumen: string } {
  const a = MobiliarioSchema.parse(argumentos ?? {});
  const entrada = FONDOS_CATALOGO.find((f) => f.id === a.id) ?? fallar(`No hay «${a.id}» en el catálogo de mobiliario.`);
  const mueble = MUEBLES.get(a.id);
  const notas: string[] = [];
  const { elementos, medidas } = armarPedido(entrada, mueble, a, notas);
  const n = a.cantidad ?? 1;

  let puestos: Puesto[];
  let colocacion: (p: Puesto) => Colocacion;
  if (entrada.lugar === "pared") {
    colocacion = () => ({ en: "pared", pared: "fondo", aLoLargoCm: a.a_lo_largo_cm ?? a.x_cm ?? 0, alturaCm: a.altura_cm ?? entrada.alturaParedCm ?? 0 });
    puestos = [{ x: 0, z: 0, giroGrados: 0 }];
    if (n > 1) notas.push("Los de pared van de uno en uno: puse solo uno.");
  } else {
    colocacion = (p) => ({ en: "piso", xCm: p.x, zCm: p.z, giroGrados: p.giroGrados });
    const disposicion = a.disposicion ?? (n > 1 ? "fila" : undefined);
    const frente = medidas?.anchoCm ?? 50, fondo = medidas?.fondoCm ?? 50;
    if (disposicion === "alrededor") {
      if (!a.alrededor_de) fallar("Para repartir alrededor de una mesa dime cuál (alrededor_de = su id, de ver_escena).");
      const mesa = escena.nodos.find((x) => x.id === a.alrededor_de) ?? fallar(`No hay pieza con id «${a.alrededor_de}». Usa ver_escena para ver los ids.`);
      const caja = armarEscena(escena).porNodo.find((x) => x.id === mesa.id)?.caja ?? fallar(`«${mesa.nombre}» no ocupa lugar en la escena.`);
      puestos = puestosAlrededor({
        cx: (caja.min.x + caja.max.x) / 2, cz: (caja.min.z + caja.max.z) / 2, anchoCm: caja.max.x - caja.min.x, fondoCm: caja.max.z - caja.min.z,
        cantidad: n, holguraCm: fondo / 2 + (a.holgura_cm ?? 8), frenteCm: frente,
      });
      if (puestos.length < n) notas.push(`Alrededor de «${mesa.nombre}» solo caben ${puestos.length} de ${n}.`);
    } else if (disposicion === "fila") {
      puestos = puestosEnFila({ cx: a.x_cm ?? 0, cz: a.z_cm ?? r0(-escena.sala.fondoCm / 2 + (entrada.retiroCm ?? 15)), cantidad: n, separacionCm: a.separacion_cm ?? frente + 8, giroGrados: a.giro_grados ?? 0 });
    } else {
      puestos = [{ x: a.x_cm ?? 0, z: a.z_cm ?? r0(-escena.sala.fondoCm / 2 + (entrada.retiroCm ?? 15)), giroGrados: a.giro_grados ?? 0 }];
    }
  }

  let actual = escena;
  const nuevos: NodoEscena[] = [];
  puestos.forEach((p, i) => {
    const id = idNuevo(actual, a.id.replace(/_/g, "-"));
    const nodo: NodoEscena = { id, nombre: `${a.nombre ?? entrada.nombre}${puestos.length > 1 ? ` ${i + 1}` : ""}`, pieza: { tipo: "escenografia", elementos, catalogoId: a.id }, colocacion: colocacion(p) };
    actual = { ...actual, nodos: [...actual.nodos, nodo] };
    nuevos.push(nodo);
  });
  const medidasTexto = medidas ? ` de ${r0(medidas.anchoCm)}×${r0(medidas.fondoCm)}×${r0(medidas.altoCm)} cm (ancho×fondo×alto)` : "";
  const resumen = `Agregué ${nuevos.length} «${entrada.nombre}»${medidasTexto}: ${nuevos.map((x) => x.id).join(", ")}. Es escenografía (no cotiza).`;
  return { escena: actual, resumen: [resumen, ...new Set(notas)].join(" ") };
}

export const HERRAMIENTAS_MOBILIARIO: Readonly<Record<string, HerramientaExtra>> = {
  agregar_mobiliario: {
    esquema: MobiliarioSchema,
    descripcion: "Pone mobiliario o un fondo que NO es de globos (sillas Tiffany o modernas, bancas, taburetes, sofás, mesas imperiales, redondas, cóctel, de postres, de regalos, mesas nido, carrito de dulces, aros y arcos metálicos, peldaños, biombo, pampas, lámpara, neón…) con medidas y colores; no cotiza. Con cantidad y disposicion reparte varios: «fila», o «alrededor» de una mesa que ya está (alrededor_de = su id; cada asiento queda mirando a la mesa): «6 sillas alrededor de una mesa redonda» = primero agregar_mobiliario mesa_redonda_mantel, luego agregar_mobiliario silla_tiffany con cantidad 6, disposicion alrededor y alrededor_de = el id que devolvió la mesa. Para quitar o mover se usan quitar_pieza y mover_pieza.",
    aplicar,
  },
};
