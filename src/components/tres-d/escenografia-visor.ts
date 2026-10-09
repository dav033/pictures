import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { SolidoEscenografia } from "@/lib/globos3d/escenografia";
import { geometriaFoil } from "./impresos-visor";
import { ejePanel, lentejuelasDePanel } from "./lentejuelas-instanciadas";
import { materialEscenografia } from "./materiales-visor";
import { calcoMotivo } from "./motivos-utileria";
import { crearRotulosVisor, type OpcionesRotulos } from "./rotulo-visor";

/**
 * **La escenografía de UN visor** (paneles, muebles, utilería): sus mallas, con los materiales y geometrías compartidos por
 * todo lo que dibuja ese visor (cien sólidos del mismo color comparten un material y un programa de sombreado; las patas
 * iguales, una geometría) y lo que comparte material juntado en una sola malla por pieza (una silla Tiffany pasa de 17
 * mallas a 3).
 *
 * Todo es de ESTE visor: los materiales que reflejan llevan el entorno de su contexto WebGL, así que los cachés nunca son
 * de módulo (un caché de módulo con el reflejo de otro visor ya liberado sale negro: el defecto del foil tras una captura).
 * `liberar()` suelta lo compartido al destruir el visor; el vaciado de cada pieza no lo toca (`userData.compartido`).
 *
 * Los rótulos en cursiva (`rotulo` de un sólido) son letras extruidas: la geometría de cada texto se hace una vez por visor
 * (`rotulo-visor.ts`) y los materiales (vinilo, acrílico mate o espejo) se comparten por color. Un sólido `oculto` con rótulo
 * (el nombre de acrílico suelto) no dibuja su tablero, pero deja uno invisible del mismo tamaño para poder elegirlo y moverlo.
 */

const CM = 0.01;
/** Los acabados que llevan textura o calcomanía propias por sólido: no se comparten ni se juntan. */
const ACABADOS_SIN_COMPARTIR = new Set(["lentejuelas", "foil", "foil_mate"]);
/** Tope de geometrías compartidas por visor (las medidas distintas de patas, barrotes y tableros). */
const MAXIMO_GEOMETRIAS = 400;

/** Cuántos lados lleva un cilindro de `radioCm`: lo fino (una pata, una varilla) con 12 se ve redondo; solo lo ancho necesita más. */
const segmentosDeCilindro = (radioCm: number) => Math.min(48, Math.max(12, Math.round(10 + radioCm * 0.6)));

/** ¿Echa sombra? Lo fino (varillas, barrotes, aros de alambre) no: la sombra no se nota y cuesta una pasada más de cada uno. */
function proyectaSombra(s: SolidoEscenografia): boolean {
  if (s.forma === "cilindro") return Math.max(s.radioCm, s.radioArribaCm) >= 3;
  if (s.forma === "caja") { const [, medio, grande] = [s.tamano.x, s.tamano.y, s.tamano.z].sort((a, b) => a - b); return medio! * grande! >= 400; }
  return s.grosorCm >= 1.5;
}

/** Los sólidos que se pueden juntar con otros del mismo material en una sola malla: sin calcomanía ni textura propia. */
const sePuedeFusionar = (s: SolidoEscenografia) => !s.motivo && !s.rotulo && !ACABADOS_SIN_COMPARTIR.has(s.acabado);

/** El marco de un sólido (su origen y sus ejes) como matriz, de su espacio a la pieza. */
function marcoDeSolido(s: SolidoEscenografia): THREE.Matrix4 {
  const ejes = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(s.ejeX.x, s.ejeX.y, s.ejeX.z), new THREE.Vector3(s.ejeY.x, s.ejeY.y, s.ejeY.z), new THREE.Vector3(s.ejeZ.x, s.ejeZ.y, s.ejeZ.z),
  );
  return new THREE.Matrix4().compose(new THREE.Vector3(s.origen.x * CM, s.origen.y * CM, s.origen.z * CM), new THREE.Quaternion().setFromRotationMatrix(ejes), new THREE.Vector3(1, 1, 1));
}

export type EscenografiaVisor = {
  /** Las mallas de la escenografía de una pieza (sus sólidos visibles). */
  piezas: (solidos: readonly SolidoEscenografia[]) => THREE.Object3D[];
  /** Suelta los materiales y geometrías compartidos (al destruir el visor). */
  liberar: () => void;
};

/**
 * La escenografía de un visor, con `entorno` (el reflejo de ese visor, horneado cuando hace falta) y las opciones de sus rótulos:
 * `alFuenteLista` (el visor rehace las piezas con rótulo cuando la letra termina de cargar) y, solo para pruebas, `rasterizar`.
 */
export function crearEscenografiaVisor(entorno: () => THREE.Texture, opcionesRotulos: OpcionesRotulos = {}): EscenografiaVisor {
  const materiales = new Map<string, THREE.Material>();
  const geometrias = new Map<string, THREE.BufferGeometry>();
  const rotulos = crearRotulosVisor(entorno, opcionesRotulos);
  let tableroInvisible: THREE.Material | null = null;

  const material = (s: SolidoEscenografia): THREE.Material => {
    if (ACABADOS_SIN_COMPARTIR.has(s.acabado)) return materialEscenografia(s, entorno());
    const clave = `${s.acabado}|${s.hex}`;
    let m = materiales.get(clave);
    if (!m) {
      m = materialEscenografia(s, entorno());
      m.userData.compartido = true;
      materiales.set(clave, m);
    }
    return m;
  };

  const compartida = (clave: string, crear: () => THREE.BufferGeometry): THREE.BufferGeometry => {
    let g = geometrias.get(clave);
    // Pasado el tope, la geometría nueva va sin caché (sin marca de compartida: la libera el vaciado de su pieza). Nunca se
    // liberan las del caché mientras alguna malla las usa.
    if (!g && geometrias.size >= MAXIMO_GEOMETRIAS) return crear();
    if (!g) {
      g = crear();
      g.userData.compartido = true;
      geometrias.set(clave, g);
    }
    return g;
  };

  /** La geometría de un sólido en su propio marco (cm → m). */
  const geometriaDeSolido = (s: SolidoEscenografia): THREE.BufferGeometry => {
    if (s.forma === "caja") return compartida(`c|${s.tamano.x}|${s.tamano.y}|${s.tamano.z}`, () => new THREE.BoxGeometry(s.tamano.x * CM, s.tamano.y * CM, s.tamano.z * CM));
    if (s.forma === "cilindro") {
      return compartida(`y|${s.radioCm}|${s.radioArribaCm}|${s.altoCm}`, () => {
        const g = new THREE.CylinderGeometry(s.radioArribaCm * CM, s.radioCm * CM, s.altoCm * CM, segmentosDeCilindro(Math.max(s.radioCm, s.radioArribaCm)));
        g.translate(0, (s.altoCm / 2) * CM, 0);
        return g;
      });
    }
    // Un globo metalizado: el contorno inflado como almohada, de z = 0 a z = grosor.
    if (s.acabado === "foil" || s.acabado === "foil_mate") return geometriaFoil(s.contorno, s.huecos, s.grosorCm);
    const forma = new THREE.Shape(s.contorno.map((p) => new THREE.Vector2(p.x * CM, p.y * CM)));
    for (const hueco of s.huecos) forma.holes.push(new THREE.Path(hueco.map((p) => new THREE.Vector2(p.x * CM, p.y * CM))));
    // Un bisel fino redondea el canto: al girar, el panel se ve como un tablero cortado y no como una lámina.
    const bisel = Math.min(0.5, s.grosorCm / 4) * CM;
    const geometria = new THREE.ExtrudeGeometry(forma, { depth: Math.max(0.1 * CM, s.grosorCm * CM - 2 * bisel), bevelEnabled: true, bevelThickness: bisel, bevelSize: bisel, bevelSegments: 2, curveSegments: 24 });
    geometria.translate(0, 0, bisel);
    return geometria;
  };

  /** El material de un tablero que no se dibuja (el del nombre de acrílico suelto): sirve para elegirlo y medirlo, no se ve. */
  const invisible = (): THREE.Material => {
    if (!tableroInvisible) { tableroInvisible = new THREE.MeshBasicMaterial({ visible: false }); tableroInvisible.userData.compartido = true; }
    return tableroInvisible;
  };

  /** Un sólido suelto en su sitio, con su calcomanía, su rótulo y, si es un panel de lentejuelas, sus lentejuelas por instancias. */
  const solido = (s: SolidoEscenografia): THREE.Object3D => {
    const malla = new THREE.Mesh(geometriaDeSolido(s), s.oculto ? invisible() : material(s));
    malla.castShadow = !s.oculto && proyectaSombra(s);
    malla.receiveShadow = !s.oculto;
    marcoDeSolido(s).decompose(malla.position, malla.quaternion, malla.scale);
    const letras = rotulos.malla(s);
    if (letras) malla.add(letras);
    // Lo impreso (calavera, «Happy Halloween», lunares…) de la utilería de fiesta, como calcomanía en su cara.
    const calco = calcoMotivo(s);
    if (calco) malla.add(calco);
    if (s.forma === "caja" && s.acabado === "lentejuelas") {
      const eje = ejePanel(s.tamano);
      if (eje !== null) malla.add(lentejuelasDePanel(s.tamano, eje, s.hex, entorno()));
    }
    return malla;
  };

  return {
    piezas(solidos) {
      const lotes = new Map<string, { material: THREE.Material; sombra: boolean; geometrias: THREE.BufferGeometry[]; solidos: SolidoEscenografia[] }>();
      const salida: THREE.Object3D[] = [];
      for (const s of solidos) {
        if (s.oculto && !s.rotulo) continue;
        if (!sePuedeFusionar(s)) { salida.push(solido(s)); continue; }
        const sombra = proyectaSombra(s);
        const clave = `${s.acabado}|${s.hex}|${sombra ? 1 : 0}`;
        const lote = lotes.get(clave) ?? { material: material(s), sombra, geometrias: [], solidos: [] };
        lote.solidos.push(s);
        const g = geometriaDeSolido(s).clone();
        g.applyMatrix4(marcoDeSolido(s));
        lote.geometrias.push(g.index ? g.toNonIndexed() : g);
        lotes.set(clave, lote);
      }
      for (const { material: m, sombra, geometrias: gs, solidos: delLote } of lotes.values()) {
        const geometria = gs.length === 1 ? gs[0]! : mergeGeometries(gs);
        // Si no se pudieron juntar (atributos que no calzan), cada sólido va suelto: nunca desaparece una pieza.
        if (!geometria) { for (const g of gs) g.dispose(); for (const s of delLote) salida.push(solido(s)); continue; }
        if (geometria !== gs[0]) for (const g of gs) g.dispose();
        const malla = new THREE.Mesh(geometria, m);
        malla.castShadow = sombra;
        malla.receiveShadow = true;
        salida.push(malla);
      }
      return salida;
    },
    liberar() {
      for (const m of materiales.values()) m.dispose();
      for (const g of geometrias.values()) g.dispose();
      rotulos.liberar();
      tableroInvisible?.dispose();
      tableroInvisible = null;
      materiales.clear();
      geometrias.clear();
    },
  };
}
