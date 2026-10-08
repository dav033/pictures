import type { Vec3 } from "./modulos";
import type { Punto2 } from "./trenza";

/**
 * **Escenografía**: lo que acompaña a los globos en un montaje y no es globo (paneles de fondo con forma, pared de
 * lentejuelas, mesas cilíndricas, mesa con mantel, tapete). No cotiza: no da materiales. Se describe con datos
 * (cajas, cilindros y paneles con contorno) en el espacio local de la pieza (cm, y hacia arriba, +z al frente) y el
 * visor la dibuja con volúmenes sencillos.
 *
 * - `caja`: centrada en `centro`, de `tamano` (x ancho, y alto, z fondo), girada `giroGrados` sobre y.
 * - `cilindro`: base en `base` y sube `altoCm`; con `radioArribaCm` es un tronco de cono (un mantel que se abre).
 * - `panel`: un contorno del plano XY (cm), extruido `grosorCm` desde `zCm` hacia +z; `huecos` son ventanas.
 */
export type AcabadoEscenografia = "mate" | "satinado" | "brillante" | "lentejuelas" | "tela" | "madera";

type Aspecto = { hex: string; acabado: AcabadoEscenografia };

export type ElementoEscenografia =
  | (Aspecto & { forma: "caja"; centro: Vec3; tamano: Vec3; giroGrados?: number })
  | (Aspecto & { forma: "cilindro"; base: Vec3; radioCm: number; altoCm: number; radioArribaCm?: number })
  | (Aspecto & { forma: "panel"; contorno: Punto2[]; huecos?: Punto2[][]; zCm: number; grosorCm: number });

/**
 * Un elemento ya armado, con su marco (origen y ejes): así la escena lo mueve y lo gira como a los globos y el visor
 * lo pone donde va. En el marco: la caja va centrada en el origen; el cilindro tiene la base en el origen y sube por
 * el eje y; el panel tiene el contorno en el plano xy y se extruye de z = 0 a z = grosor.
 */
export type MarcoSolido = { origen: Vec3; ejeX: Vec3; ejeY: Vec3; ejeZ: Vec3 };

export type SolidoEscenografia = MarcoSolido & Aspecto & (
  | { forma: "caja"; tamano: Vec3 }
  | { forma: "cilindro"; radioCm: number; altoCm: number; radioArribaCm: number }
  | { forma: "panel"; contorno: Punto2[]; huecos: Punto2[][]; grosorCm: number }
);

const X: Vec3 = { x: 1, y: 0, z: 0 }, Y: Vec3 = { x: 0, y: 1, z: 0 }, Z: Vec3 = { x: 0, y: 0, z: 1 };

export function armarEscenografia(elementos: readonly ElementoEscenografia[]): SolidoEscenografia[] {
  return elementos.map((e): SolidoEscenografia => {
    const aspecto = { hex: e.hex, acabado: e.acabado };
    if (e.forma === "caja") {
      const a = ((e.giroGrados ?? 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
      return { ...aspecto, forma: "caja", tamano: { ...e.tamano }, origen: { ...e.centro }, ejeX: { x: c, y: 0, z: -s }, ejeY: Y, ejeZ: { x: s, y: 0, z: c } };
    }
    if (e.forma === "cilindro") {
      return { ...aspecto, forma: "cilindro", radioCm: e.radioCm, altoCm: e.altoCm, radioArribaCm: e.radioArribaCm ?? e.radioCm, origen: { ...e.base }, ejeX: X, ejeY: Y, ejeZ: Z };
    }
    return { ...aspecto, forma: "panel", contorno: e.contorno.map((p) => ({ ...p })), huecos: (e.huecos ?? []).map((h) => h.map((p) => ({ ...p }))), grosorCm: e.grosorCm, origen: { x: 0, y: 0, z: e.zCm }, ejeX: X, ejeY: Y, ejeZ: Z };
  });
}

/** Puntos del sólido en su marco (las esquinas de su caja local), para medir lo que ocupa. */
function puntosLocales(s: SolidoEscenografia): Vec3[] {
  if (s.forma === "caja") {
    const h = { x: s.tamano.x / 2, y: s.tamano.y / 2, z: s.tamano.z / 2 };
    const salida: Vec3[] = [];
    for (const x of [-h.x, h.x]) for (const y of [-h.y, h.y]) for (const z of [-h.z, h.z]) salida.push({ x, y, z });
    return salida;
  }
  if (s.forma === "cilindro") {
    const r = Math.max(s.radioCm, s.radioArribaCm);
    const salida: Vec3[] = [];
    for (const x of [-r, r]) for (const y of [0, s.altoCm]) for (const z of [-r, r]) salida.push({ x, y, z });
    return salida;
  }
  return s.contorno.flatMap((p) => [{ x: p.x, y: p.y, z: 0 }, { x: p.x, y: p.y, z: s.grosorCm }]);
}

/** Los puntos del sólido en el espacio de la pieza (o del mundo, si el marco ya está movido). */
export function puntosSolido(s: SolidoEscenografia): Vec3[] {
  return puntosLocales(s).map((p) => ({
    x: s.origen.x + s.ejeX.x * p.x + s.ejeY.x * p.y + s.ejeZ.x * p.z,
    y: s.origen.y + s.ejeX.y * p.x + s.ejeY.y * p.y + s.ejeZ.y * p.z,
    z: s.origen.z + s.ejeX.z * p.x + s.ejeY.z * p.y + s.ejeZ.z * p.z,
  }));
}

// ----------------------------------------------------------------------------------------------------------
// Piezas de escenografía de los montajes (medidas en cm)
// ----------------------------------------------------------------------------------------------------------

/** Mesa cilíndrica (pedestal) de un color: cuerpo y una tapa un poco más ancha arriba. */
export function mesaCilindrica(o: { diametroCm: number; altoCm: number; hex: string; acabado?: AcabadoEscenografia }): ElementoEscenografia[] {
  const r = o.diametroCm / 2;
  const acabado = o.acabado ?? "satinado";
  return [
    { forma: "cilindro", base: { x: 0, y: 0, z: 0 }, radioCm: r, altoCm: o.altoCm - 2, hex: o.hex, acabado },
    { forma: "cilindro", base: { x: 0, y: o.altoCm - 2, z: 0 }, radioCm: r + 0.8, altoCm: 2, hex: o.hex, acabado },
  ];
}

/**
 * Mesa rectangular con mantel hasta el piso (que se abre un poco abajo), un camino de otro color que cruza la tapa y
 * cae por delante, y, si se piden, tarimas (bandejas elevadas) sobre la tapa.
 */
export function mesaConMantel(o: {
  anchoCm: number; fondoCm: number; altoCm: number; mantel: string;
  camino?: { anchoCm: number; hex: string; caidaCm: number } | null;
  tarimas?: ReadonlyArray<{ xCm: number; anchoCm: number; fondoCm: number; altoCm: number; hex: string }>;
}): ElementoEscenografia[] {
  const { anchoCm: a, fondoCm: f, altoCm: h } = o;
  const salida: ElementoEscenografia[] = [
    // La tapa con el mantel encima.
    { forma: "caja", centro: { x: 0, y: h - 1.5, z: 0 }, tamano: { x: a + 2, y: 3, z: f + 2 }, hex: o.mantel, acabado: "brillante" },
    // La falda: cuatro paños que bajan de la tapa al piso.
    ...faldaMantel(a + 2, f + 2, h - 3, 6, o.mantel),
  ];
  if (o.camino) {
    const c = o.camino;
    salida.push(
      { forma: "caja", centro: { x: 0, y: h + 0.2, z: 0 }, tamano: { x: c.anchoCm, y: 0.4, z: f + 2.6 }, hex: c.hex, acabado: "brillante" },
      // Lo que cae por delante, pegado a la falda.
      { forma: "caja", centro: { x: 0, y: h - c.caidaCm / 2, z: (f + 2) / 2 + 0.3 }, tamano: { x: c.anchoCm, y: c.caidaCm, z: 0.4 }, hex: c.hex, acabado: "brillante" },
    );
  }
  for (const t of o.tarimas ?? []) {
    salida.push({ forma: "caja", centro: { x: t.xCm, y: h + 0.4 + t.altoCm / 2, z: -f * 0.1 }, tamano: { x: t.anchoCm, y: t.altoCm, z: t.fondoCm }, hex: t.hex, acabado: "madera" });
  }
  return salida;
}

/**
 * La falda de un mantel: el paño de delante y el de atrás son trapecios que se abren `abreCm` a cada lado abajo (el
 * mantel de plástico cae así); los de los lados, paños rectos.
 */
function faldaMantel(ancho: number, fondo: number, alto: number, abreCm: number, hex: string): ElementoEscenografia[] {
  const trapecio: Punto2[] = [{ x: -ancho / 2 - abreCm, y: 0 }, { x: ancho / 2 + abreCm, y: 0 }, { x: ancho / 2, y: alto }, { x: -ancho / 2, y: alto }];
  return [
    { forma: "panel", contorno: trapecio, zCm: fondo / 2 - 0.6, grosorCm: 0.6, hex, acabado: "brillante" },
    { forma: "panel", contorno: trapecio, zCm: -fondo / 2, grosorCm: 0.6, hex, acabado: "brillante" },
    { forma: "caja", centro: { x: -ancho / 2 + 0.3, y: alto / 2, z: 0 }, tamano: { x: 0.6, y: alto, z: fondo }, hex, acabado: "brillante" },
    { forma: "caja", centro: { x: ancho / 2 - 0.3, y: alto / 2, z: 0 }, tamano: { x: 0.6, y: alto, z: fondo }, hex, acabado: "brillante" },
  ];
}

/** Pared de lentejuelas (los paneles de shimmer): un tablero fino del color de las lentejuelas. */
export function paredLentejuelas(o: { anchoCm: number; altoCm: number; hex: string; zCm?: number }): ElementoEscenografia {
  return { forma: "caja", centro: { x: 0, y: o.altoCm / 2, z: (o.zCm ?? 0) + 1 }, tamano: { x: o.anchoCm, y: o.altoCm, z: 2 }, hex: o.hex, acabado: "lentejuelas" };
}

/** Tapete: una tela fina en el piso; con `borde`, un ribete (el encaje negro) que asoma alrededor. */
export function tapete(o: { anchoCm: number; fondoCm: number; hex: string; borde?: { hex: string; cm: number } | null }): ElementoEscenografia[] {
  const salida: ElementoEscenografia[] = [];
  if (o.borde) salida.push({ forma: "caja", centro: { x: 0, y: 0.2, z: 0 }, tamano: { x: o.anchoCm + o.borde.cm * 2, y: 0.4, z: o.fondoCm + o.borde.cm * 2 }, hex: o.borde.hex, acabado: "tela" });
  salida.push({ forma: "caja", centro: { x: 0, y: o.borde ? 0.6 : 0.3, z: 0 }, tamano: { x: o.anchoCm, y: o.borde ? 0.4 : 0.6, z: o.fondoCm }, hex: o.hex, acabado: "tela" });
  return salida;
}

/**
 * Contorno de un marco en U invertida con los bordes ondulados (como cortinas): sube por fuera a la izquierda, cruza
 * arriba, baja por fuera a la derecha y vuelve por dentro. `bandaCm` es el ancho de los lados y `bandaArribaCm` el
 * de arriba; `amplitudCm` y `ondas` dan la ondulación y `fase` la corre (para que dos capas no coincidan).
 */
export function contornoMarcoOndulado(o: { anchoCm: number; altoCm: number; bandaCm: number; bandaArribaCm: number; amplitudCm: number; ondas: number; fase: number }): Punto2[] {
  const { anchoCm: W, altoCm: H, bandaCm: b, bandaArribaCm: bt, amplitudCm: A, ondas: n, fase } = o;
  const pasos = 28;
  const onda = (u: number, k: number) => A * Math.sin(Math.PI * 2 * n * u + fase + k);
  // Que la onda se apague en el piso y en las esquinas: el marco apoya derecho y las esquinas no se cruzan.
  const suave = (u: number) => Math.sin(Math.PI * Math.min(1, Math.max(0, u)));
  const puntos: Punto2[] = [];
  // Lado izquierdo por fuera (abajo → arriba).
  for (let i = 0; i <= pasos; i++) { const u = i / pasos; puntos.push({ x: -W / 2 + onda(u, 0) * suave(u) * 0.6, y: u * H }); }
  // Arriba por fuera (izquierda → derecha), con una onda suave.
  for (let i = 1; i < pasos; i++) { const u = i / pasos; puntos.push({ x: -W / 2 + u * W, y: H + onda(u, 1.3) * suave(u) * 0.5 }); }
  // Lado derecho por fuera (arriba → abajo).
  for (let i = pasos; i >= 0; i--) { const u = i / pasos; puntos.push({ x: W / 2 + onda(u, 2.1) * suave(u) * 0.6, y: u * H }); }
  // Lado derecho por dentro (abajo → arriba): aquí la onda se nota más (el borde de la «cortina»).
  for (let i = 0; i <= pasos; i++) { const u = i / pasos; puntos.push({ x: W / 2 - b + onda(u, 0.7) * suave(u), y: u * (H - bt) }); }
  // Arriba por dentro (derecha → izquierda).
  for (let i = pasos - 1; i > 0; i--) { const u = i / pasos; puntos.push({ x: -W / 2 + b + u * (W - 2 * b), y: H - bt + onda(u, 2.6) * suave(u) }); }
  // Lado izquierdo por dentro (arriba → abajo).
  for (let i = pasos; i >= 0; i--) { const u = i / pasos; puntos.push({ x: -W / 2 + b + onda(u, 3.4) * suave(u), y: u * (H - bt) }); }
  return puntos.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(Math.max(0, p.y) * 10) / 10 }));
}

/**
 * Fondo de marco: la pared de lentejuelas detrás y dos capas de panel ondulado delante (la de atrás más ancha y
 * oscura, la de delante más clara), como el backdrop verde de la foto 1 de Halloween.
 */
export function fondoMarcoOndulado(o: {
  anchoCm: number; altoCm: number; bandaCm: number; bandaArribaCm: number;
  capas: readonly [string, string]; lentejuelas: string | null;
}): ElementoEscenografia[] {
  const salida: ElementoEscenografia[] = [];
  if (o.lentejuelas) salida.push(paredLentejuelas({ anchoCm: o.anchoCm - o.bandaCm * 1.2, altoCm: o.altoCm - o.bandaArribaCm * 0.6, hex: o.lentejuelas }));
  const atras = contornoMarcoOndulado({ anchoCm: o.anchoCm, altoCm: o.altoCm, bandaCm: o.bandaCm + 10, bandaArribaCm: o.bandaArribaCm + 8, amplitudCm: 9, ondas: 1.5, fase: 0.4 });
  const delante = contornoMarcoOndulado({ anchoCm: o.anchoCm - 14, altoCm: o.altoCm - 8, bandaCm: o.bandaCm, bandaArribaCm: o.bandaArribaCm, amplitudCm: 11, ondas: 1.2, fase: 2.2 });
  salida.push(
    { forma: "panel", contorno: atras, zCm: 2.5, grosorCm: 2, hex: o.capas[0], acabado: "mate" },
    { forma: "panel", contorno: delante, zCm: 4.5, grosorCm: 2, hex: o.capas[1], acabado: "mate" },
  );
  return salida;
}
