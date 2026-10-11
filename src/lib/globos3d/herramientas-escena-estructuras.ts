import { ajustarTrazo, crearTrazo, type PuntoPedido } from "./herramientas-escena-trazo";
import { esColumnaTrazo, GROSOR_CUERPO_CM } from "./trazo-organico";
import { comprobarCambioDeCuerpo, comprobarCuerpo, cuerpoDeOrganico, segundosDeArmar } from "./presupuesto-cuerpo";
import { globosDeEstructura } from "./organico-estructura";
import { EMPAQUES } from "./organico-empaques";
import { altoQueCabe, decidirAlto } from "./alto-nueva-organica";
import { armarPieza, type Pieza, type TipoPieza } from "./piezas";
import { formatoPorId } from "./formatos";
import {
  formaColumna, formaGuirnalda, formaSemiarco, MEZCLA_COLUMNA_GRUESA, MEZCLA_GUIRNALDA,
  type ColorOrganico, type OpcionesOrganico, type TramoOrganico,
} from "./organico";
import { BASE_TRAMOS, medidaConTamanos, mezclaCon, rellenoCon, tamanosPosibles } from "./mezcla-tamanos-organica";
import { ANILLO_INTERIOR, INFLADOS_ORGANICOS, opcionesArcoRectangular, opcionesAroOrganico } from "./estructuras-organicas";
import { COLUMNA_QUINCE_AZUL } from "./organico-presets";
import { CONTORNOS_PREDEFINIDOS, type ColoresForma, type ContornoForma, type ContornoPredefinido, type OpcionesForma } from "./formas";
import { normalizarTexto, type OpcionesLetras, type TecnicaLetras } from "./letras";
import { contornoDeTexto } from "./contorno-texto";
import { CARACTERES_METALIZADO, COLORES_METALIZADO, PULGADAS_METALIZADO, type ColorMetalizado, type FormaMetalizado } from "./metalizados";
import { MURALES_PREDEFINIDOS } from "./murales";
import { TECHOS_PREDEFINIDOS } from "./techo";
import { ARBOLES_PREDEFINIDOS } from "./arboles-globos";
import { PARED_TRENZAS_INICIAL } from "./pared-trenzas";
import type { Vec3 } from "./modulos";
import {
  FORMATOS_ORGANICOS, conAcabado, fallar, metalizadoMasParecido, referenciaDePedido, resolverColorFlexible, resolverColorOrganico,
} from "./herramientas-escena-colores";
import { recolorearConPaleta } from "./herramientas-escena-recolor";

/**
 * **Estructuras que la IA del taller 3D puede crear de cero con parámetros** (además de columna, arco, arco
 * orgánico, guirnalda, pared de malla y decoración, que están en `herramientas-escena.ts`): columna orgánica (recta o
 * inclinada), guirnalda orgánica, semiarco orgánico, aro orgánico, marco orgánico (arco rectangular), pared de
 * trenzas, formas de globos (corazón, estrella, nube… rellenas, o un número o una letra relleno de globos; esfera; cono), letras y números de globos,
 * metalizados (foil), murales, decoraciones de techo, palmeras/árboles y el globo suelto. Cada una con sus medidas
 * validadas contra `RANGOS_ESTRUCTURA`, colores oficiales (código o nombre, con acabado) y, en las orgánicas, pesos
 * por color y tamaños de globo. También: escalar y ajustar una pieza orgánica que ya existe (la que viene de la
 * biblioteca), para que «hazla más alta / más gruesa / solo con R-12 y R-5 / con flores» funcione en cualquiera.
 * Puro y sin red.
 */

type Rango = readonly [number, number];

export const TIPOS_ESTRUCTURA = [
  "columna_organica", "guirnalda_organica", "semiarco_organico", "aro_organico", "marco_organico", "trazo_organico",
  "pared_trenzas", "forma", "letras", "metalizado", "mural", "techo", "arbol", "globo",
] as const;
export type TipoEstructura = (typeof TIPOS_ESTRUCTURA)[number];

/** Rangos (cm) de las estructuras nuevas. `grosor_cm` es el diámetro del cuerpo orgánico. */
export const RANGOS_ESTRUCTURA = {
  columna_organica: { alto_cm: [80, 320], grosor_cm: [GROSOR_CUERPO_CM.min, GROSOR_CUERPO_CM.max], inclinacion_cm: [-120, 120] },
  guirnalda_organica: { ancho_cm: [100, 800], caida_cm: [0, 150], grosor_cm: [GROSOR_CUERPO_CM.min, GROSOR_CUERPO_CM.max] },
  semiarco_organico: { ancho_cm: [60, 300], alto_cm: [100, 300], grosor_cm: [GROSOR_CUERPO_CM.min, GROSOR_CUERPO_CM.max] },
  aro_organico: { diametro_cm: [80, 300], grosor_cm: [20, 70] },
  marco_organico: { ancho_cm: [120, 500], alto_cm: [150, 320], grosor_cm: [GROSOR_CUERPO_CM.min, GROSOR_CUERPO_CM.max] },
  organico: { alto_cm: [40, 400], ancho_cm: [30, 800], grosor_cm: [GROSOR_CUERPO_CM.min, GROSOR_CUERPO_CM.max] },
  pared_trenzas: { ancho_cm: [100, 600], alto_cm: [100, 300] },
  forma: { ancho_cm: [40, 300], alto_cm: [40, 300] },
  esfera: { diametro_cm: [30, 200] },
  cono: { alto_cm: [40, 250] },
  letras: { alto_cm: [20, 200] },
  arbol: { alto_cm: [100, 400] },
} as const satisfies Record<string, Record<string, Rango>>;

export const FIGURAS = ["corazon", "estrella", "circulo", "aro", "ancla", "cruz", "nube", "castillo", "esfera", "cono"] as const satisfies ReadonlyArray<ContornoPredefinido | "esfera" | "cono">;
export const TECNICAS = ["celdas", "malla", "organico", "hilera", "cuartetos", "tubito"] as const;
export const FORMAS_METALIZADO = ["numero", "letra", "letras", "corazon", "estrella", "redondo", "luna", "flor", "nube"] as const;
export const COLORES_FOIL = Object.keys(COLORES_METALIZADO) as [ColorMetalizado, ...ColorMetalizado[]];
export const MODELOS = [...MURALES_PREDEFINIDOS.map((m) => m.id), ...TECHOS_PREDEFINIDOS.map((t) => t.id), ...ARBOLES_PREDEFINIDOS.map((a) => a.id)] as [string, ...string[]];

export const NOMBRE_TIPO: Readonly<Record<TipoPieza, string>> = {
  columna: "columna clásica de cuartetos", arco: "arco clásico de cuartetos", pared_malla: "pared de malla", pared_trenzas: "pared de trenzas", organico: "pieza orgánica",
  decoracion: "decoración", arco_organico: "arco orgánico", guirnalda: "guirnalda clásica", escenografia: "escenografía", globo: "globo suelto",
  forma: "forma de globos", letras: "letras de globos", metalizado: "globo metalizado",
  mural: "mural pixelado", techo: "decoración de techo", arbol_globos: "palmera o árbol de globos", modulo: "módulo de globos",
};

/** Lo que se le puede pedir a una estructura (los mismos nombres que el esquema de la herramienta). */
export type PedidoEstructura = {
  alto_cm?: number; ancho_cm?: number; caida_cm?: number; grosor_cm?: number; inclinacion_cm?: number;
  colores?: string[]; pesos?: number[]; tamanos?: string[]; acabado?: string; flores?: boolean;
  texto?: string; figura?: string; tecnica?: string; formato?: string;
  forma_metalizado?: string; pulgadas?: number; color_metalizado?: string; modelo?: string;
  silueta?: string; puntos?: PuntoPedido[]; racimos?: number; follaje?: string[];
};

export type LugarPieza = "piso" | "pared" | "techo";

const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;

function enRango(valor: number, rango: Rango, que: string): number {
  if (!Number.isFinite(valor) || valor < rango[0] || valor > rango[1]) fallar(`${que} = ${valor} cm está fuera de rango: va de ${rango[0]} a ${rango[1]} cm.`);
  return r0(valor);
}

const pedidosCon = (p: PedidoEstructura): string[] | undefined => p.colores?.map((c) => conAcabado(c, p.acabado));

// ----------------------------------------------------------------------------------------------------------
// Orgánicas
// ----------------------------------------------------------------------------------------------------------

/** La paleta por defecto de lo orgánico (la del arco orgánico de partida). */
const PALETA_ORGANICA: readonly string[] = ["609", "005", "010", "570"];

/** Colores pedidos → paleta orgánica con pesos (el primero 40 % y el resto se reparte, si no vienen) y formatos. */
export function coloresOrganicosPedidos(pedidos: readonly string[], pesos: readonly number[] | undefined, notas: string[]): ColorOrganico[] {
  if (pesos && pesos.length !== pedidos.length) fallar(`pesos tiene ${pesos.length} valores y colores ${pedidos.length}: deben ir uno por color.`);
  if (pesos?.some((p) => !Number.isFinite(p) || p < 0 || p > 100)) fallar("Cada peso va de 0 a 100.");
  const salida: ColorOrganico[] = [];
  pedidos.forEach((pedido, i) => {
    const { codigo, formatos } = resolverColorOrganico(pedido, notas);
    const peso = pesos ? r0(pesos[i]!) : pedidos.length === 1 ? 100 : i === 0 ? 40 : r0(60 / (pedidos.length - 1));
    const previo = salida.find((c) => c.codigo === codigo);
    if (previo) { previo.peso += peso; return; }
    salida.push(formatos.length < FORMATOS_ORGANICOS.length ? { codigo, peso, formatos } : { codigo, peso });
  });
  if (!salida.some((c) => c.peso > 0)) fallar("Los pesos suman 0: al menos un color debe pesar algo.");
  return salida;
}

const FLORES = () => structuredClone(COLUMNA_QUINCE_AZUL.flores);

function piezaOrganica(tramos: readonly TramoOrganico[], colores: ColorOrganico[], permitidos: readonly string[], suelo: boolean, flores: boolean, semilla: number): Pieza {
  const opciones: OpcionesOrganico = {
    semilla, tramos: tramos.map((t) => ({ ...t, mezcla: mezclaCon(t.mezcla, permitidos) })), inflados: INFLADOS_ORGANICOS, variacionInflado: 0.07,
    relleno: rellenoCon(permitidos), colores, suelo, huecosFlores: flores ? 14 : 0, vista: { x: 0, y: 0, z: 1 }, densidad: 1,
  };
  return { tipo: "organico", opciones, flores: flores ? FLORES() : null };
}

/**
 * El alto pedido es el que se ve (de abajo a lo más alto de los globos): los globos grandes de la punta sobresalen del recorrido, así que se
 * mide armada y, si se pasa o se queda corta más de 4 cm, se estira o se encoge (`alto-nueva-organica.ts`: en una pieza de segundos no se arma otra
 * vez, y se dice; si además no cabe bajo el techo, se estira a lo que cabe, o se dice qué alto_cm pedir).
 */
function alAlto(pieza: Pieza, altoCm: number, notas: string[], techoCm?: number): Pieza {
  if (pieza.tipo !== "organico") return pieza;
  const armadasAntes = EMPAQUES.hechos, inicio = performance.now();
  const medidoCm = medidasArmadas(pieza).altoCm;
  const costoMs = EMPAQUES.hechos > armadasAntes ? performance.now() - inicio : 1000 * segundosDeArmar(globosDeEstructura(pieza.opciones));
  const { accion, nota } = decidirAlto({ medidoCm, pedidoCm: altoCm, costoMs, techoCm });
  if (nota) notas.push(nota);
  if (accion === "reajustar") return escalarOrganico(pieza, { altoCm });
  if (accion !== "al_techo" || techoCm === undefined) return pieza;
  const objetivoCm = Math.min(altoCm, techoCm - 2);
  const ajustada = escalarOrganico(pieza, { altoCm: objetivoCm });
  const nuevoCm = medidasArmadas(ajustada).altoCm;
  if (nuevoCm > techoCm) fallar(`La pieza mide ${nuevoCm} cm, aun estirada a ${objetivoCm} cm, y no cabe bajo el techo de ${r0(techoCm)} cm: pídela con alto_cm = ${altoQueCabe(objetivoCm, nuevoCm, techoCm)} o menos.`);
  notas.push(`para caber bajo el techo de ${r0(techoCm)} cm la pieza quedó de ${nuevoCm} cm de alto y no de los ${altoCm} pedidos`);
  return ajustada;
}

/** Una semilla estable por medidas (dos columnas iguales pedidas iguales salen iguales; otras medidas, otro reparto). */
const semillaDe = (...n: number[]) => (n.reduce((s, x) => (s * 31 + r0(x)) % 9973, 7) || 7);

function crearOrganica(tipo: Exclude<Extract<TipoEstructura, `${string}_organic${string}`>, "trazo_organico">, p: PedidoEstructura, notas: string[], techoCm?: number): { pieza: Pieza; nombre: string; lugar: LugarPieza } {
  const pedidos = pedidosCon(p);
  const colores = coloresOrganicosPedidos(pedidos ?? [...PALETA_ORGANICA], pedidos ? p.pesos : [45, 25, 15, 15], notas);
  const flores = p.flores ?? false;
  switch (tipo) {
    case "columna_organica": {
      const R = RANGOS_ESTRUCTURA.columna_organica;
      const alto = enRango(p.alto_cm ?? 200, R.alto_cm, "alto_cm");
      const grosor = enRango(p.grosor_cm ?? 70, R.grosor_cm, "grosor_cm");
      const inclinacion = p.inclinacion_cm === undefined ? 0 : enRango(p.inclinacion_cm, R.inclinacion_cm, "inclinacion_cm");
      const tramoDe = (g: number) => formaColumna({ altoCm: alto, radioBaseCm: g / 2, radioMedioCm: r1(g * 0.43), radioPuntaCm: r1(g * 0.36), inclinacionCm: inclinacion, serpenteoCm: 4, mezcla: MEZCLA_COLUMNA_GRUESA });
      const permitidos = tamanosPosibles(colores, p.tamanos, grosor * 0.75);
      comprobarCuerpo(medidaConTamanos((g) => ({ tramos: [tramoDe(g)], ...BASE_TRAMOS }), permitidos), grosor);
      return { pieza: alAlto(piezaOrganica([tramoDe(grosor)], colores, permitidos, true, flores, semillaDe(alto, grosor, inclinacion)), alto, notas, techoCm), nombre: inclinacion ? "Columna orgánica inclinada" : "Columna orgánica", lugar: "piso" };
    }
    case "guirnalda_organica": {
      const R = RANGOS_ESTRUCTURA.guirnalda_organica;
      const largo = enRango(p.ancho_cm ?? 300, R.ancho_cm, "ancho_cm");
      const caida = enRango(p.caida_cm ?? 30, R.caida_cm, "caida_cm");
      const grosor = enRango(p.grosor_cm ?? 45, R.grosor_cm, "grosor_cm");
      const tramoDe = (g: number) => {
        const a = largo / 2 - g / 2;
        const puntos: Vec3[] = Array.from({ length: 11 }, (_, i) => { const x = -a + (2 * a * i) / 10; return { x: r1(x), y: r1(caida * ((x / a) ** 2 - 1)), z: 0 }; });
        return { ...formaGuirnalda({ id: "guirnalda", nombre: "Guirnalda orgánica", puntos, radioInicioCm: g / 2, radioFinCm: g / 2, mezcla: MEZCLA_GUIRNALDA }), tapas: { inicio: true, fin: true } };
      };
      const permitidos = tamanosPosibles(colores, p.tamanos, grosor * 0.8);
      comprobarCuerpo(medidaConTamanos((g) => ({ tramos: [tramoDe(g)], ...BASE_TRAMOS }), permitidos), grosor);
      return { pieza: piezaOrganica([tramoDe(grosor)], colores, permitidos, false, flores, semillaDe(largo, caida, grosor)), nombre: "Guirnalda orgánica", lugar: "pared" };
    }
    case "semiarco_organico": {
      const R = RANGOS_ESTRUCTURA.semiarco_organico;
      const ancho = enRango(p.ancho_cm ?? 150, R.ancho_cm, "ancho_cm");
      const alto = enRango(p.alto_cm ?? 200, R.alto_cm, "alto_cm");
      const grosor = enRango(p.grosor_cm ?? 60, R.grosor_cm, "grosor_cm");
      const tramoDe = (g: number) => formaSemiarco({ anchoCm: ancho, altoCm: alto, radioBaseCm: g / 2, radioPuntaCm: r1(g * 0.33), origen: { x: -ancho / 2, y: 0, z: 0 } });
      const permitidos = tamanosPosibles(colores, p.tamanos, grosor * 0.75);
      comprobarCuerpo(medidaConTamanos((g) => ({ tramos: [tramoDe(g)], ...BASE_TRAMOS }), permitidos), grosor);
      return { pieza: alAlto(piezaOrganica([tramoDe(grosor)], colores, permitidos, true, flores, semillaDe(ancho, alto, grosor)), alto, notas, techoCm), nombre: "Semiarco orgánico", lugar: "piso" };
    }
    case "aro_organico": {
      const R = RANGOS_ESTRUCTURA.aro_organico;
      const diametro = enRango(p.ancho_cm ?? p.alto_cm ?? 160, R.diametro_cm, "diámetro (ancho_cm)");
      const grosor = enRango(p.grosor_cm ?? 30, R.grosor_cm, "grosor_cm");
      const permitidos = tamanosPosibles(colores, p.tamanos, grosor * 0.9);
      const exterior = permitidos.includes("R-12") ? "R-12" : permitidos.find((f) => f !== "R-5") ?? permitidos[0]!;
      const aroDe = (g: number) => opcionesAroOrganico({ diametroCm: diametro, exterior: { formatoId: exterior, radioCm: 13 }, interior: { pesos: { "R-9": 0.75, "R-5": 0.25 }, radioCm: g / 2, adelanteCm: 6 }, colores, semilla: semillaDe(diametro, g) });
      comprobarCuerpo(medidaConTamanos(aroDe, permitidos), grosor);
      const base = aroDe(grosor);
      const opciones: OpcionesOrganico = { ...base, tramos: base.tramos.map((t) => ({ ...t, mezcla: mezclaCon(t.mezcla, permitidos) })), relleno: rellenoCon(permitidos), huecosFlores: flores ? 14 : 0, vista: { x: 0, y: 0, z: 1 } };
      return { pieza: { tipo: "organico", opciones, flores: flores ? FLORES() : null }, nombre: "Aro orgánico", lugar: "piso" };
    }
    case "marco_organico": {
      const R = RANGOS_ESTRUCTURA.marco_organico;
      const ancho = enRango(p.ancho_cm ?? 220, R.ancho_cm, "ancho_cm");
      const alto = enRango(p.alto_cm ?? 230, R.alto_cm, "alto_cm");
      const grosor = enRango(p.grosor_cm ?? 60, R.grosor_cm, "grosor_cm");
      const permitidos = tamanosPosibles(colores, p.tamanos, grosor * 0.75);
      const marcoDe = (g: number) => opcionesArcoRectangular({
        anchoEjeCm: ancho - g, altoEjeCm: alto - g / 2, radioEsquinaCm: 40, radioBaseCm: g / 2 + 4, radioPataCm: g / 2, radioArribaCm: g / 2, hueco: null,
        mezcla: { base: { "R-18": 0.15, "R-12": 0.65, "R-9": 0.2 }, pata: { "R-12": 0.7, "R-9": 0.3 }, arriba: { "R-18": 0.15, "R-12": 0.6, "R-9": 0.25 } }, colores, semilla: semillaDe(ancho, alto, g),
      });
      comprobarCuerpo(medidaConTamanos(marcoDe, permitidos), grosor);
      const base = marcoDe(grosor);
      const opciones: OpcionesOrganico = { ...base, tramos: base.tramos.map((t) => ({ ...t, mezcla: mezclaCon(t.mezcla, permitidos) })), relleno: rellenoCon(permitidos), huecosFlores: flores ? 14 : 0, vista: { x: 0, y: 0, z: 1 } };
      return { pieza: alAlto({ tipo: "organico", opciones, flores: flores ? FLORES() : null }, alto, notas, techoCm), nombre: "Marco orgánico", lugar: "piso" };
    }
  }
}

// ----------------------------------------------------------------------------------------------------------
// Ajustar una pieza orgánica que ya existe (de la biblioteca, de una idea o creada aquí)
// ----------------------------------------------------------------------------------------------------------

/** Alto, ancho y fondo de una pieza armada (cm), por su caja. */
export function medidasArmadas(pieza: Pieza): { altoCm: number; anchoCm: number; fondoCm: number } {
  const { min, max } = armarPieza(pieza).caja;
  return { altoCm: r0(max.y - min.y), anchoCm: r0(max.x - min.x), fondoCm: r0(max.z - min.z) };
}

type Organico = Extract<Pieza, { tipo: "organico" }>;

/** El grosor de un aro orgánico (el diámetro de su anillo de dentro, `opcionesAroOrganico`), o null si no es un aro: conserva su rango al cambiarlo. */
export function grosorDeAro(o: Pick<OpcionesOrganico, "tramos">): number | null {
  const dentro = o.tramos.find((t) => t.id === ANILLO_INTERIOR);
  return dentro ? 2 * Math.max(0, ...dentro.grosor.map((g) => g.radioCm)) : null;
}

/** El mayor radio de envoltura de los tramos (medio grosor). */
const radioMayor = (o: OpcionesOrganico) => Math.max(1, ...o.tramos.flatMap((t) => t.grosor.map((g) => g.radioCm)));

/**
 * Escala un orgánico: los recorridos a lo alto (y) y a lo ancho (x) para llegar al alto/ancho pedidos (los globos no
 * cambian de tamaño: cambia por dónde pasan) y el grosor de la envoltura. Un paso de corrección por el borde de los
 * globos, que no escala.
 */
export function escalarOrganico(pieza: Organico, p: { altoCm?: number; anchoCm?: number; grosorCm?: number }): Organico {
  let actual = pieza;
  if (p.grosorCm !== undefined) {
    const f = p.grosorCm / 2 / radioMayor(actual.opciones);
    actual = { ...actual, opciones: { ...actual.opciones, tramos: actual.opciones.tramos.map((t) => ({ ...t, grosor: t.grosor.map((g) => ({ ...g, radioCm: r1(g.radioCm * f) })) })) } };
  }
  if (p.altoCm === undefined && p.anchoCm === undefined) return actual;
  const puntos = actual.opciones.tramos.flatMap((t) => t.recorrido);
  const rango = (k: "x" | "y") => Math.max(1, Math.max(...puntos.map((q) => q[k])) - Math.min(...puntos.map((q) => q[k])));
  const medidas = medidasArmadas(actual);
  // Lo que la caja tiene de más sobre el recorrido (los globos del borde) no escala: se descuenta.
  const fy = p.altoCm === undefined ? 1 : Math.max(0.2, (p.altoCm - (medidas.altoCm - rango("y"))) / rango("y"));
  const fx = p.anchoCm === undefined ? 1 : Math.max(0.2, (p.anchoCm - (medidas.anchoCm - rango("x"))) / rango("x"));
  const escalar = (q: Vec3): Vec3 => ({ x: r1(q.x * fx), y: r1(q.y * fy), z: q.z });
  return {
    ...actual,
    opciones: {
      ...actual.opciones,
      tramos: actual.opciones.tramos.map((t) => ({ ...t, recorrido: t.recorrido.map(escalar) })),
      ...(actual.opciones.obstaculos ? { obstaculos: actual.opciones.obstaculos.map((o) => ({ ...o, base: escalar(o.base), altoCm: r1(o.altoCm * fy) })) } : {}),
    },
  };
}

/** Cambia lo pedido de un orgánico: medidas, grosor, colores con pesos (o solo pesos), tamaños de globo y flores. */
export function ajustarOrganico(pieza: Organico, p: PedidoEstructura, notas: string[]): Organico {
  // Con generador se cambia por sus parámetros (la silueta del trazo no se deforma).
  if (pieza.generador?.tipo === "trazo") {
    const pedidos = pedidosCon(p);
    const actuales = pieza.generador.trazo.colores;
    if (!pedidos && p.pesos && p.pesos.length !== actuales.length) fallar(`pesos tiene ${p.pesos.length} valores y la pieza ${actuales.length} colores (en el orden de ver_escena).`);
    const colores = pedidos ? coloresOrganicosPedidos(pedidos, p.pesos, notas) : p.pesos ? actuales.map((c, i) => ({ ...c, peso: r0(p.pesos![i]!) })) : undefined;
    return ajustarTrazo(pieza, pieza.generador, { ancho_cm: p.ancho_cm, alto_cm: p.alto_cm, grosor_cm: p.grosor_cm, tamanos: p.tamanos, racimos: p.racimos, flores: p.flores, follaje: p.follaje, ...(colores ? { colores } : {}) });
  }
  const R = RANGOS_ESTRUCTURA.organico;
  // El aro conserva su rango de grosor también al cambiarlo (más grueso ya no es un aro).
  const rangoGrosor = grosorDeAro(pieza.opciones) !== null ? RANGOS_ESTRUCTURA.aro_organico.grosor_cm : R.grosor_cm;
  const cambio = {
    ...(p.alto_cm !== undefined ? { altoCm: enRango(p.alto_cm, R.alto_cm, "alto_cm") } : {}),
    ...(p.ancho_cm !== undefined ? { anchoCm: enRango(p.ancho_cm, R.ancho_cm, "ancho_cm") } : {}),
    ...(p.grosor_cm !== undefined ? { grosorCm: enRango(p.grosor_cm, rangoGrosor, "grosor_cm") } : {}),
  };
  const antes = cuerpoDeOrganico(pieza.opciones);
  const medirConGrosor = (o: Organico) => (g: number) => cuerpoDeOrganico(escalarOrganico(o, { grosorCm: g }).opciones);
  // El grosor se comprueba antes de estirar (que arma la pieza para medirla): solo cambian los radios, así que es exacto y no arma nada.
  if (cambio.grosorCm !== undefined) comprobarCambioDeCuerpo(antes, medirConGrosor(pieza)(cambio.grosorCm), medirConGrosor(pieza), cambio.grosorCm);
  let o: Organico = escalarOrganico(pieza, cambio);
  // Estirada, se comprueba el cuerpo que de verdad queda; el grosor que cabría se busca sobre ese mismo recorrido.
  if (cambio.altoCm !== undefined || cambio.anchoCm !== undefined) comprobarCambioDeCuerpo(antes, cuerpoDeOrganico(o.opciones), medirConGrosor(o), cambio.grosorCm ?? 2 * radioMayor(o.opciones));
  const pedidos = pedidosCon(p);
  if (pedidos) o = { ...o, opciones: { ...o.opciones, colores: coloresOrganicosPedidos(pedidos, p.pesos, notas) } };
  else if (p.pesos) {
    if (p.pesos.length !== o.opciones.colores.length) fallar(`pesos tiene ${p.pesos.length} valores y la pieza ${o.opciones.colores.length} colores (en el orden de ver_escena).`);
    o = { ...o, opciones: { ...o.opciones, colores: o.opciones.colores.map((c, i) => ({ ...c, peso: r0(p.pesos![i]!) })) } };
  }
  if (p.tamanos?.length) {
    const permitidos = tamanosPosibles(o.opciones.colores, p.tamanos);
    o = { ...o, opciones: { ...o.opciones, tramos: o.opciones.tramos.map((t) => ({ ...t, mezcla: mezclaCon(t.mezcla, permitidos) })), relleno: rellenoCon(permitidos) } };
    // Los tamaños cambian cuántos globos lleva el cuerpo (solo R-5 lleva varias veces los de la mezcla de siempre): también cuentan para el presupuesto.
    comprobarCambioDeCuerpo(antes, cuerpoDeOrganico(o.opciones), medirConGrosor(o), 2 * radioMayor(o.opciones));
  }
  if (p.flores !== undefined) o = { ...o, flores: p.flores ? (o.flores ?? FLORES()) : null, opciones: { ...o.opciones, huecosFlores: p.flores ? Math.max(14, o.opciones.huecosFlores) : 0 } };
  return o;
}

// ----------------------------------------------------------------------------------------------------------
// Formas, letras, metalizados, murales, techo, árboles, pared de trenzas, globo suelto
// ----------------------------------------------------------------------------------------------------------

/** Colores (ya resueltos) → los de una forma: uno solo, o mezcla con los pesos pedidos. */
function coloresForma(codigos: readonly string[], pesos: readonly number[] | undefined): ColoresForma {
  if (codigos.length <= 1) return { codigos: [...codigos], patron: "un_color" };
  if (pesos && pesos.length !== codigos.length) fallar(`pesos tiene ${pesos.length} valores y colores ${codigos.length}: deben ir uno por color.`);
  return { codigos: [...codigos], patron: "mezcla", pesos: pesos ? pesos.map(r0) : codigos.map(() => 1), semilla: 11 };
}

const inflado = (formatoId: string) => (formatoPorId(formatoId) ?? fallar(`El formato «${formatoId}» no existe.`)).infladoDecoracionCm;

function crearForma(p: PedidoEstructura, notas: string[]): { pieza: Pieza; nombre: string; lugar: LugarPieza } {
  // Con texto y sin figura, la forma es ese número o esa letra rellenos de globos (de pie en el piso).
  const deTexto = p.texto !== undefined && p.figura === undefined;
  const figura = (p.figura ?? "corazon") as (typeof FIGURAS)[number];
  if (!(FIGURAS as readonly string[]).includes(figura)) fallar(`La figura «${p.figura}» no existe: ${FIGURAS.join(", ")}.`);
  const pedidos = pedidosCon(p) ?? ["rojo"];
  const resolver = (formatos: string[]) => [...new Set(pedidos.map((c) => resolverColorFlexible(c, formatos, notas)))];
  let forma: OpcionesForma;
  let lugar: LugarPieza = deTexto ? "piso" : "pared";
  if (figura === "esfera") {
    const formatoId = p.formato ?? "R-12";
    forma = { clase: "esfera", diametroCm: enRango(p.ancho_cm ?? p.alto_cm ?? 70, RANGOS_ESTRUCTURA.esfera.diametro_cm, "diámetro (ancho_cm)"), globo: { formatoId, infladoCm: inflado(formatoId) }, colores: coloresForma(resolver([formatoId]), p.pesos) };
    lugar = "piso";
  } else if (figura === "cono") {
    const formatoId = p.formato ?? "R-12";
    const infl = inflado(formatoId);
    forma = { clase: "cono", altoCm: enRango(p.alto_cm ?? 120, RANGOS_ESTRUCTURA.cono.alto_cm, "alto_cm"), tecnica: "anillos", formatoId, infladoBaseCm: infl, infladoPuntaCm: r0(infl * 0.68), globosBase: 6, globosPunta: 4, colores: coloresForma(resolver([formatoId]), p.pesos) };
    lugar = "piso";
  } else {
    const contorno: ContornoForma = deTexto
      ? contornoDeTexto(p.texto!, enRango(p.alto_cm ?? 120, RANGOS_ESTRUCTURA.forma.alto_cm, "alto_cm"), RANGOS_ESTRUCTURA.forma.ancho_cm[1])
      : { tipo: "predefinido", id: figura, anchoCm: enRango(p.ancho_cm ?? 120, RANGOS_ESTRUCTURA.forma.ancho_cm, "ancho_cm"), altoCm: enRango(p.alto_cm ?? p.ancho_cm ?? 110, RANGOS_ESTRUCTURA.forma.alto_cm, "alto_cm") };
    const tecnica = p.tecnica ?? "celdas";
    if (tecnica === "malla") {
      const formatoId = p.formato ?? "LOL-12";
      if (!formatoId.startsWith("LOL")) fallar("La malla va con Link-O-Loon: formato LOL-12 o LOL-6.");
      forma = { clase: "rellena", contorno, tecnica: { tipo: "malla", formatoId, infladoCm: inflado(formatoId), union: { infladoCm: 10, codigo: "005" } }, colores: coloresForma(resolver([formatoId]), p.pesos) };
    } else if (tecnica === "organico") {
      const codigos = coloresOrganicosPedidos(pedidos, p.pesos, notas);
      forma = { clase: "rellena", contorno, tecnica: { tipo: "organico", radioCm: contorno.tipo === "texto" ? contorno.grosorCm / 2 : 16, mezcla: { "R-12": 1, "R-5": 2 }, semilla: 9 }, colores: { codigos: codigos.map((c) => c.codigo), patron: codigos.length > 1 ? "mezcla" : "un_color", ...(codigos.length > 1 ? { pesos: codigos.map((c) => c.peso), semilla: 9 } : {}) } };
    } else if (tecnica === "celdas") {
      const formatoId = p.formato ?? "R-9";
      forma = { clase: "rellena", contorno, tecnica: { tipo: "celdas", formatoId, infladoCm: inflado(formatoId), celda: "tresbolillo" }, colores: coloresForma(resolver([formatoId]), p.pesos) };
    } else return fallar(`Una forma se rellena con celdas, malla u organico (no «${tecnica}»).`);
  }
  const nombre = figura === "esfera" ? "Esfera de globos" : figura === "cono" ? "Cono de globos" : deTexto ? `«${normalizarTexto(p.texto!.trim())}» de globos` : `${CONTORNOS_PREDEFINIDOS.find((c) => c.id === figura)?.nombre ?? "Forma"} de globos`;
  return { pieza: { tipo: "forma", forma }, nombre, lugar };
}

function crearLetras(p: PedidoEstructura, notas: string[]): { pieza: Pieza; nombre: string; lugar: LugarPieza } {
  const texto = p.texto?.trim() || fallar("Para letras falta texto (lo que dicen: «FELIZ», «ANA», «15»).");
  if (texto.length > 24) fallar("El texto de las letras va hasta 24 caracteres.");
  const tecnica = (p.tecnica ?? "cuartetos") as TecnicaLetras;
  const DATOS: Record<TecnicaLetras, { formatoId: string; infladoCm: number; grosorCm: number }> = {
    cuartetos: { formatoId: "R-5", infladoCm: 11, grosorCm: 26 }, hilera: { formatoId: "R-5", infladoCm: 9, grosorCm: 9 }, tubito: { formatoId: "T-260", infladoCm: 5, grosorCm: 10 },
  };
  const d = DATOS[tecnica] ?? fallar(`Las letras se arman con cuartetos, hilera o tubito (no «${p.tecnica}»).`);
  const formatoId = p.formato && tecnica !== "tubito" ? p.formato : d.formatoId;
  const infladoCm = formatoId === d.formatoId ? d.infladoCm : inflado(formatoId);
  const pedidos = pedidosCon(p) ?? ["dorado"];
  const colores = [...new Set(pedidos.map((c) => resolverColorFlexible(c, [formatoId], notas)))];
  const letras: OpcionesLetras = {
    texto, altoCm: enRango(p.alto_cm ?? 60, RANGOS_ESTRUCTURA.letras.alto_cm, "alto_cm"), grosorCm: tecnica === "cuartetos" ? r0(infladoCm * 2.4) : d.grosorCm, disposicion: "fila", tecnica, formatoId, infladoCm,
    colores, patron: colores.length > 1 ? "por_letra" : "un_color",
  };
  return { pieza: { tipo: "letras", letras }, nombre: `Letras «${texto}»`, lugar: "pared" };
}

function crearMetalizado(p: PedidoEstructura, notas: string[]): { pieza: Pieza; nombre: string; lugar: LugarPieza } {
  const texto = p.texto?.trim().toUpperCase();
  const tipo = p.forma_metalizado ?? (texto ? (/^\d$/.test(texto) ? "numero" : texto.length === 1 ? "letra" : "letras") : "estrella");
  let forma: FormaMetalizado;
  if (tipo === "numero" || tipo === "letra" || tipo === "letras") {
    const t = texto || fallar(`Un metalizado de ${tipo} necesita texto («5», «A», «HBD»).`);
    const raros = [...t].filter((c) => !CARACTERES_METALIZADO.includes(c));
    if (raros.length) fallar(`Los metalizados solo traen 0–9 y A–Z (no «${raros.join("")}»).`);
    forma = tipo === "numero" && /^\d$/.test(t) ? { tipo: "numero", valor: Number(t) } : tipo === "letra" && t.length === 1 ? { tipo: "letra", valor: t } : { tipo: "letras", texto: t };
  } else if ((FORMAS_METALIZADO as readonly string[]).includes(tipo)) forma = { tipo: tipo as "corazon" | "estrella" | "redondo" | "luna" | "flor" | "nube" };
  else return fallar(`El metalizado va en forma de ${FORMAS_METALIZADO.join(", ")}.`);
  const porDefecto = forma.tipo === "numero" ? 34 : forma.tipo === "letra" || forma.tipo === "letras" ? 16 : forma.tipo === "flor" ? 27 : 18;
  const pulgadas = p.pulgadas ?? porDefecto;
  if (!(PULGADAS_METALIZADO as readonly number[]).includes(pulgadas)) fallar(`Los metalizados vienen en ${PULGADAS_METALIZADO.join(", ")} pulgadas.`);
  let color: ColorMetalizado = "oro";
  if (p.color_metalizado) {
    if (!(COLORES_FOIL as readonly string[]).includes(p.color_metalizado)) fallar(`Colores de foil: ${COLORES_FOIL.join(", ")}.`);
    color = p.color_metalizado as ColorMetalizado;
  } else if (p.colores?.[0]) {
    const ref = referenciaDePedido(p.colores[0]) ?? fallar(`No encontré el color «${p.colores[0]}».`);
    color = metalizadoMasParecido(ref.codigo);
    notas.push(`foil ${COLORES_METALIZADO[color].nombre} (el más parecido a ${p.colores[0]})`);
  }
  return { pieza: { tipo: "metalizado", metalizado: { forma, pulgadas, color } }, nombre: `Metalizado ${texto ?? tipo} ${COLORES_METALIZADO[color].nombre.toLowerCase()}`, lugar: "piso" };
}

/** Un modelo de partida (mural, techo, árbol), recoloreado con la paleta pedida si viene. */
function crearDeModelo(tipo: "mural" | "techo" | "arbol", p: PedidoEstructura, notas: string[]): { pieza: Pieza; nombre: string; lugar: LugarPieza } {
  const lista = tipo === "mural" ? MURALES_PREDEFINIDOS.map((m) => ({ id: m.id, nombre: m.nombre, pieza: { tipo: "mural", mural: m.mural } as Pieza }))
    : tipo === "techo" ? TECHOS_PREDEFINIDOS.map((t) => ({ id: t.id, nombre: t.nombre, pieza: { tipo: "techo", techo: t.techo } as Pieza }))
      : ARBOLES_PREDEFINIDOS.map((a) => ({ id: a.id, nombre: a.nombre, pieza: { tipo: "arbol_globos", arbol: a.arbol } as Pieza }));
  const elegido = p.modelo ? lista.find((m) => m.id === p.modelo) ?? fallar(`Modelos de ${tipo}: ${lista.map((m) => m.id).join(", ")}.`) : lista[0]!;
  let pieza: Pieza = structuredClone(elegido.pieza);
  if (pieza.tipo === "arbol_globos" && p.alto_cm !== undefined) pieza = { ...pieza, arbol: { ...pieza.arbol, tronco: { ...pieza.arbol.tronco, altoCm: enRango(p.alto_cm, RANGOS_ESTRUCTURA.arbol.alto_cm, "alto_cm") } } };
  const pedidos = pedidosCon(p);
  if (pedidos) pieza = recolorearConPaleta(pieza, pedidos, notas, "uso").pieza;
  return { pieza, nombre: elegido.nombre, lugar: tipo === "mural" ? "pared" : tipo === "techo" ? "techo" : "piso" };
}

function crearParedTrenzas(p: PedidoEstructura, notas: string[]): { pieza: Pieza; nombre: string; lugar: LugarPieza } {
  const R = RANGOS_ESTRUCTURA.pared_trenzas;
  const o = structuredClone(PARED_TRENZAS_INICIAL);
  if (p.ancho_cm !== undefined) o.anchoCm = enRango(p.ancho_cm, R.ancho_cm, "ancho_cm");
  if (p.alto_cm !== undefined) o.altoCm = enRango(p.alto_cm, R.alto_cm, "alto_cm");
  const pedidos = pedidosCon(p);
  if (pedidos) {
    o.colores = [...new Set(pedidos.map((c) => resolverColorFlexible(c, [o.grande.formatoId, o.chico.formatoId], notas)))];
    o.patron = o.colores.length === 1 ? "un_color" : "franjas";
  }
  return { pieza: { tipo: "pared_trenzas", opciones: o }, nombre: "Pared de trenzas", lugar: "pared" };
}

function crearGlobo(p: PedidoEstructura, notas: string[]): { pieza: Pieza; nombre: string; lugar: LugarPieza } {
  const formatoId = p.formato ?? "R-24";
  const infladoCm = inflado(formatoId);
  const codigo = resolverColorFlexible(conAcabado(p.colores?.[0] ?? "dorado", p.acabado), [formatoId], notas);
  return { pieza: { tipo: "globo", formatoId, infladoCm, codigo }, nombre: `Globo ${formatoId}`, lugar: "piso" };
}

/** Crea una estructura nueva de uno de los `TIPOS_ESTRUCTURA` con lo pedido; error claro si algo no vale. */
/** `techoCm`: lo que cabe de alto donde va (la sala), para estirar una pieza orgánica pesada que se pasa de ahí. */
export function crearEstructura(tipo: TipoEstructura, p: PedidoEstructura, notas: string[], techoCm?: number): { pieza: Pieza; nombre: string; lugar: LugarPieza } {
  switch (tipo) {
    case "columna_organica":
    case "guirnalda_organica":
    case "semiarco_organico":
    case "aro_organico":
    case "marco_organico":
      return crearOrganica(tipo, p, notas, techoCm);
    case "trazo_organico": {
      const pedidos = pedidosCon(p);
      const { pieza, nombre } = crearTrazo(p, coloresOrganicosPedidos(pedidos ?? [...PALETA_ORGANICA], pedidos ? p.pesos : [45, 25, 15, 15], notas));
      return { pieza, nombre, lugar: pieza.tipo === "organico" && esColumnaTrazo(pieza.generador?.trazo.silueta) ? "piso" : "pared" };
    }
    case "pared_trenzas": return crearParedTrenzas(p, notas);
    case "forma": return crearForma(p, notas);
    case "letras": return crearLetras(p, notas);
    case "metalizado": return crearMetalizado(p, notas);
    case "mural":
    case "techo":
    case "arbol":
      return crearDeModelo(tipo, p, notas);
    case "globo": return crearGlobo(p, notas);
  }
}
