import * as THREE from "three";

/**
 * **La pluma de la hierba de la pampa**: un penacho esponjoso, largo y ovalado, hecho con cuatro tarjetas cruzadas (cada una con sus dos
 * caras) y una textura con cientos de hebras finas translúcidas. Es lo que dibujan el follaje `pampa` de las guirnaldas y las plumas
 * del jarrón con pampas: una sola geometría (de alto 1 sobre +Y, base en el origen, medio ancho 1) que cada quien escala a su tamaño.
 *
 * Todo es de UN visor: la textura y el material los crea y libera quien dibuja (nada de cachés de módulo con objetos de la GPU, que
 * al liberarse un visor dejan lo de otro apuntando a lo borrado). Las hebras van en una `DataTexture` calculada a mano: no necesita
 * `canvas`, así que se puede crear y probar sin navegador.
 */

export const ANCHO_TEXTURA = 128;
export const ALTO_TEXTURA = 256;

const TARJETAS = 4;
/** Cuántas hebras largas y cuántos pelitos cortos del borde lleva la textura. */
const HEBRAS = 220;
const PELITOS = 150;

/** Azar determinista (la pluma sale siempre igual entre recargas). */
function azar(semilla: number): () => number {
  let x = (semilla * 2654435761) >>> 0 || 1;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 100000) / 100000; };
}

/** El semiancho relativo (0 a 1) de la pluma a la altura `v` (0 la base, 1 la punta): gota alargada, más ancha por el tercio de abajo. */
export function semianchoPluma(v: number): number {
  if (v <= 0 || v >= 1) return 0;
  return Math.sin(Math.PI * v ** 0.7) ** 0.85;
}

/**
 * Los píxeles RGBA de la textura de la pluma (fila 0 = la base): el raquis central, hebras que salen de él hacia fuera y se
 * enderezan hacia la punta, pelitos en el borde y una bruma tenue que las une. El color es blanco-grisáceo (el tono real lo pone
 * el color de cada copia) y el alfa es lo que dibuja la forma.
 */
export function pixelesPluma(semilla = 11): Uint8Array {
  const ancho = ANCHO_TEXTURA, alto = ALTO_TEXTURA, centro = ancho / 2;
  const datos = new Uint8Array(ancho * alto * 4);
  for (let i = 0; i < ancho * alto; i++) datos[i * 4] = datos[i * 4 + 1] = datos[i * 4 + 2] = 255;
  const r = azar(semilla);
  const limite = (y: number) => semianchoPluma(y / alto) * centro * 0.98;

  const marcar = (x: number, y: number, alfa: number, gris: number, radio: number) => {
    for (let py = Math.floor(y - radio); py <= Math.ceil(y + radio); py++) {
      if (py < 0 || py >= alto) continue;
      for (let px = Math.floor(x - radio); px <= Math.ceil(x + radio); px++) {
        if (px < 0 || px >= ancho) continue;
        const cobertura = Math.min(1, 1.35 * (1 - Math.hypot(px + 0.5 - x, py + 0.5 - y) / (radio + 0.5)));
        if (cobertura <= 0) continue;
        const a = Math.round(alfa * cobertura * 255), i = (py * ancho + px) * 4;
        if (a <= datos[i + 3]!) continue;
        datos[i] = datos[i + 1] = datos[i + 2] = Math.round(gris * 255);
        datos[i + 3] = a;
      }
    }
  };

  // La bruma: une las hebras para que el penacho se vea esponjoso y no de alambres.
  for (let y = 0; y < alto; y++) {
    const l = limite(y);
    for (let x = 0; x < ancho; x++) {
      const d = Math.abs(x + 0.5 - centro) / (l || 1);
      if (d >= 1) continue;
      datos[(y * ancho + x) * 4 + 3] = Math.round(255 * 0.4 * (1 - d) ** 0.7 * (0.7 + r() * 0.3));
    }
  }

  const hebra = (y0: number, largo: number, apertura: number, lado: number, alfa: number, radio: number) => {
    const gris = 0.8 + r() * 0.2;
    let x = centro, y = y0, giro = 0;
    const paso = 0.8;
    for (let s = 0; s < largo; s += paso) {
      const f = s / largo;
      const angulo = apertura * (1 - 0.88 * f ** 1.25) + giro;
      x += lado * Math.sin(angulo) * paso;
      y += Math.cos(angulo) * paso;
      if (y >= alto - 1 || Math.abs(x - centro) > limite(y)) break;
      giro += (r() - 0.5) * 0.04;
      marcar(x, y, alfa * (1 - 0.5 * f), gris * (0.88 + 0.12 * f), radio);
    }
  };

  for (let k = 0; k < HEBRAS; k++) {
    const y0 = 3 + r() * alto * 0.62;
    hebra(y0, alto * (0.28 + r() * 0.42), 0.35 + r() * 0.55, r() < 0.5 ? -1 : 1, 0.78 + r() * 0.2, 1 + r() * 0.5);
  }
  for (let k = 0; k < PELITOS; k++) {
    const y0 = alto * (0.08 + r() * 0.7);
    hebra(y0, alto * (0.1 + r() * 0.2), 0.5 + r() * 0.7, r() < 0.5 ? -1 : 1, 0.5 + r() * 0.3, 0.55);
  }
  // El raquis: una línea central tenue en el tercio de abajo y la mitad de la pluma (el resto lo dicen las hebras).
  for (let y = 0; y < alto * 0.55; y += 0.6) marcar(centro, y, 0.45, 0.85, 0.9);
  return datos;
}

/** La textura de la pluma de UN visor: quien la crea la libera (`dispose()`). */
export function crearTexturaPluma(): THREE.DataTexture {
  const textura = new THREE.DataTexture(pixelesPluma(), ANCHO_TEXTURA, ALTO_TEXTURA, THREE.RGBAFormat);
  textura.generateMipmaps = true;
  textura.minFilter = THREE.LinearMipmapLinearFilter;
  textura.magFilter = THREE.LinearFilter;
  textura.needsUpdate = true;
  return textura;
}

/**
 * La pluma como geometría de alto 1 (+Y), base en el origen y medio ancho 1: cuatro tarjetas cruzadas a 45° y arqueadas hacia un
 * lado, cada una con sus dos caras (la de atrás con el mismo sentido de normal: el material es `FrontSide`) y todas las normales
 * hacia +Y local, para que la luz la sombree como un penacho blando y no como láminas de papel.
 */
export function geometriaPluma(): THREE.BufferGeometry {
  const FILAS = 8, COLUMNAS = 2;
  const posiciones: number[] = [], normales: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let t = 0; t < TARJETAS; t++) {
    const giro = (t * Math.PI) / TARJETAS, c = Math.cos(giro), s = Math.sin(giro);
    for (const cara of [1, -1]) {
      const base = posiciones.length / 3;
      for (let j = 0; j <= FILAS; j++) {
        const v = j / FILAS;
        for (let i = 0; i <= COLUMNAS; i++) {
          const u = i / COLUMNAS, x = (u * 2 - 1) + 0.45 * v * v;
          posiciones.push(x * c, v, x * s);
          normales.push(0, 1, 0);
          uvs.push(u, v);
        }
      }
      for (let j = 0; j < FILAS; j++) {
        for (let i = 0; i < COLUMNAS; i++) {
          const a = base + j * (COLUMNAS + 1) + i, b = a + 1, d = a + COLUMNAS + 1, e = d + 1;
          if (cara === 1) indices.push(a, b, d, b, e, d);
          else indices.push(a, d, b, b, d, e);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(posiciones, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(normales, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  return g;
}

/**
 * El material de la pluma: translúcido y sin escribir profundidad (las hebras se mezclan entre sí), con luz (`MeshLambertMaterial`:
 * recibe la luz cálida de la sala y su sombra) y un piso de luz propia del 40 % de su color, para que no se apague en un ambiente
 * oscuro ni salga gris la que cuelga boca abajo (en una copia por instancias las normales giran con ella). Con instancias el color
 * va por copia, y el piso de luz lo sigue (se multiplica por `vColor` en el sombreador).
 */
export function materialPluma(mapa: THREE.Texture, hex = "#ffffff"): THREE.MeshLambertMaterial {
  const color = new THREE.Color(hex);
  const material = new THREE.MeshLambertMaterial({ color, emissive: color.clone().multiplyScalar(0.4), map: mapa, transparent: true, alphaTest: 0.03, depthWrite: false });
  material.onBeforeCompile = (sombreador) => {
    sombreador.fragmentShader = sombreador.fragmentShader.replace(
      "vec3 totalEmissiveRadiance = emissive;",
      ["vec3 totalEmissiveRadiance = emissive;", "#ifdef USE_COLOR", "  totalEmissiveRadiance *= vColor;", "#endif"].join("\n"),
    );
  };
  material.customProgramCacheKey = () => "pluma-pampa";
  return material;
}

/** Un material de pluma con su propia textura, que se libera junto con él (`material.dispose()` suelta las dos). */
export function materialPlumaConTextura(hex = "#ffffff"): THREE.MeshLambertMaterial {
  const mapa = crearTexturaPluma();
  const material = materialPluma(mapa, hex);
  material.addEventListener("dispose", () => mapa.dispose());
  return material;
}
