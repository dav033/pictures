/**
 * Qué colores de una foto sobreviven al filtro de «solo lo que el análisis nombró».
 *
 * La regla del análisis es que una pieza lista los globos que lleva, y quién los nombra es el analizador:
 * los píxeles no sirven para descubrir un color nuevo —son los que meten la pared, la sombra y la mesa—, sino
 * para decir **cuál** de los nombrados es cada zona.
 *
 * Esta prueba fija dos cosas. La primera, que **nombrar un color no es acertar con el nombre de la lámina**:
 * el analizador
 * escribe lo que ve con sus palabras (`forest green`, `light green`, `emerald green`) y el catálogo llama a
 * sus verdes Verde Trébol, Verde Lima, Verde Selva, Eucalipto, Té Verde, Verde Menta y Verde Aurora. Pedir el
 * nombre exacto hacía que una foto de un arco verde oscuro, verde lima y blanco saliera con **un solo color**,
 * el blanco, que era la única etiqueta que la lámina conocía — que es justo lo que se vio en pantalla.
 *
 * La segunda, que **nombrar da ventaja pero no es un requisito para existir**. El color exacto no se puede
 * sacar de una foto, así que un color que nadie nombró se queda con la referencia más cercana en vez de
 * desaparecer. Lo que impide que la pared y la mesa llenen la pantalla son los pasos de antes —el croquis
 * recorta la zona, se descarta lo que ocupa menos del 6 % y se topa en cinco colores—, no el nombre.
 *
 * Sin red ni proveedores: solo la tabla del catálogo.
 *
 *   npx tsx scripts/test/test-color-nombrado.ts
 */
import assert from "node:assert/strict";
import { acabadoObservado } from "@/lib/plan/acabado-observado";
import { codigosPorPalabras, cruzarColor, referenciaPorCodigo, CODIGOS_POR_NOMBRE_EN } from "@/lib/plan/referencia-sempertex";

let casos = 0;
const ok = (texto: string) => {
  casos += 1;
  console.log(`[PASS] ${texto}`);
};

const nombradas = (etiquetas: readonly string[]) =>
  acabadoObservado(etiquetas, CODIGOS_POR_NOMBRE_EN, codigosPorPalabras);

/** Si un color medido gana la ventaja de lo nombrado, y con qué referencia se queda. */
function cruce(etiquetas: readonly string[], hex: string) {
  const acabado = nombradas(etiquetas);
  const resultado = cruzarColor(hex, {
    cuantas: 3,
    familias: acabado.familias,
    nombradas: acabado.nombradas.flatMap((n) => n.codigos),
  });
  return { sobrevive: resultado.porNombre, codigo: resultado.candidatas[0]?.codigo ?? null };
}

// ---------------------------------------------------------------------------
// 1. Las palabras del analizador que la lámina no conoce
// ---------------------------------------------------------------------------
{
  for (const etiqueta of ["forest green", "light green", "emerald green", "olive green"]) {
    assert.equal(CODIGOS_POR_NOMBRE_EN.get(etiqueta), undefined, `${etiqueta} no está en la lámina por su nombre`);
    const codigos = codigosPorPalabras(etiqueta);
    assert.ok(codigos.length >= 7, `${etiqueta} abre los verdes del catálogo (abrió ${codigos.length})`);
    assert.ok(
      codigos.every((c) => (referenciaPorCodigo(c)?.nombreBase ?? "").includes("green")),
      `${etiqueta} solo abre verdes`,
    );
  }
  ok("una etiqueta que la lámina no conoce por su nombre abre las candidatas de su color");
}

// ---------------------------------------------------------------------------
// 2. La palabra que encabeza manda; la que modifica solo acota si deja algo
// ---------------------------------------------------------------------------
{
  // `light pink` sí existe en la lámina, así que la modificadora cierra de verdad: deja menos que `pink`.
  const rosados = codigosPorPalabras("pink");
  const claros = codigosPorPalabras("light pink");
  assert.ok(claros.length > 0 && claros.length < rosados.length, "«light pink» deja menos que «pink»");
  assert.ok(claros.every((c) => rosados.includes(c)), "y todas las que deja son rosados");

  // `light green` no existe en la lámina: cerrar por «light» dejaría cero, así que se ignora y quedan todos
  // los verdes, que es mejor que quedarse sin ninguno.
  assert.deepEqual(codigosPorPalabras("light green"), codigosPorPalabras("green"), "«light green» deja todos los verdes");
  ok("la palabra que modifica acota solo mientras deje alguna candidata");
}

// ---------------------------------------------------------------------------
// 3. Una palabra que no encabeza ningún color no abre nada
// ---------------------------------------------------------------------------
{
  // En «rose gold» la cabeza es `gold`; `rose` solo lo modifica. Así que un `dusty rose` —que es un rosado
  // apagado— no puede abrir las candidatas del dorado rosa.
  assert.deepEqual(codigosPorPalabras("dusty rose"), [], "«rose» no encabeza ningún color de la lámina");
  assert.deepEqual(codigosPorPalabras("burgundy"), [], "una palabra que la lámina no usa no abre nada");
  const dorados = codigosPorPalabras("rose gold");
  assert.ok(dorados.length > 0 && dorados.every((c) => (referenciaPorCodigo(c)?.nombreBase ?? "").includes("gold")));
  ok("solo la palabra que encabeza un color abre candidatas; «dusty rose» no acaba en dorado rosa");
}

// ---------------------------------------------------------------------------
// 4. El caso que se vio en pantalla: un arco verde, verde lima y blanco
// ---------------------------------------------------------------------------
{
  const etiquetas = ["white", "dark green", "light green"];
  const acabado = nombradas(etiquetas);
  assert.equal(acabado.nombradas.length, 3, "las tres etiquetas nombran un color");
  assert.deepEqual(
    acabado.nombradas.map((n) => n.por),
    ["nombre", "nombre", "palabras"],
    "las dos primeras por su nombre, la tercera por sus palabras",
  );

  // Un verde lima medido sobrevive, y antes del arreglo se caía con el resto de los verdes.
  const lima = cruce(etiquetas, "#a8cf6a");
  assert.equal(lima.sobrevive, true, "el verde lima de la foto se queda");
  const blanco = cruce(etiquetas, "#f0f0ee");
  assert.equal(blanco.sobrevive, true, "el blanco se queda");
  ok("la foto del arco verde deja de salir con un solo color");
}

// ---------------------------------------------------------------------------
// 5. Nombrar da ventaja, pero no es un requisito para existir
// ---------------------------------------------------------------------------
{
  // El color exacto no se puede sacar de una foto —hay luz, sombra, oclusión entre globos y una cámara de por
  // medio—, así que exigirlo era exigir lo imposible. Un color que nadie nombró se queda con la referencia
  // más cercana; lo único que pierde es la ventaja de ir primero.
  const beige = cruce(["white", "dark green"], "#c9a87a");
  assert.equal(beige.sobrevive, false, "un beige que nadie nombró no gana la ventaja de lo nombrado");
  assert.ok(beige.codigo, "pero sí tiene una referencia más cercana, y es la que se muestra");

  // Y una etiqueta nombrada sí la gana, cuando los píxeles la admiten.
  const verde = cruce(["white", "dark green"], "#0d4f3c");
  assert.equal(verde.sobrevive, true, "un verde oscuro que el análisis nombró va primero");
  ok("nombrar un color le da ventaja, no es lo que le deja existir");
}

console.log(`\n${casos} casos en verde`);
