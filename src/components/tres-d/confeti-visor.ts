import * as THREE from "three";

/**
 * Confeti de un globo de cristal: escamas de papel metalizado pegadas por la estática a la pared de adentro (más abajo
 * que arriba), que en las fotos la cubren en buena parte. Muchas escamas por globo cuestan, así que: la escama crece con
 * el globo (en uno chico es pequeña y no atraviesa la pared), cada globo tiene un tope y todos juntos un presupuesto, y
 * las posiciones se calculan una vez por (tamaño, variante) y se reutilizan.
 */

const CM = 0.01;
export const CONFETI_PLATA = "#d9d9e0";
export const CONFETI_ORO = "#e0b33f";
/** Escamas por globo: lo más que lleva uno y lo menos que se le deja aunque haya muchos. */
export const TOPE_CONFETI = 420;
export const MINIMO_CONFETI = 40;
/** Escamas que se dibujan en total en el visor (cada una es un disco de 7 lados). */
export const PRESUPUESTO_CONFETI = 6000;
/** Cuánto de la pared cubre el confeti en un globo con todo su tope disponible. */
const COBERTURA = 0.65;
/** Cuántas variantes de reparto hay por tamaño (los globos las alternan; cada uno va girado a su manera). */
const VARIANTES = 16;

/** Radio de la escama (cm) en un globo de radio `radioCm`: 1/10 del radio, entre 0,35 y 1,05 cm. */
export const radioEscamaCm = (radioCm: number) => Math.min(1.05, Math.max(0.35, radioCm * 0.1));

/** Cuánto confeti lleva un globo de radio `radioCm` con ese tope (cubrir la cobertura, sin pasarse del tope). */
export function cantidadConfeti(radioCm: number, tope: number): number {
  const f = radioEscamaCm(radioCm);
  const ideal = Math.round(COBERTURA * 4 * ((0.9 * radioCm) / f) ** 2);
  return Math.max(Math.min(MINIMO_CONFETI, tope), Math.min(tope, ideal));
}

/** El tope por globo cuando hay `conConfeti` globos con confeti a la vez: el presupuesto repartido. */
export function topePorGlobo(conConfeti: number): number {
  if (conConfeti <= 0) return TOPE_CONFETI;
  return Math.max(MINIMO_CONFETI, Math.min(TOPE_CONFETI, Math.floor(PRESUPUESTO_CONFETI / conConfeti)));
}

function azar(semilla: number): () => number {
  let x = (semilla * 2654435761) >>> 0 || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 100000) / 100000; };
}

const cache = new Map<string, readonly THREE.Matrix4[]>();
const ESCAMA_BASE_CM = 1;

/**
 * Las escamas de un globo de radio `radio` (m) con centro en el origen: cada matriz lleva la posición, la orientación y el
 * tamaño (la geometría base mide 1 cm de radio). Se reutilizan entre globos del mismo tamaño y variante: no se modifican.
 */
export function discosConfeti(radio: number, semilla: number, tope: number): readonly THREE.Matrix4[] {
  const radioCm = radio / CM;
  const variante = semilla % VARIANTES;
  const clave = `${Math.round(radioCm * 2)}|${variante}|${tope}`;
  const hecho = cache.get(clave);
  if (hecho) return hecho;
  const cantidad = cantidadConfeti(radioCm, tope);
  const escala = radioEscamaCm(radioCm) / ESCAMA_BASE_CM;
  const r = azar(variante + 1 + Math.round(radioCm * 2) * 97);
  const q = new THREE.Quaternion(), giro = new THREE.Quaternion();
  const normal = new THREE.Vector3(), mira = new THREE.Vector3(), eje = new THREE.Vector3(0, 0, 1);
  const unoMas = new THREE.Vector3(escala, escala, escala), posicion = new THREE.Vector3();
  const salida: THREE.Matrix4[] = [];
  for (let i = 0; i < cantidad; i++) {
    // Sobre la pared de adentro, con más escamas abajo (sin llegar al cuello, que es más angosto); unas pocas flotan más adentro.
    const u = Math.max(-0.78, Math.min(1, (r() * 2 - 1) * (0.55 + 0.45 * r()) - 0.12)), t = r() * Math.PI * 2;
    const k = radio * (r() < 0.88 ? 0.9 : 0.55 + 0.3 * r());
    const s = Math.sqrt(1 - u * u);
    normal.set(s * Math.cos(t), u, s * Math.sin(t));
    // Casi tangente a la pared, inclinada un poco al azar, y girada sobre sí misma.
    mira.set(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(0.7).add(normal).normalize();
    q.setFromUnitVectors(eje, mira);
    q.multiply(giro.setFromAxisAngle(eje, r() * Math.PI * 2));
    posicion.copy(normal).multiplyScalar(k);
    salida.push(new THREE.Matrix4().compose(posicion, q, unoMas));
  }
  if (cache.size > 200) cache.clear();
  cache.set(clave, salida);
  return salida;
}

export const geometriaConfeti = () => new THREE.CircleGeometry(ESCAMA_BASE_CM * CM, 7);

/** Papel metalizado: cada escama refleja el entorno y brilla o se apaga según cómo quedó. */
export const materialConfeti = (hex: string, entorno: THREE.Texture) =>
  new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), metalness: 1, roughness: 0.2, side: THREE.DoubleSide, envMap: entorno, envMapIntensity: 1.5 });

/** El color que el confeti le da a la luz que atraviesa el globo: el del papel, muy aclarado (el cristal no se ve del color del papel). */
export function tinteDeConfeti(hex: string): THREE.Color {
  return new THREE.Color(hex).lerp(new THREE.Color(0xffffff), 0.5);
}
