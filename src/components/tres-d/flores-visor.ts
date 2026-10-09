import * as THREE from "three";
import { esHoja, type TipoFlorArtificial } from "@/lib/globos3d/flores-artificiales";
import { geometriaPluma, materialPlumaConTextura } from "./pampa-visor";

/**
 * Cómo se dibujan las flores y el **follaje** artificial del taller (no son globos): cada flor u hoja es un juego de
 * partes de radio 1 (esferas, casquetes, la silueta de una monstera…) con su marco local y su color, que el visor
 * dibuja por instancias. Marco local: +Y es la normal del hueco (hacia fuera de los globos).
 * - Flores: hortensia (bola de florecitas y tres hojas), rosa (capullo en capas), gypsophila (nube de puntitos).
 * - Hojas (2026-10-08, las de las fotos de Pinterest): monstera, palma, helecho, eucalipto y hoja seca/pampa. Van casi
 *   tendidas sobre la cara de los globos (en el plano XZ) y un poco levantadas, asomando entre ellos como en las
 *   guirnaldas reales; su largo es el `diametroCm` de la flor.
 * - Pampa (2026-10-09): plumas esponjosas de hierba de la pampa que salen erguidas de entre los globos, cada una con su tallo
 *   curvo y su penacho de tarjetas translúcidas (`pampa-visor.ts`); el largo total (tallo y pluma) es el `diametroCm`.
 */

const CM = 0.01;

export type FlorADibujar = { tipo: TipoFlorArtificial; hex: string; diametroCm: number; /** La normal del hueco (la pampa la necesita para enderezarse hacia arriba del mundo). */ normal?: { x: number; y: number; z: number } };

export type ParteFlor = "florecita" | "hoja" | "petalo0" | "petalo1" | "petalo2" | "punto" | "monstera" | "foliolo" | "tallo" | "moneda" | "pluma";

/** Silueta de una hoja de monstera de largo 1 sobre +X (peciolo en el origen), con sus cortes laterales. */
function siluetaMonstera(): THREE.Shape {
  const s = new THREE.Shape();
  const puntos: Array<[number, number]> = [];
  // Contorno acorazonado; cada lado con 4 cortes (escotaduras) que llegan a media hoja.
  const lado = (signo: 1 | -1) => {
    const borde: Array<[number, number]> = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const x = 0.08 + t * 0.92;
      const ancho = 0.5 * Math.sin(Math.PI * Math.min(1, t * 1.05)) ** 0.8;
      const corte = [0.25, 0.42, 0.59, 0.76].some((c) => Math.abs(t - c) < 0.025);
      borde.push([x, signo * (corte ? ancho * 0.35 : ancho)]);
    }
    return borde;
  };
  puntos.push([0, 0], ...lado(1), ...lado(-1).reverse());
  s.moveTo(puntos[0]![0], puntos[0]![1]);
  for (const [x, y] of puntos.slice(1)) s.lineTo(x, y);
  s.closePath();
  return s;
}

/** Geometría de radio (o largo) 1 de cada parte. */
export function geometriaParteFlor(parte: ParteFlor): THREE.BufferGeometry {
  if (parte === "florecita") return new THREE.SphereGeometry(1, 8, 6);
  if (parte === "hoja") return new THREE.SphereGeometry(1, 10, 6);
  if (parte === "punto") return new THREE.SphereGeometry(1, 6, 4);
  if (parte === "foliolo" || parte === "moneda") return new THREE.SphereGeometry(1, 10, 6);
  if (parte === "pluma") return geometriaPluma();
  if (parte === "tallo") return new THREE.CylinderGeometry(1, 1, 1, 6).rotateZ(Math.PI / 2).translate(0.5, 0, 0);
  // La monstera: silueta plana tendida en XZ (normal hacia +Y).
  if (parte === "monstera") return new THREE.ShapeGeometry(siluetaMonstera(), 1).rotateX(Math.PI / 2);
  const capa = Number(parte.slice(-1));
  return new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI * (0.55 + capa * 0.1));
}

/** Material de cada parte: blanco (el color va por instancia; si el material también lo llevara, se multiplicaría) salvo la hoja de la hortensia. */
export function materialParteFlor(parte: ParteFlor): THREE.MeshStandardMaterial | THREE.MeshLambertMaterial {
  if (parte === "pluma") return materialPlumaConTextura();
  if (parte === "hoja") return new THREE.MeshStandardMaterial({ color: 0x3f6b3a, roughness: 0.7 });
  if (parte === "monstera" || parte === "foliolo" || parte === "moneda" || parte === "tallo") return new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, side: THREE.DoubleSide });
  return new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: parte === "florecita" ? 0.8 : parte === "punto" ? 0.9 : 0.6 });
}

/** El material de la parte lleva su propio color (las demás toman el de la instancia). */
export const colorPropio = (parte: ParteFlor) => parte === "hoja";

export type PiezaDeFlor = { parte: ParteFlor; local: THREE.Matrix4; color: THREE.Color | null };

/** Azar determinista (cada flor siempre igual entre recargas). */
function azar(semilla: number): () => number {
  let x = (semilla * 2654435761) >>> 0 || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 100000) / 100000; };
}

/** Las partes de una flor u hoja (marco local: +Y la normal del hueco). */
export function partesFlor(f: FlorADibujar, semilla: number): PiezaDeFlor[] {
  if (f.tipo === "pampa") return partesPampa(f, semilla);
  return esHoja(f.tipo) ? partesHoja(f, semilla) : partesFlorDeTela(f, semilla);
}

function partesFlorDeTela(f: FlorADibujar, semilla: number): PiezaDeFlor[] {
  const salida: PiezaDeFlor[] = [];
  const color = new THREE.Color(f.hex);
  const radio = (f.diametroCm / 2) * CM;
  const r = azar(semilla);
  const q = new THREE.Quaternion();
  const vertical = new THREE.Vector3(0, 1, 0);
  const marco = (x: number, y: number, z: number, giroY: number, sx: number, sy: number, sz: number) =>
    new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(vertical, giroY), new THREE.Vector3(sx, sy, sz));
  if (f.tipo === "hortensia") {
    const e = radio * 0.2;
    for (let i = 0; i < 34; i++) {
      const u = r(), t = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const tinte = 0.85 + r() * 0.3;
      salida.push({ parte: "florecita", local: marco(s * Math.cos(t) * radio * 0.8, u * radio * 0.75, s * Math.sin(t) * radio * 0.8, 0, e, e, e), color: color.clone().multiplyScalar(tinte) });
    }
    const h = radio * 0.45;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + r();
      salida.push({ parte: "hoja", local: marco(Math.cos(a) * radio * 0.85, 0, Math.sin(a) * radio * 0.85, -a, h, h * 0.18, h * 0.55), color: null });
    }
  } else if (f.tipo === "rosa") {
    const capas: readonly ParteFlor[] = ["petalo0", "petalo1", "petalo2"];
    capas.forEach((parte, capa) => {
      const e = radio * (1 - capa * 0.25);
      salida.push({ parte, local: marco(0, capa * radio * 0.18, 0, capa * 0.9, e, e, e), color });
    });
  } else {
    const e = 0.45 * CM;
    for (let i = 0; i < 40; i++) {
      const u = r(), t = r() * Math.PI * 2, s = Math.sqrt(1 - u * u), k = radio * (0.4 + r() * 0.6);
      salida.push({ parte: "punto", local: marco(s * Math.cos(t) * k, u * k, s * Math.sin(t) * k, 0, e, e, e), color });
    }
  }
  return salida;
}

/**
 * Una hoja: tendida sobre la cara de los globos (plano XZ), hacia un lado al azar y levantada ~25° para asomar por
 * encima de los vecinos. `eje` lleva de su marco (largo sobre +X) al del hueco.
 */
function partesHoja(f: FlorADibujar, semilla: number): PiezaDeFlor[] {
  const r = azar(semilla);
  const largo = f.diametroCm * CM;
  const color = new THREE.Color(f.hex);
  const eje = new THREE.Matrix4().makeRotationY(r() * Math.PI * 2).multiply(new THREE.Matrix4().makeRotationZ(0.3 + r() * 0.25));
  const tono = () => color.clone().multiplyScalar(0.88 + r() * 0.2);
  const salida: PiezaDeFlor[] = [];
  // Una parte en el marco de la hoja: centro (x, z) sobre su plano, giro sobre la normal y escala.
  const parte = (p: ParteFlor, x: number, z: number, giro: number, sx: number, sy: number, sz: number, c: THREE.Color = tono()) =>
    salida.push({ parte: p, local: eje.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), giro), new THREE.Vector3(sx, sy, sz))), color: c });
  switch (f.tipo) {
    case "monstera":
      parte("monstera", 0, 0, 0, largo, 1, largo);
      break;
    case "palma":
    case "helecho": {
      // Nervio central y foliolos a los dos lados (la palma largos y anchos; el helecho más chicos hacia la punta).
      parte("tallo", 0, 0, 0, largo, 0.25 * CM, 0.25 * CM);
      const n = f.tipo === "palma" ? 11 : 14;
      for (let i = 1; i <= n; i++) {
        const t = i / (n + 1);
        const l = largo * (f.tipo === "palma" ? 0.42 * (1 - t * 0.45) : 0.3 * (1 - t * 0.75));
        const ancho = l * (f.tipo === "palma" ? 0.1 : 0.22);
        for (const lado of [1, -1] as const) {
          const a = lado * (f.tipo === "palma" ? 0.85 : 1.1);
          parte("foliolo", largo * t + Math.cos(a) * l * 0.5, -Math.sin(a) * l * 0.5, a, l / 2, 0.15 * CM, ancho / 2);
        }
      }
      break;
    }
    case "eucalipto": {
      parte("tallo", 0, 0, 0, largo, 0.18 * CM, 0.18 * CM, new THREE.Color("#6b7f5e"));
      for (let i = 0; i < 8; i++) {
        const t = 0.15 + (i / 8) * 0.85, d = largo * 0.16 * (1 - t * 0.35), lado = i % 2 ? 1 : -1;
        parte("moneda", largo * t, lado * d * 0.55, 0, d / 2, 0.12 * CM, d / 2);
      }
      break;
    }
    case "hoja_seca":
      // Abanico de plumas finas (pampa u hoja seca dorada), abierto ±35°.
      for (let i = 0; i < 7; i++) {
        const a = -0.6 + (i / 6) * 1.2, l = largo * (0.75 + r() * 0.25);
        parte("foliolo", Math.cos(a) * l * 0.5, Math.sin(a) * l * 0.5, -a, l / 2, 0.12 * CM, l * 0.06);
      }
      break;
    default:
      break;
  }
  return salida;
}

/**
 * Una pampa: tallo fino y curvo (cuatro tramos) y, al final, el penacho, que sigue la curva y cabecea un poco por su peso. Las pampas
 * de las guirnaldas reales apuntan afuera y arriba, no cuelgan: por eso se necesita la normal del hueco (el marco local va girado
 * hasta ella) para saber dónde queda el arriba del mundo y abrirse hacia allá; el tallo se va enderezando hacia él. Arranca 3 cm por debajo del origen para que no se vea cortado entre los globos.
 */
function partesPampa(f: FlorADibujar, semilla: number): PiezaDeFlor[] {
  const r = azar(semilla);
  const largo = f.diametroCm * CM;
  const color = new THREE.Color(f.hex).multiplyScalar(0.94 + r() * 0.12);
  const paja = new THREE.Color("#a8895a");
  const inclinacion = 0.1 + r() * 0.35, curva = 0.2 + r() * 0.4;
  const largoTallo = largo * 0.42, tramos = 4;
  const normal = f.normal ? new THREE.Vector3(f.normal.x, f.normal.y, f.normal.z).normalize() : new THREE.Vector3(0, 1, 0);
  const arriba = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal).invert());
  // Se abre hacia donde queda el arriba del mundo (con algo de azar); en un hueco que mira justo arriba o abajo, hacia cualquier lado.
  const rumbo = Math.hypot(arriba.x, arriba.z) > 0.2 ? Math.atan2(arriba.z, arriba.x) + (r() - 0.5) * 1.6 : r() * Math.PI * 2;
  // Ninguna pampa cuelga por debajo de la guirnalda: aun en un hueco que mira hacia abajo el tallo se endereza hacia arriba (la mitad); en uno de lado o hacia arriba, del todo.
  const enderezo = 0.5 + 0.5 * THREE.MathUtils.clamp(0.5 + 0.9 * arriba.y, 0, 1);
  const direccion = (angulo: number, haciaArriba: number) =>
    new THREE.Vector3(Math.sin(angulo) * Math.cos(rumbo), Math.cos(angulo), Math.sin(angulo) * Math.sin(rumbo)).lerp(arriba, haciaArriba).normalize();
  const salida: PiezaDeFlor[] = [];
  const eje = new THREE.Vector3(1, 0, 0);
  let punto = new THREE.Vector3(0, -3 * CM, 0);
  let d = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < tramos; i++) {
    const t = (i + 0.5) / tramos;
    d = direccion(inclinacion + curva * t, enderezo * t * t);
    const tramo = largoTallo / tramos;
    salida.push({ parte: "tallo", local: new THREE.Matrix4().compose(punto, new THREE.Quaternion().setFromUnitVectors(eje, d), new THREE.Vector3(tramo * 1.04, 0.26 * CM, 0.26 * CM)), color: paja });
    punto = punto.clone().addScaledVector(d, tramo);
  }
  const alto = largo * 0.55, semiancho = largo * 0.14;
  const cabeceo = d.clone().addScaledVector(arriba, -0.3).normalize();
  const orientacion = new THREE.Quaternion().setFromAxisAngle(cabeceo, r() * Math.PI * 2).multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), cabeceo));
  salida.push({ parte: "pluma", local: new THREE.Matrix4().compose(punto.clone().addScaledVector(cabeceo, -alto * 0.1), orientacion, new THREE.Vector3(semiancho, alto, semiancho)), color });
  return salida;
}
