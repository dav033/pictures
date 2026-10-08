import { SALA_INICIAL, idNuevo, type Colocacion, type Escena, type NodoEscena } from "./escena";
import type { Pieza } from "./piezas";
import type { ColorOrganico } from "./organico";
import type { ElementoEscenografia } from "./escenografia";
import { coloresDelFormato } from "./formatos";
import { referenciaPorCodigo } from "../plan/referencia-sempertex";
import { distanciaLab, resolverColorOrganico, resolverColorFlexible } from "./herramientas-escena-colores";
import { crearEstructura } from "./herramientas-escena-estructuras";
import { floresPedidas } from "./herramientas-escena-trazo";
import { piezaDeGenerador } from "./generadores-organicos";
import { MEZCLA_TRAZO, cajaTrazo, puntosDeSilueta, type SiluetaTrazo } from "./trazo-organico";
import { columnaClasica } from "./escenas-presets";
import { decoracionPredefinida } from "./figuras";
import { reemplazarColor } from "./recolorear";
import { arcosChiara, cortina, letrero, mediaLuna, panelRedondo, pedestales } from "./fondos-escenografia";
import { mesaConMantel, paredLentejuelas, tapete } from "./escenografia";
import type { ColorLeido, LecturaFoto, PiezaLeida } from "./lectura-foto";

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
const FAMILIA_ACABADO: Readonly<Record<ColorLeido["acabado"], string>> = { mate: "", brillante: "", cromado: "reflex", perla: "silk", cristal: "cristal", confeti: "cristal" };
const CRISTAL = "390";

/** Un color leído → código Sempertex (en los formatos pedidos): por nombre y acabado, si no por el hex medido. */
export function codigoDeColor(c: ColorLeido, formatos: readonly string[], notas: string[]): string {
  if (c.acabado === "cristal" || c.acabado === "confeti") return CRISTAL;
  const familia = FAMILIA_ACABADO[c.acabado];
  const pedido = familia && !c.nombre.toLowerCase().includes(familia) ? `${c.nombre} ${familia}` : c.nombre;
  try {
    return formatos.length === 1 && formatos[0] !== "R-12" ? resolverColorFlexible(pedido, formatos, notas) : resolverColorOrganico(pedido, notas).codigo;
  } catch {
    // El nombre no está en la tabla: el más parecido por el color medido (de la familia del acabado, si la trae).
    const candidatos = coloresDelFormato(formatos[0] ?? "R-12").filter((r) => !familia || (referenciaPorCodigo(r.codigo)?.familia ?? "").toLowerCase().includes(familia));
    const lista = candidatos.length ? candidatos : coloresDelFormato(formatos[0] ?? "R-12");
    const mejor = [...lista].sort((a, b) => distanciaLab(c.hex, a.hexGlobo) - distanciaLab(c.hex, b.hexGlobo))[0];
    notas.push(`«${c.nombre}» no está en la tabla: va ${mejor?.codigo} ${mejor?.nombreCompleto} (el más parecido al color de la foto).`);
    return mejor?.codigo ?? "005";
  }
}

function coloresOrganicos(colores: readonly ColorLeido[], notas: string[]): ColorOrganico[] {
  const salida: ColorOrganico[] = [];
  for (const c of colores) {
    const codigo = codigoDeColor(c, ["R-12"], notas);
    const peso = Math.max(1, r0(c.peso));
    const previo = salida.find((x) => x.codigo === codigo && Boolean(x.confeti) === (c.acabado === "confeti"));
    if (previo) { previo.peso += peso; continue; }
    salida.push({ codigo, peso, ...(c.acabado === "confeti" ? { confeti: true } : {}), ...(codigo === CRISTAL ? { formatos: ["R-12", "R-18", "R-24"] } : {}) });
  }
  return salida;
}

function mezclaDe(tamanos: Partial<Record<string, number>>): Record<string, number> {
  const total = Object.values(tamanos).reduce<number>((s, w) => s + (w ?? 0), 0);
  if (total <= 0) return { ...MEZCLA_TRAZO };
  return Object.fromEntries(Object.entries(tamanos).filter(([, w]) => (w ?? 0) > 0).map(([f, w]) => [f, Math.round(((w ?? 0) / total) * 1000) / 1000]));
}

/** El formato de un globo suelto por su diámetro en cm. */
function formatoPorDiametro(cm: number): { formatoId: string; infladoCm: number } {
  const opciones = [{ formatoId: "R-36", infladoCm: 85 }, { formatoId: "R-24", infladoCm: 55 }, { formatoId: "R-18", infladoCm: 42 }, { formatoId: "R-12", infladoCm: 27 }, { formatoId: "R-9", infladoCm: 20 }, { formatoId: "R-5", infladoCm: 12 }];
  return opciones.reduce((m, o) => (Math.abs(o.infladoCm - cm) < Math.abs(m.infladoCm - cm) ? o : m));
}

const SILUETA_COLUMNA: Readonly<Record<string, SiluetaTrazo>> = { recta: "columna_recta", racimos: "columna_racimos", s: "columna_s", inclinada: "columna_inclinada" };

export function compilarLectura(l: LecturaFoto): EscenaCompilada {
  const notas: string[] = [], omitidas: string[] = [];
  const H = l.escala.altoImagenCm;
  // La línea del piso: la leída o lo más bajo de lo que hay.
  const bajos = l.piezas.flatMap((p) => ("yBase" in p ? [p.yBase] : "puntos" in p ? p.puntos.map((q) => q.y + q.grosor / 2) : "y" in p ? [p.y] : []));
  const piso = l.pisoY ?? (bajos.length ? Math.max(...bajos) : 1);
  const X = (x: number) => r1((x - 0.5) * l.aspecto * H);
  const Y = (y: number) => r1(Math.max(0, (piso - y) * H));
  const cm = (f: number) => r1(f * H);

  const xs = l.piezas.flatMap((p) => ("puntos" in p ? p.puntos.map((q) => q.x) : "x" in p ? [p.x] : "x1" in p ? [p.x1, p.x2] : []));
  const ancho = Math.max(500, r0((Math.max(0.5, ...xs.map((x) => Math.abs(x - 0.5))) * 2 * l.aspecto * H) + 200));
  const altoMax = Math.max(0, ...l.piezas.flatMap((p) => ("puntos" in p ? p.puntos.map((q) => Y(q.y) + cm(q.grosor) / 2) : "yArriba" in p ? [Y(p.yArriba)] : "y" in p ? [Y(p.y) + 30] : [])));
  const fondo = 500;
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
    } catch (error) {
      omitidas.push(`Pieza ${i + 1} (${p.tipo}): ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  function compilarPieza(p: PiezaLeida, i: number) {
    switch (p.tipo) {
      case "guirnalda_organica": {
        const puntos = p.puntos.map((q) => ({ x: X(q.x), y: Y(q.y), grosor: Math.min(140, Math.max(20, cm(q.grosor))) }));
        const x0 = r1((Math.min(...puntos.map((q) => q.x)) + Math.max(...puntos.map((q) => q.x))) / 2);
        const trazo = { puntos: puntos.map((q) => ({ ...q, x: r1(q.x - x0) })), mezcla: mezclaDe(p.tamanos), colores: coloresOrganicos(p.colores, notas), racimos: p.racimos, semilla: 11 + i };
        const flores = p.follaje?.length ? floresPedidas(p.follaje) : null;
        const largo = puntos.slice(1).reduce((s, q, k) => s + Math.hypot(q.x - puntos[k]!.x, q.y - puntos[k]!.y), 0);
        const pieza = piezaDeGenerador({ tipo: "trazo", trazo }, flores, Math.max(4, Math.min(30, r0(largo / 45))));
        poner("guirnalda-organica", "Guirnalda orgánica", pieza, { en: "pared", pared: "fondo", aLoLargoCm: x0, alturaCm: r0(cajaTrazo(trazo).minY) });
        return;
      }
      case "columna_organica": {
        const silueta = SILUETA_COLUMNA[p.forma]!;
        const alto = Math.max(60, Y(p.yArriba) - Y(p.yBase));
        const grosor = Math.min(140, Math.max(25, cm(p.grosor)));
        const pieza = piezaDeGenerador({ tipo: "trazo", trazo: { silueta, puntos: puntosDeSilueta(silueta, { anchoCm: Math.max(grosor, cm(p.ancho)), altoCm: alto, grosorCm: grosor }), mezcla: mezclaDe(p.tamanos), colores: coloresOrganicos(p.colores, notas), racimos: p.racimos, semilla: 21 + i } });
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
        const f = formatoPorDiametro(cm(p.diametro));
        const codigo = codigoDeColor(p.colores[0]!, [f.formatoId], notas);
        const pieza: Pieza = { tipo: "globo", formatoId: f.formatoId, infladoCm: f.infladoCm, codigo };
        poner(`globo-${f.formatoId.toLowerCase()}`, `Globo ${f.formatoId}`, pieza, p.en === "piso" ? { en: "piso", xCm: X(p.x), zCm: muro + 110, giroGrados: 0 } : { en: "libre", xCm: X(p.x), yCm: Y(p.y), zCm: muro + 70, giroGrados: 0 });
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
        const pulgadas = alto > 90 ? 40 : alto > 75 ? 34 : alto > 60 ? 32 : alto > 50 ? 27 : 16;
        if (p.cursiva) notas.push(`«${p.texto}» va en letras sueltas: el globo metalizado en letra cursiva no está en el catálogo.`);
        // Cada palabra es una pieza (los metalizados no traen el espacio), una junto a otra y centradas en x.
        const palabras = p.texto.split(/\s+/).filter(Boolean);
        const anchos = palabras.map((w) => w.length * alto * 0.62);
        const total = anchos.reduce((s, a) => s + a, 0) + (palabras.length - 1) * alto * 0.4;
        let desde = X(p.x) - total / 2;
        palabras.forEach((w, k) => {
          const forma = w.length > 1 ? "letras" : /\d/.test(w) ? "numero" : "letra";
          const hecho = crearEstructura("metalizado", { texto: w, forma_metalizado: forma, pulgadas, colores: [p.colores[0]!.nombre] }, notas);
          poner("metalizado", hecho.nombre, hecho.pieza, { en: "pared", pared: "fondo", aLoLargoCm: r1(desde + anchos[k]! / 2), alturaCm: Math.max(0, r0(Y(p.y) - alto / 2)) });
          desde += anchos[k]! + alto * 0.4;
        });
        return;
      }
      case "fondo": {
        const hex = (k: number) => p.colores[k]?.hex ?? p.colores[0]!.hex;
        const a = cm(p.alto), w = cm(p.ancho), y0 = Y(p.yBase);
        let elementos: ElementoEscenografia[];
        let lugar: "piso" | "pared" = "piso", z = muro + 5;
        switch (p.id) {
          case "panel_redondo": elementos = panelRedondo({ diametroCm: a, alturaCentroCm: r0(y0 + a / 2), hex: hex(0), aro: p.colores[1] ? { hex: hex(1), anchoCm: 4 } : null }); break;
          case "media_luna": elementos = mediaLuna({ diametroCm: a, hex: hex(0) }); break;
          case "arcos_chiara": elementos = arcosChiara({ arcos: p.colores.slice(0, 3).map((c, k) => ({ anchoCm: r0(w * (1 - k * 0.15) / 1.6), altoCm: r0(a * (1 - k * 0.12)), hex: c.hex, xCm: r0((k - 1) * w * 0.12) })) }); break;
          case "lentejuelas": elementos = [paredLentejuelas({ anchoCm: w, altoCm: a, hex: hex(0) })]; break;
          case "pedestales": z = muro + 120; elementos = pedestales({ cilindros: p.colores.map((c, k) => ({ diametroCm: r0(Math.max(30, w / Math.max(1, p.colores.length) - 4)), altoCm: r0(a * (0.7 + 0.15 * k)), hex: c.hex, acabado: c.acabado === "cromado" ? "metal" as const : "satinado" as const })) }); break;
          case "mesa_mantel": z = muro + 120; elementos = mesaConMantel({ anchoCm: w, fondoCm: 75, altoCm: Math.min(110, Math.max(60, a)), mantel: hex(0) }); break;
          case "tapete_redondo": z = muro + 160; elementos = tapete({ anchoCm: w, fondoCm: r0(w * 0.7), hex: hex(0) }); break;
          case "cortina_luces": lugar = "pared"; elementos = cortina({ anchoCm: w, altoCm: a, hex: hex(0), luces: true }); break;
          default: lugar = "pared"; elementos = letrero({ texto: p.texto ?? "", anchoCm: w, altoCm: a, hex: hex(0), tinta: hex(1) });
        }
        const pieza: Pieza = { tipo: "escenografia", elementos };
        poner(p.id.replace(/_/g, "-"), p.id === "letrero" && p.texto ? `Letrero «${p.texto}»` : p.id.replace(/_/g, " "), pieza,
          lugar === "pared" ? { en: "pared", pared: "fondo", aLoLargoCm: X(p.x), alturaCm: p.id === "letrero" ? r0(y0) : 0 } : { en: "piso", xCm: X(p.x), zCm: z, giroGrados: 0 });
        return;
      }
      case "otro":
        omitidas.push(p.descripcion);
        return;
    }
  }

  return { escena, notas: [...new Set(notas)], omitidas };
}
