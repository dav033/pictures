/**
 * El matiz medido del globo inflado, y que no se cuele nada por él.
 *
 * Run: npx tsx --conditions=react-server scripts/test/test-color-inflado-medido.ts
 *
 * Sin red y sin llamadas pagadas. Lo que se vigila: que la tabla medida sea
 * consistente, que la evidencia que la justifica siga siendo cierta (el globo
 * inflado es más claro que su tinta), que el matiz no se añada donde ya hay
 * prosa escrita a mano, y que con la bandera apagada el descriptor sea byte a
 * byte el de antes. Si el matiz mejora o no la foto que devuelve fal es otra
 * cosa: eso se mide contra el proveedor, con tope declarado, y por eso la
 * bandera nace apagada.
 */
import assert from "node:assert/strict";
import {
  COLORES_INFLADOS_MEDIDOS,
  colorInfladoMedido,
  familiaDeAcabado,
  medicionAmbigua,
} from "../../src/lib/lora/color-inflado-medido";
import {
  assertDescriptorPerceptualSeguro,
  compilarDescriptorProductoPerceptual,
  tieneDescripcionEscritaAMano,
} from "../../src/lib/lora/descriptor-perceptual";
import { claridadYCromaMedidos, matizMedido } from "../../src/lib/lora/matiz-medido";
import { labDeRgb } from "../../src/lib/rag/catalog/similitud-color";
import type { ProductConcept } from "../../src/lib/lora/product-vocabulary";

let passCount = 0;
function pass(name: string) {
  passCount += 1;
  console.log(`  ok ${passCount}. ${name}`);
}

const lab = (hex: string) =>
  labDeRgb(
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  );
const claridad = (hex: string) => lab(hex)[0];

// 1. La tabla es consistente: 71 referencias, hex válidos y una sola fila por
//    (color, familia) — que es la clave con la que se consulta.
{
  assert.equal(COLORES_INFLADOS_MEDIDOS.length, 71, "las 71 referencias medidas");
  const claves = new Map<string, number>();
  for (const fila of COLORES_INFLADOS_MEDIDOS) {
    assert.match(fila.inflado, /^#[0-9a-f]{6}$/, `${fila.codigo}: hex del globo inflado`);
    assert.match(fila.tinta, /^#[0-9a-f]{6}$/, `${fila.codigo}: hex de la tinta`);
    assert.match(fila.codigo, /^\d{3}$/, "código de la matriz de color");
    const clave = `${fila.color.toLowerCase()}|${fila.familia}`;
    claves.set(clave, (claves.get(clave) ?? 0) + 1);
  }
  const codigos = new Set(COLORES_INFLADOS_MEDIDOS.map((fila) => fila.codigo));
  assert.equal(codigos.size, COLORES_INFLADOS_MEDIDOS.length, "un código por fila");
  const ambiguas = [...claves].filter(([, cuantas]) => cuantas > 1);
  assert.deepEqual(ambiguas.map(([clave]) => clave).sort(), ["green|fashion", "purple|fashion"]);
  pass("71 referencias medidas, hex válidos, y las 2 claves ambiguas son las conocidas");
}

// 2. La evidencia que justifica todo esto: la tinta NO es el globo, y la
//    corrección no se puede adivinar. Si esto deja de ser cierto, medir deja de
//    tener sentido y basta con una regla.
{
  const distancia = COLORES_INFLADOS_MEDIDOS.map((fila) => {
    const [l1, a1, b1] = lab(fila.inflado);
    const [l2, a2, b2] = lab(fila.tinta);
    return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
  });
  const media = distancia.reduce((suma, valor) => suma + valor, 0) / distancia.length;
  assert.ok(media > 15, `la tinta está lejos del globo (ΔE medio ${media.toFixed(1)})`);
  assert.equal(distancia.filter((valor) => valor > 10).length, 59, "ΔE > 10 en 59 de las 71");
  // Y no es "siempre más claro": la claridad se mueve en las dos direcciones.
  const deltaClaridad = COLORES_INFLADOS_MEDIDOS.map(
    (fila) => claridad(fila.inflado) - claridad(fila.tinta),
  );
  const mediaClaridad =
    deltaClaridad.reduce((suma, valor) => suma + valor, 0) / deltaClaridad.length;
  assert.ok(Math.abs(mediaClaridad) < 3, `la claridad casi se cancela (${mediaClaridad.toFixed(1)})`);
  assert.ok(
    Math.max(...deltaClaridad) > 20 && Math.min(...deltaClaridad) < -20,
    "hay globos que aclaran más de 20 y otros que oscurecen más de 20",
  );
  pass(`la tinta está a ΔE ${media.toFixed(1)} del globo y la dirección varía: hay que medir`);
}

// 3. Lo que NO tiene medición: los neutros (no se pueden medir sobre una foto),
//    los surtidos y los acabados que no son de la matriz.
{
  assert.equal(colorInfladoMedido("white", "solid Fashion"), null, "un blanco no se mide");
  assert.equal(colorInfladoMedido("assorted colors", "solid Fashion"), null, "un surtido no es un color");
  assert.equal(colorInfladoMedido("red", "metallized foil"), null, "el foil no es de la matriz de látex");
  // Dos globos distintos con el mismo nombre en inglés: no se elige uno a ciegas.
  assert.ok(medicionAmbigua("green", "solid Fashion"), "green en Fashion son dos globos");
  assert.equal(colorInfladoMedido("green", "solid Fashion"), null, "una clave ambigua no mide");
  assert.equal(matizMedido("purple", "solid Fashion"), null, "ni califica");
  assert.equal(familiaDeAcabado("metallized foil"), null, "el foil no tiene familia");
  assert.equal(familiaDeAcabado("Silk satin"), "silk", "el acabado del vocabulario da su familia");
  // `spring pink` es la referencia que se describe a mano y verificada: su foto
  // tenía UN píxel cromático, así que quedó fuera de la medición a propósito.
  assert.equal(matizMedido("spring pink", "Silk satin"), null, "spring pink no tiene medición");
  assert.ok(tieneDescripcionEscritaAMano("spring pink"), "spring pink sí tiene prosa a mano");
  pass("los neutros, los surtidos, el foil y spring pink no reciben matiz medido");
}

// 4. El mismo nombre en dos familias son dos globos distintos.
{
  const repetidos = COLORES_INFLADOS_MEDIDOS.filter(
    (fila, indice, todas) => todas.findIndex((otra) => otra.color === fila.color) !== indice,
  );
  assert.ok(repetidos.length > 0, "hay nombres que se repiten entre familias");
  const [uno] = repetidos;
  const hermanas = COLORES_INFLADOS_MEDIDOS.filter((fila) => fila.color === uno!.color);
  assert.ok(
    new Set(hermanas.map((fila) => fila.familia)).size > 1,
    "el nombre repetido está en familias distintas",
  );
  pass(`${repetidos.length} nombres se repiten entre familias y el acabado los separa`);
}

// 5. El matiz dice lo que la medición dice, y nada más.
{
  for (const fila of COLORES_INFLADOS_MEDIDOS) {
    if (medicionAmbigua(fila.color, acabadoDe(fila.familia))) continue;
    const medida = claridadYCromaMedidos(fila.color, acabadoDe(fila.familia));
    assert.ok(medida, `${fila.codigo}: se puede medir`);
    const matiz = matizMedido(fila.color, acabadoDe(fila.familia));
    if (matiz === null) {
      assert.ok(
        medida!.claridad < 80 && medida!.claridad > 35 && medida!.croma > 22,
        `${fila.color}: sin matiz solo si cae en el medio de la distribución`,
      );
      continue;
    }
    if (matiz.includes("very pale")) assert.ok(medida!.claridad >= 80, `${fila.color}: very pale`);
    else if (matiz.includes("pale")) assert.ok(medida!.claridad >= 68, `${fila.color}: pale`);
    else if (matiz.includes("deep")) assert.ok(medida!.claridad <= 35, `${fila.color}: deep`);
    if (matiz.includes("muted")) assert.ok(medida!.croma <= 22, `${fila.color}: muted`);
  }
  pass("cada matiz se sostiene en la claridad y el croma medidos de su fila");
}

// 6. Con la bandera apagada, el descriptor es el de siempre; encendida, añade
//    el matiz delante del nombre sin renombrar nada y sigue pasando la puerta.
{
  const concepto = conceptoDe("light pink", "solid Fashion");
  delete process.env.COLOR_INFLADO_MEDIDO_V1;
  const apagada = compilarDescriptorProductoPerceptual(concepto);
  process.env.COLOR_INFLADO_MEDIDO_V1 = "true";
  const encendida = compilarDescriptorProductoPerceptual(concepto);
  delete process.env.COLOR_INFLADO_MEDIDO_V1;
  assert.equal(apagada, compilarDescriptorProductoPerceptual(concepto), "apagada, igual que antes");
  assert.notEqual(encendida, apagada, "encendida, el descriptor cambia");
  assert.ok(encendida.includes("light pink"), "el nombre del catálogo no se renombra");
  assert.match(encendida, /in (very )?(pale|deep)( muted)? light pink/, "el matiz va delante del nombre");
  assertDescriptorPerceptualSeguro(encendida);
  pass("la bandera apagada no cambia nada; encendida añade el matiz y pasa la puerta");
}

// 7. Un color que ya tiene prosa a mano no se califica dos veces.
{
  process.env.COLOR_INFLADO_MEDIDO_V1 = "true";
  const conProsa = compilarDescriptorProductoPerceptual(conceptoDe("champagne beige", "Satin"));
  delete process.env.COLOR_INFLADO_MEDIDO_V1;
  // "champagne" está en la tabla escrita a mano, así que `aDescriptorPerceptual`
  // lo reemplaza por su prosa; el matiz medido no se le suma delante.
  assert.ok(!/pale (very )?pale/.test(conProsa), `sin matiz duplicado: ${conProsa}`);
  assert.ok(!conProsa.includes("champagne"), "el nombre comercial no llega al modelo");
  assertDescriptorPerceptualSeguro(conProsa);
  pass("un color con prosa escrita a mano no recibe además el matiz medido");
}

function acabadoDe(familia: string): string {
  const acabados: Record<string, string> = {
    fashion: "solid Fashion",
    pastelMate: "Pastel Matte",
    pastelDusk: "Pastel Dusk muted",
    satin: "Satin",
    silk: "Silk satin",
    neon: "Neon fluorescent",
    metal: "metallic",
    reflex: "Reflex high-shine",
  };
  return acabados[familia] ?? "solid Fashion";
}

function conceptoDe(color: string, finish: string): ProductConcept {
  return {
    concept_id: "prueba",
    canonical_label: "prueba",
    aliases: [],
    product_ids: [],
    visual: {
      shape: "round",
      material: "latex balloons",
      color,
      finish,
      pattern: { kind: "solid", contains_text: false, text_policy: "none" },
    },
    scene_terms: null,
  } as unknown as ProductConcept;
}

console.log(`\nColor inflado medido: ${passCount} checks OK`);
