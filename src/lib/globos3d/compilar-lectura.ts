import { SALA_INICIAL, idNuevo, type Colocacion, type Escena, type NodoEscena } from "./escena";
import type { Pieza } from "./piezas";
import type { ElementoEscenografia } from "./escenografia";
import { crearEstructura } from "./herramientas-escena-estructuras";
import { PULGADAS_METALIZADO, PULGADA_CM } from "./metalizados";
import { floresLeidas } from "./herramientas-escena-trazo";
import { piezaDeGenerador } from "./generadores-organicos";
import { cajaTrazo, puntosDeSilueta, type SiluetaTrazo } from "./trazo-organico";
import { formatoPorDiametro, grosorMinimoDePesos, pesosDeLectura, pesosDeTramo, traeMezcla } from "./mezcla-lectura";
import { piezaConMezcla } from "./relleno-por-mezcla";
import { FONDO_SALA_FOTO_CM, pisoDeLectura, profundidadEnElPiso } from "./encuadre-foto";
import { PROFUNDIDAD_DE_LA_FOTO_CM } from "./proyeccion-foto";
import { columnaClasica } from "./escenas-presets";
import { decoracionPredefinida } from "./figuras";
import { reemplazarColor } from "./recolorear";
import { TELONES_DE_DIAMETRO, arcosChiara, cortina, entradaDeCatalogo, esTelon, letrero, mediaLuna, panelRedondo, pedestales } from "./fondos-escenografia";
import { mesaConMantel, paredLentejuelas, tapete } from "./escenografia";
import { conTextoPieza } from "./mobiliario-pieza";
import { acabadoRotuloLeido, avisoDeTexto, limpiarTexto } from "./rotulos";
import { mesaLeida, mobiliarioLeido, tintaLeida, type MedidaLeida, type MesaLeida } from "./compilar-mobiliario";
import type { ColorLeido, LecturaFoto, PiezaLeida } from "./lectura-foto";
import { codigoDeColor, fijosDeAnclas, paletaDeLectura } from "./colores-lectura";
import { recogerPuntas } from "./puntas-lectura";
import { apoyoDeRacimo } from "./apoyo-racimo";
import { colocarCuerpo } from "./fondos-en-el-piso";
import { montonesAlPie } from "./montones-al-pie";
import { colgadoDelanteDePaneles, letrerosDelanteDeGlobos } from "./colgado-delante";

export { codigoDeColor } from "./colores-lectura";

/**
 * **Lectura → escena**, sin ningún modelo: cada pieza leída de la foto (`lectura-foto.ts`) se arma con el generador del
 * taller que le corresponde, a la escala de la foto, y se coloca donde estaba. Determinista: la misma lectura da la
 * misma escena (y se puede probar).
 *
 * - Escala: `altoImagenCm` cm por alto de imagen; x desde el centro de la imagen, y desde la línea del piso (`pisoY`;
 *   si no se ve, el punto más bajo de lo leído).
 * - Colores: por su nombre de decorador con su acabado («azul marino», «dorado» + cromado → Reflex) en la tabla
 *   Sempertex; si el nombre no se encuentra, el más parecido por el hex medido. El confeti va en Cristal (390).
 * - Profundidad (z): los fondos pegados a la pared, las guirnaldas en la pared, las columnas un poco delante y lo de
 *   piso (mesa, pedestales, globos sueltos) más adelante.
 * Lo que no es del taller (`otro`) no se arma: queda en `omitidas`.
 */
export type EscenaCompilada = { escena: Escena; notas: string[]; omitidas: string[] };

const r0 = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;
/** Un foil (letras, números) cuelga por delante de la guirnalda y no pegado a la pared: así se ve entero, como en las fotos. */
const FOIL_DELANTE_DE_LA_PARED_CM = 60;
/** Los fondos de la lectura que admiten un nombre en cursiva (el letrero conserva su texto impreso). */
const ADMITEN_ROTULO = new Set(["panel_redondo", "arcos_chiara", "lentejuelas"]);

/**
 * ¿El fondo se para en el piso por delante de la pared (muebles, pedestales, mesa, tapete)? Los paneles y la pared de lentejuelas
 * (de piso, pegados a la pared) fijan la escala de la foto y los de la pared o el aire no tienen pie en el piso.
 */
function seApoyaEnElPiso(q: Extract<PiezaLeida, { tipo: "fondo" }>): boolean {
  const e = entradaDeCatalogo(q.id);
  if (!e || e.lugar !== "piso" || e.flotaCm !== undefined) return false;
  // Un telón (aro, arco, marco con tela, biombo) va contra la pared aunque su pie se vea más abajo: la profundidad del pie
  // solo vale para lo que se para delante (pedestales, mesas, sillas, un jarrón, una lámpara).
  if ("telon" in e && e.telon) return false;
  return e.clase === "mueble" || e.retiroCm !== undefined;
}

/** Un extremo de guirnalda a esta fracción del borde de la foto sigue fuera del encuadre: no se recoge (la foto la corta). */
const BORDE_DE_LA_FOTO = 0.02;

/** Un montón de piso con el pie a más de esto sobre la línea del piso está en el aire (colgado de un aro), no en el piso. */
const RACIMO_ALZADO_CM = 20;
/** Un pie a más de esto sobre la línea del piso está tapado (por los pedestales, por los globos): el telón no flota. */
const PIE_TAPADO_CM = 10;

/**
 * ¿El fondo es un telón de piso (marco con tela, pared de lentejuelas, arcos, aro) del que la foto enseña solo la parte de arriba?
 * Se para en el piso aunque su pie quede tapado: lo que la foto mide con seguridad es dónde acaba por ARRIBA, así que se
 * prolonga hacia el piso (el alto leído es lo visible, no todo el telón) y no se baja entero a ras de piso con su tope más abajo.
 */
function telonConPieTapado(q: Extract<PiezaLeida, { tipo: "fondo" }>, pieCm: number): boolean {
  const e = entradaDeCatalogo(q.id);
  return pieCm > PIE_TAPADO_CM && esTelon(q.id) && e?.lugar === "piso" && e.flotaCm === undefined && !TELONES_DE_DIAMETRO.has(q.id);
}

const SILUETA_COLUMNA: Readonly<Record<string, SiluetaTrazo>> = { recta: "columna_recta", racimos: "columna_racimos", s: "columna_s", inclinada: "columna_inclinada" };

/** El diámetro de un pedestal (cilindro) de fiesta típico: con él se cuentan los que caben en lo leído si no dice cuántos. */
const DIAMETRO_PEDESTAL_TIPICO_CM = 45;
/** Lo más que se deduce del ancho (los leídos uno por color o con `cantidad` van todos). */
const MAXIMO_PEDESTALES = 5;

/** Cuánto más grueso que el mínimo se deja el cuerpo: las siluetas con nombre afinan las puntas y el motor solo pone un formato donde cabe. */
const HOLGURA_DEL_CUERPO = 1.2;

/**
 * Los puntos de una guirnalda leída (cm, en el plano de la pared) con el grosor que necesitan sus globos grandes en lo más
 * grueso. Un punto con mezcla propia (`pesos`) se mide con la suya: el tramo de gigantes pide más cuerpo que el de chicos.
 */
function engrosarParaGrandes<T extends { x: number; y: number; grosor: number; pesos?: Readonly<Record<string, number>> }>(puntos: readonly T[], minimo: number | null, notas: string[]): readonly T[] {
  const maximo = Math.max(...puntos.map((q) => q.grosor));
  const nuevos = puntos.map((q) => {
    const propio = q.pesos ? grosorMinimoDePesos(q.pesos) : minimo;
    if (!propio) return q;
    const meta = Math.min(140, Math.ceil(propio * HOLGURA_DEL_CUERPO));
    // Sin mezcla propia solo se engrosa lo más grueso (las puntas finas quedan); con ella, el tramo que la pide.
    const toca = q.pesos ? q.grosor < meta : q.grosor >= maximo * 0.6 && q.grosor < meta;
    return toca ? { ...q, grosor: meta } : q;
  });
  if (nuevos.some((q, i) => q !== puntos[i])) notas.push(`El cuerpo medía ${Math.round(maximo)} cm en lo más grueso y los globos grandes de la foto piden más: se engrosó donde hacía falta.`);
  return nuevos;
}

export function compilarLectura(leida: LecturaFoto): EscenaCompilada {
  const notas: string[] = [], omitidas: string[] = [];
  const l = montonesAlPie(leida, notas);
  const H = l.escala.altoImagenCm;
  const piso = pisoDeLectura(l);
  const X = (x: number) => r1((x - 0.5) * l.aspecto * H);
  const Y = (y: number) => r1(Math.max(0, (piso - y) * H));
  const cm = (f: number) => r1(f * H);

  const xs = l.piezas.flatMap((p) => ("puntos" in p ? p.puntos.map((q) => q.x) : "x" in p ? [p.x] : "x1" in p ? [p.x1, p.x2] : []));
  const ancho = Math.max(500, r0((Math.max(0.5, ...xs.map((x) => Math.abs(x - 0.5))) * 2 * l.aspecto * H) + 200));
  const altoMax = Math.max(0, ...l.piezas.flatMap((p) => ("puntos" in p ? p.puntos.map((q) => Y(q.y) + cm(q.grosor) / 2) : "yArriba" in p ? [Y(p.yArriba)] : "y" in p ? [Y(p.y) + 30] : [])));
  const fondo = FONDO_SALA_FOTO_CM;
  let escena: Escena = { sala: { ...SALA_INICIAL, anchoCm: ancho, fondoCm: fondo, altoCm: Math.max(280, r0(altoMax + 50)), tonos: { ...SALA_INICIAL.tonos, paredes: l.sala.pared, piso: l.sala.piso }, mostrar: { ...SALA_INICIAL.mostrar } }, nodos: [] };
  const muro = -fondo / 2;
  const poner = (base: string, nombre: string, pieza: Pieza, colocacion: Colocacion) => {
    const id = idNuevo(escena, base);
    const nodo: NodoEscena = { id, nombre, pieza, colocacion };
    escena = { ...escena, nodos: [...escena.nodos, nodo] };
    return id;
  };

  l.piezas.forEach((p, i) => {
    try {
      compilarPieza(p, i);
      // Lo que el lector dice que no pudo leer bien o no encaja llega a quien mira las notas (antes se perdía).
      if ("nota" in p && p.nota) notas.push(`Pieza ${i + 1} (${p.tipo}): ${p.nota}`);
    } catch (error) {
      omitidas.push(`Pieza ${i + 1} (${p.tipo}): ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  function compilarPieza(p: PiezaLeida, i: number) {
    switch (p.tipo) {
      case "guirnalda_organica": {
        const pesos = pesosDeLectura(p, H);
        const medidos = p.puntos.map((q) => {
          const tramo = pesosDeTramo(p.mezcla, q.mezcla, H);
          return { x: X(q.x), y: Y(q.y), grosor: Math.min(140, Math.max(20, cm(q.grosor))), enBorde: q.x <= BORDE_DE_LA_FOTO || q.x >= 1 - BORDE_DE_LA_FOTO, ...(tramo ? { pesos: tramo } : {}) };
        });
        const puntos = recogerPuntas(engrosarParaGrandes(medidos, grosorMinimoDePesos(pesos), notas)).map(({ enBorde: _, ...q }) => q);
        const x0 = r1((Math.min(...puntos.map((q) => q.x)) + Math.max(...puntos.map((q) => q.x))) / 2);
        const fijos = fijosDeAnclas(p, H, notas).map((f) => ({ ...f, x: r1(X(f.x) - x0), y: r1(Y(f.y)) }));
        const trazo = { puntos: puntos.map((q) => ({ ...q, x: r1(q.x - x0) })), mezcla: pesos, colores: paletaDeLectura(p, H, notas), racimos: p.racimos, semilla: 11 + i, ...(fijos.length ? { fijos } : {}) };
        const { flores, notas: notasFollaje } = p.follaje?.length ? floresLeidas(p.follaje) : { flores: null, notas: [] };
        notas.push(...notasFollaje.map((n) => `Pieza ${i + 1} (guirnalda_organica): ${n}`));
        const largo = puntos.slice(1).reduce((s, q, k) => s + Math.hypot(q.x - puntos[k]!.x, q.y - puntos[k]!.y), 0);
        const huecos = Math.max(4, Math.min(30, r0(largo / 45)));
        const pieza = traeMezcla(p) ? piezaConMezcla(trazo, pesos, flores, huecos, p.mezcla).pieza : piezaDeGenerador({ tipo: "trazo", trazo }, flores, huecos);
        poner("guirnalda-organica", "Guirnalda orgánica", pieza, { en: "pared", pared: "fondo", aLoLargoCm: x0, alturaCm: r0(cajaTrazo(trazo).minY) });
        return;
      }
      case "racimo_piso": {
        // Un montón en el piso por delante: su pie, más abajo que la línea del piso, dice cuánto más cerca de la cámara
        // está (y por cuánto se ve más grande de lo que es).
        // Sobre una mesa o un pedestal (su tope, en la foto, a la altura del pie del montón) se asienta encima, y con el tamaño y la
        // profundidad con que se arma ese mueble: su factor manda (el pie del montón, sobre el tope, no dice su cercanía).
        const apoyo = apoyoDeRacimo(l, p, muro, { X, Y, cm });
        const { delanteCm, factor } = apoyo ? { delanteCm: 0, factor: apoyo.factor } : profundidadEnElPiso(l, p.yPie);
        const ancho = Math.max(30, cm(p.ancho) * factor), alto = Math.max(25, (p.yPie - p.yArriba) * H * factor);
        const g = Math.min(140, Math.max(25, Math.min(alto, ancho)));
        const pesos = pesosDeLectura(p, H);
        // Un montón es una columna de racimos baja y ancha (cerrada arriba, abierta al piso).
        const puntos = puntosDeSilueta("columna_racimos", { anchoCm: r0(Math.max(g, ancho)), altoCm: r0(Math.max(alto, g * 0.8)), grosorCm: r0(g) });
        // Sus gigantes y grandes, uno por uno: x desde el centro del montón y y desde su pie, a la escala con que se ve de cerca.
        const fijos = fijosDeAnclas(p, H, notas).map((f) => ({ ...f, x: r1((f.x - p.x) * l.aspecto * H * factor), y: r1(Math.max(0, (p.yPie - f.y) * H * factor)), ...(f.infladoCm ? { infladoCm: r0(f.infladoCm * factor) } : {}) }));
        const trazo = { silueta: "columna_racimos" as const, puntos, mezcla: pesos, colores: paletaDeLectura({ colores: p.colores, mezcla: p.mezcla, coloresPorEscalon: p.coloresPorEscalon }, H, notas), racimos: p.racimos, semilla: 31 + i, ...(fijos.length ? { fijos } : {}) };
        const pieza = traeMezcla(p) ? piezaConMezcla(trazo, pesos, null, 0, p.mezcla).pieza : piezaDeGenerador({ tipo: "trazo", trazo });
        // Si su pie se ve más arriba de la línea del piso, no se apoya en él (un montón colgado de un aro, prendido a la estructura): va a esa altura, en el plano de la decoración.
        const alzadoCm = Y(p.yPie);
        if (alzadoCm > RACIMO_ALZADO_CM && !apoyo) notas.push(`Pieza ${i + 1} (racimo_piso): su pie se ve ${Math.round(alzadoCm)} cm sobre la línea del piso y no hay mesa ni pedestal debajo: se cuelga en el aire, en el plano de la decoración.`);
        if (apoyo) notas.push(`Pieza ${i + 1} (racimo_piso): su pie queda a la altura del tope de ${apoyo.nombre}: se asienta encima.`);
        poner("racimo-piso", "Racimo de piso", pieza, apoyo
          ? { en: "libre", xCm: apoyo.xCm, yCm: apoyo.yCm, zCm: apoyo.zCm, giroGrados: 0 }
          : alzadoCm > RACIMO_ALZADO_CM
            ? { en: "libre", xCm: X(p.x), yCm: alzadoCm, zCm: muro + PROFUNDIDAD_DE_LA_FOTO_CM, giroGrados: 0 }
            : { en: "piso", xCm: r1(X(p.x) * factor), zCm: r0(muro + PROFUNDIDAD_DE_LA_FOTO_CM + delanteCm - g / 2), giroGrados: 0 });
        return;
      }
      case "columna_organica": {
        const silueta = SILUETA_COLUMNA[p.forma]!;
        const alto = Math.max(60, Y(p.yArriba) - Y(p.yBase));
        const medido = Math.min(140, Math.max(25, cm(p.grosor)));
        const pesos = pesosDeLectura(p, H);
        const minimo = grosorMinimoDePesos(pesos);
        const meta = minimo ? Math.min(140, Math.ceil(minimo * HOLGURA_DEL_CUERPO)) : 0;
        const grosor = Math.max(medido, meta);
        if (grosor !== medido) notas.push(`La columna medía ${Math.round(medido)} cm de grosor y los globos grandes de la foto piden ${meta} cm: se engrosó.`);
        const trazo = { silueta, puntos: puntosDeSilueta(silueta, { anchoCm: Math.max(grosor, cm(p.ancho)), altoCm: alto, grosorCm: grosor }), mezcla: pesos, colores: paletaDeLectura({ colores: p.colores, mezcla: p.mezcla }, H, notas), racimos: p.racimos, semilla: 21 + i };
        const pieza = traeMezcla(p) ? piezaConMezcla(trazo, pesos, null, 14, p.mezcla).pieza : piezaDeGenerador({ tipo: "trazo", trazo });
        poner("columna-organica", p.forma === "recta" ? "Columna irregular" : "Columna de forma libre", pieza, { en: "piso", xCm: X(p.x), zCm: muro + 45, giroGrados: 0 });
        return;
      }
      case "columna_clasica": {
        const codigos = p.colores.map((c) => codigoDeColor(c, ["R-12"], notas));
        poner("columna", "Columna clásica", columnaClasica(Math.max(40, Math.min(400, Y(p.yArriba) - Y(p.yBase))), codigos), { en: "piso", xCm: X(p.x), zCm: muro + 40, giroGrados: 0 });
        return;
      }
      case "guirnalda_clasica": {
        const codigos = p.colores.map((c) => codigoDeColor(c, ["R-12"], notas));
        const largo = Math.max(100, Math.abs(X(p.x2) - X(p.x1)));
        const patron = codigos.length >= 4 ? "espiral" : codigos.length === 2 ? "dos_colores" : "un_color";
        const pieza: Pieza = { tipo: "guirnalda", guirnalda: { formatoId: "R-12", infladoCm: 25, patron, colores: codigos.length >= 4 ? codigos.slice(0, 4) : codigos.slice(0, patron === "dos_colores" ? 2 : 1), anchoCm: r0(largo), caidaCm: p.caida ? cm(p.caida) : 0, recorrido: null } };
        poner("guirnalda", "Guirnalda clásica", pieza, { en: "pared", pared: "fondo", aLoLargoCm: r1((X(p.x1) + X(p.x2)) / 2), alturaCm: Math.max(0, r0(Y(p.y) - 15)) });
        return;
      }
      case "globo": {
        // Un globo suelto en el piso está tan cerca de la cámara como lo dice su pie (su borde de abajo): el que se ve más abajo que la línea del piso
        // está por delante de la decoración y se ve más grande de lo que es.
        const { delanteCm, factor } = p.en === "piso" ? profundidadEnElPiso(l, p.y + p.diametro / 2) : { delanteCm: 0, factor: 1 };
        const f = formatoPorDiametro(cm(p.diametro) * factor);
        const codigo = codigoDeColor(p.colores[0]!, [f.formatoId], notas);
        const pieza: Pieza = { tipo: "globo", formatoId: f.formatoId, infladoCm: f.infladoCm, codigo };
        poner(`globo-${f.formatoId.toLowerCase()}`, `Globo ${f.formatoId}`, pieza, p.en === "piso"
          ? { en: "piso", xCm: r1(X(p.x) * factor), zCm: r0(delanteCm > 0 ? muro + PROFUNDIDAD_DE_LA_FOTO_CM + delanteCm - f.infladoCm / 2 : muro + 110), giroGrados: 0 }
          : { en: "libre", xCm: X(p.x), yCm: Y(p.y), zCm: muro + 70, giroGrados: 0 });
        return;
      }
      case "ramo_helio": {
        // Un ramo: globos de 18" en abanico entre la base y lo más alto, cada uno suelto en el aire.
        const base = Y(p.yBase), arriba = Y(p.yArriba), x = X(p.x);
        for (let k = 0; k < p.cantidad; k++) {
          const c = p.colores[k % p.colores.length]!;
          const codigo = codigoDeColor(c, ["R-18"], notas);
          const t = p.cantidad === 1 ? 0.5 : k / (p.cantidad - 1);
          const fila = k % 3;
          poner("ramo", `Ramo de helio · globo ${k + 1}`, { tipo: "globo", formatoId: "R-18", infladoCm: 42, codigo },
            { en: "libre", xCm: r1(x + (t - 0.5) * 70 + (fila - 1) * 8), yCm: r1(arriba - 25 - fila * 30 - Math.abs(t - 0.5) * 30), zCm: muro + 90 + fila * 10, giroGrados: 0 });
        }
        if (arriba - base > 60) notas.push("El ramo de helio va sin las cintas ni el peso de la base.");
        return;
      }
      case "decoracion": {
        const decoracion = decoracionPredefinida(p.id);
        const color = codigoDeColor(p.colores[0]!, ["R-5"], notas);
        // Las del catálogo son doradas (970): toman el color leído.
        const conColor = reemplazarColor(decoracion, "970", color).valor;
        for (let k = 0; k < p.cantidad; k++) {
          poner(p.id.replace(/_/g, "-"), p.id === "orbe_flecos_dorado" ? "Orbe con flecos" : "Racimo de globitos",
            { tipo: "decoracion", decoracion: conColor, ...(p.id.startsWith("orbe") ? { deFrente: true } : {}) },
            { en: "libre", xCm: r1(X(p.x) + k * 25), yCm: Y(p.y), zCm: muro + (p.id.startsWith("orbe") ? 110 : 75), giroGrados: 0 });
        }
        return;
      }
      case "metalizado": {
        const alto = cm(p.alto);
        const pulgadas = PULGADAS_METALIZADO.reduce((m, t) => (Math.abs(t * PULGADA_CM - alto) < Math.abs(m * PULGADA_CM - alto) ? t : m));
        if (p.cursiva) notas.push(`«${p.texto}» va en letras sueltas: el globo metalizado en letra cursiva no está en el catálogo.`);
        // Cada palabra es una pieza (los metalizados no traen el espacio), una junto a otra y centradas en x.
        const palabras = p.texto.split(/\s+/).filter(Boolean);
        const anchos = palabras.map((w) => w.length * alto * 0.62);
        const total = anchos.reduce((s, a) => s + a, 0) + (palabras.length - 1) * alto * 0.4;
        let desde = X(p.x) - total / 2;
        palabras.forEach((w, k) => {
          const forma = w.length > 1 ? "letras" : /\d/.test(w) ? "numero" : "letra";
          const hecho = crearEstructura("metalizado", { texto: w, forma_metalizado: forma, pulgadas, colores: [p.colores[0]!.nombre] }, notas);
          poner("metalizado", hecho.nombre, hecho.pieza, { en: "libre", xCm: r1(desde + anchos[k]! / 2), yCm: Math.max(0, r0(Y(p.y) - alto / 2)), zCm: muro + FOIL_DELANTE_DE_LA_PARED_CM, giroGrados: 0 });
          desde += anchos[k]! + alto * 0.4;
        });
        return;
      }
      case "fondo": {
        const medidaDe = (q: typeof p): MedidaLeida => {
          // Lo apoyado en el piso cuyo pie se ve más abajo que la línea del piso está más cerca de la cámara: se ve más grande de lo que es.
          const { delanteCm, factor } = seApoyaEnElPiso(q) ? profundidadEnElPiso(l, q.yBase) : { delanteCm: 0, factor: 1 };
          const alto = cm(q.alto) * factor + (telonConPieTapado(q, Y(q.yBase)) ? Y(q.yBase) : 0);
          return { anchoCm: r1(cm(q.ancho) * factor), altoCm: r1(alto), xCm: r1(X(q.x) * factor), yBaseCm: Y(q.yBase), muroZ: muro, ...(delanteCm > 0 ? { zFrenteCm: muro + PROFUNDIDAD_DE_LA_FOTO_CM + delanteCm } : {}) };
        };
        // Un juego de pedestales detectado cuerpo a cuerpo: cada uno en su sitio, con su diámetro y su alto, y la profundidad que dice su pie (el de delante se ve más grande).
        if (p.id === "pedestales" && p.cajas?.length) {
          p.cajas.forEach((c, k) => {
            const hecho = colocarCuerpo(l, c, muro, { X, Y, cm });
            const color = p.colores[k % p.colores.length]!;
            const elementos = pedestales({ cilindros: [{ diametroCm: hecho.anchoCm, altoCm: hecho.altoCm, hex: color.hex, acabado: color.acabado === "cromado" ? "metal" as const : "satinado" as const }] });
            poner("pedestal", `Pedestal ${k + 1}`, { tipo: "escenografia", elementos, mueble: { id: p.id } }, { en: "piso", xCm: hecho.xCm, zCm: hecho.zCm, giroGrados: 0 });
          });
          return;
        }
        const medida = medidaDe(p);
        const mesas = l.piezas.flatMap((q) => (q.tipo === "fondo" ? [mesaLeida(q, medidaDe(q))] : [])).filter((m): m is MesaLeida => m !== null);
        const muebles = mobiliarioLeido(p, medida, notas, mesas);
        if (muebles) { for (const m of muebles) poner(m.base, m.nombre, m.pieza, m.colocacion); return; }
        // Los colores del fondo son solo `colores`; las letras traen su color y su acabado aparte (colorTexto, acabadoTexto).
        const tinta = p.texto ? tintaLeida(p, notas) : undefined;
        const hex = (k: number) => p.colores[k]?.hex ?? p.colores[0]!.hex;
        const avisoTexto = p.texto && ADMITEN_ROTULO.has(p.id) ? avisoDeTexto(p.texto) : null;
        if (avisoTexto) notas.push(`${p.id.replace(/_/g, " ")}: ${avisoTexto}`);
        // El letrero imprime su texto en una línea y su nombre lo cita como dato (nunca el texto crudo en una frase).
        const textoLetrero = p.id === "letrero" && p.texto ? limpiarTexto(p.texto, 1) : "";
        const a = medida.altoCm, w = medida.anchoCm, y0 = Y(p.yBase);
        // Dónde va un fondo de piso: delante de la pared a su retiro o, si su pie se ve más abajo que el piso, en la profundidad que dice ese pie.
        const zEnElPiso = (retiroCm: number, fondoCm: number) => (medida.zFrenteCm !== undefined ? r0(medida.zFrenteCm - fondoCm / 2) : muro + retiroCm);
        let elementos: ElementoEscenografia[];
        let lugar: "piso" | "pared" = "piso", z = muro + 5;
        switch (p.id) {
          case "panel_redondo": elementos = panelRedondo({ diametroCm: a, alturaCentroCm: r0(y0 + a / 2), hex: hex(0), aro: p.colores[1] ? { hex: hex(1), anchoCm: 4 } : null }); break;
          case "media_luna": elementos = mediaLuna({ diametroCm: a, hex: hex(0) }); break;
          case "arcos_chiara": elementos = arcosChiara({ arcos: p.colores.slice(0, 3).map((c, k) => ({ anchoCm: r0(w * (1 - k * 0.15) / 1.6), altoCm: r0(a * (1 - k * 0.12)), hex: c.hex, xCm: r0((k - 1) * w * 0.12) })) }); break;
          case "lentejuelas": elementos = [paredLentejuelas({ anchoCm: w, altoCm: a, hex: hex(0) })]; break;
          case "pedestales": {
            // Cuántos: los que dice `cantidad`; si no, uno por color leído o, si son más anchos de lo que da un pedestal típico, los que caben (tres pedestales blancos leídos con un solo color no son un tambor de 2 m).
            // Los colores leídos nunca se pierden: el tope solo limita los que se deducen del ancho.
            const cuantos = Math.max(1, p.cantidad ?? Math.max(p.colores.length, Math.min(MAXIMO_PEDESTALES, Math.round(w / DIAMETRO_PEDESTAL_TIPICO_CM))));
            const diametroCm = r0(Math.max(30, w / cuantos - 4)); z = zEnElPiso(120, diametroCm);
            elementos = pedestales({ cilindros: Array.from({ length: cuantos }, (_, k) => { const c = p.colores[k % p.colores.length]!; return { diametroCm, altoCm: r0(a * (0.7 + 0.15 * (k % 3))), hex: c.hex, acabado: c.acabado === "cromado" ? "metal" as const : "satinado" as const }; }) });
            break;
          }
          case "mesa_mantel": z = zEnElPiso(120, 75); elementos = mesaConMantel({ anchoCm: w, fondoCm: 75, altoCm: Math.min(110, Math.max(60, a)), mantel: hex(0) }); break;
          case "tapete_redondo": z = zEnElPiso(160, r0(w * 0.7)); elementos = tapete({ anchoCm: w, fondoCm: r0(w * 0.7), hex: hex(0) }); break;
          case "cortina_luces": lugar = "pared"; elementos = cortina({ anchoCm: w, altoCm: a, hex: hex(0), luces: true }); break;
          default: lugar = "pared"; elementos = letrero({ texto: textoLetrero, anchoCm: w, altoCm: a, hex: hex(0), tinta: tinta ?? hex(1) });
        }
        const sinRotulo: Pieza = { tipo: "escenografia", elementos, mueble: { id: p.id } };
        // Un nombre sobre un panel, un arco o la pared de lentejuelas: el texto leído es su rótulo, con el color y el acabado que se leyeron en las letras (sin color, el que se lee sobre el fondo).
        const pieza = p.texto && ADMITEN_ROTULO.has(p.id) && sinRotulo.tipo === "escenografia" ? conTextoPieza(sinRotulo, { texto: p.texto, acabado: acabadoRotuloLeido(p.acabadoTexto), ...(tinta ? { color: tinta } : {}) }) : sinRotulo;
        poner(p.id.replace(/_/g, "-"), textoLetrero ? `Letrero ${JSON.stringify(textoLetrero)}` : p.id.replace(/_/g, " "), pieza,
          lugar === "pared" ? { en: "pared", pared: "fondo", aLoLargoCm: X(p.x), alturaCm: p.id === "letrero" ? r0(y0) : 0 } : { en: "piso", xCm: medida.xCm, zCm: z, giroGrados: 0 });
        return;
      }
      case "otro":
        omitidas.push(p.descripcion);
        return;
    }
  }

  // Lo colgado de la pared que un panel de fondo (parado delante) taparía va delante del panel.
  escena = letrerosDelanteDeGlobos(colgadoDelanteDePaneles(escena, notas), notas);
  return { escena, notas: [...new Set(notas)], omitidas };
}
