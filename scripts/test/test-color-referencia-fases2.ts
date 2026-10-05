/**
 * Regresiones del camino de color de la foto de referencia (ADR-0024).
 *
 * Cubre lo que antes decidía el azar y ahora decide una regla:
 *  - 2.1  la dominancia medida manda sobre el orden en que el analizador escribió
 *  - 2.5  el gris de una foto se sustituye a plateado Y se le dice al cliente
 *  - 2.7  canonizar es idempotente, que es lo que permite hacerlo en la puerta
 *  - 2.10 una etiqueta ambigua no se resuelve por orden de lista
 *
 *   npx tsx --conditions=react-server scripts/test/test-color-referencia-fases2.ts
 *
 * Sin red, sin proveedor, sin coste.
 */
import assert from "node:assert/strict";
import { coloresDominantesReferencia, coloresFotoCliente, sustitucionesColorReferencia } from "../../src/lib/plan/colores-referencia";
import { colorDeCatalogo } from "../../src/lib/plan/colores-catalogo";
import { colorCatalogoMasCercano } from "../../src/lib/rag/catalog/similitud-color";

type Caso = { nombre: string; correr: () => void };

const casos: Caso[] = [
  {
    nombre: "2.1 · la medida manda sobre el orden de redacción del analizador",
    correr: () => {
      // El analizador escribió "gold" primero y "red" después; los píxeles dicen
      // que la pieza es 70 % roja. Antes ganaba el orden de redacción.
      const colores = coloresDominantesReferencia({
        observed_colors: ["gold", "red"],
        measured_colors: [
          { color: "rojo", share: 0.7 },
          { color: "dorado", share: 0.2 },
        ],
      });
      assert.deepEqual(colores, ["rojo", "dorado"]);
    },
  },
  {
    nombre: "2.1 · sin medida se mantiene el comportamiento anterior",
    correr: () => {
      assert.deepEqual(coloresDominantesReferencia({ observed_colors: ["gold", "red"] }), ["dorado", "rojo"]);
      // La firma vieja (una lista de etiquetas) sigue sirviendo a sus llamadores.
      assert.deepEqual(coloresDominantesReferencia(["gold", "red"]), ["dorado", "rojo"]);
    },
  },
  {
    nombre: "2.1 · el gris medido pasa como por las etiquetas: se sustituye por plateado y se avisa",
    correr: () => {
      // Cambio deliberado (2026-10-05, SEGUIMIENTO-color-referencia.md §4.1 b):
      // antes esta prueba congelaba `["blanco"]`. La medida se filtraba al
      // catálogo y el gris desaparecía sin sustitución ni aviso, mientras que las
      // mismas etiquetas sin medida daban `["gris", ...]` y el resolutor decía
      // "se usó plateado". Ahora un color que el catálogo no vende pero tiene con
      // qué comprarse (`colorDeCompraSinVenta`) pasa igual por los dos caminos. Y
      // el blanco medido ya no entra: el analizador no lo nombró (es la pared).
      const colores = coloresDominantesReferencia({
        observed_colors: ["grey"],
        measured_colors: [
          { color: "gris", share: 0.6 },
          { color: "blanco", share: 0.3 },
        ],
      });
      assert.deepEqual(colores, ["gris"]);
      // El caso de §4.1 b tal cual: las etiquetas y la medida dicen lo mismo.
      const etiquetas = ["matte grey", "white"];
      assert.deepEqual(coloresDominantesReferencia({ observed_colors: etiquetas }), ["gris", "blanco"]);
      const medido = coloresDominantesReferencia({ observed_colors: etiquetas, measured_colors: [{ color: "gris", share: 0.7 }, { color: "blanco", share: 0.2 }] });
      assert.deepEqual(medido, ["gris", "blanco"]);
      assert.deepEqual(sustitucionesColorReferencia("E1", medido, ["plateado", "blanco"]).map((item) => item.entregado), ["plateado"], "y el resolutor avisa que se usó plateado");
    },
  },
  {
    nombre: "2.1 · un color medido que el analizador no nombró no ocupa cupo, tampoco un neutro",
    correr: () => {
      // La pared blanca o el fondo negro que caen en la caja de la pieza se
      // llevaban uno de los tres cupos y echaban el lila (2026-10-05).
      const etiquetas = ["pearl pink", "chrome gold", "lilac"];
      for (const fondo of ["blanco", "negro"]) {
        const colores = coloresDominantesReferencia({
          observed_colors: etiquetas,
          measured_colors: [{ color: fondo, share: 0.45 }, { color: "rosado", share: 0.3 }, { color: "dorado", share: 0.2 }, { color: "lila", share: 0.05 }],
        });
        assert.deepEqual(colores, ["rosado", "dorado", "lila"], `fondo ${fondo}`);
      }
    },
  },
  {
    nombre: "2.5 · el gris de una foto va a plateado, no a negro",
    correr: () => {
      assert.equal(colorCatalogoMasCercano("gris", ["negro", "plateado", "blanco", "dorado"]), "plateado");
    },
  },
  {
    nombre: "2.5 · y el cliente se entera: la sustitución se reporta, no se silencia",
    correr: () => {
      // La decisión de producto es sustituir deliberadamente, no desaparecer el
      // color. Lo segundo es lo que hacía antes.
      const sustituciones = sustitucionesColorReferencia("E1", ["gris"], ["plateado"]);
      assert.equal(sustituciones.length, 1);
      assert.equal(sustituciones[0]?.pedido, "gris");
      assert.equal(sustituciones[0]?.entregado, "plateado");
      assert.match(sustituciones[0]?.motivo ?? "", /gris/);
    },
  },
  {
    nombre: "2.5 · el gris sigue visible en la paleta que se le muestra al cliente",
    correr: () => {
      // Filtrarlo aquí lo haría indistinguible de un color que la foto no tenía.
      const foto = (observed_colors: string[]) => ({
        palette: { observed: [], priority: [] },
        elements: [
          {
            approved: true,
            reference_bbox: { x: 0, y: 0, width: 1, height: 1 },
            appearance: {
              observed_colors,
              measured_colors: [
                { color: "gris", share: 0.6 },
                { color: "blanco", share: 0.3 },
              ],
            },
          },
        ],
        // El resto del elemento no participa en esta función.
      } as unknown as Parameters<typeof coloresFotoCliente>[0]);
      // Cambio deliberado (2026-10-05): antes esperaba `["gris", "blanco"]`
      // aunque el analizador solo nombró "grey". La paleta del cliente sigue la
      // misma regla que cada pieza (las etiquetas nombran, la medida ordena), así
      // que el cliente, el plan y los avisos hablan de los mismos colores: el
      // blanco medido sin nombre no se le enseña como color de su foto.
      assert.deepEqual(coloresFotoCliente(foto(["grey"])), ["gris"]);
      assert.deepEqual(coloresFotoCliente(foto(["grey", "white"])), ["gris", "blanco"], "nombrado, el blanco sí sale, en el orden de la medida");
    },
  },
  {
    nombre: "2.7 · canonizar es idempotente, y por eso puede hacerse en la puerta",
    correr: () => {
      for (const crudo of ["rosa", "azul rey", "rosado", "azul", "dorado"]) {
        const una = colorDeCatalogo(crudo);
        assert.equal(colorDeCatalogo(una), una, `no idempotente: ${crudo} -> ${una} -> ${colorDeCatalogo(una)}`);
      }
      assert.equal(colorDeCatalogo("rosa"), "rosado");
    },
  },
  {
    nombre: "2.10 · una etiqueta ambigua no la resuelve el orden de la lista",
    correr: () => {
      // "pink or coral": el analizador dijo que no sabe. Antes se tomaba el
      // primero y la mitad de las veces se compraba el otro.
      const colores = coloresDominantesReferencia({ observed_colors: ["pink or coral"] });
      assert.ok(colores.includes("rosado"), `esperaba rosado en ${JSON.stringify(colores)}`);
      assert.ok(colores.includes("coral"), `esperaba coral en ${JSON.stringify(colores)}`);
    },
  },
  {
    nombre: "2.10 · un tono de dos palabras sigue siendo UN color",
    correr: () => {
      // La regresión que protege el cambio anterior: "mint green" es menta, no
      // menta y verde.
      assert.deepEqual(coloresDominantesReferencia({ observed_colors: ["mint green"] }), ["menta"]);
      assert.deepEqual(coloresDominantesReferencia({ observed_colors: ["white and gold"] }), ["blanco", "dorado"]);
    },
  },
  {
    nombre: "transparencia · los globos transparentes se exigen además de los 3 colores de la pieza",
    correr: () => {
      // 2026-09-24: rosado, plateado, blanco y transparente en una columna; el
      // transparente quedaba cuarto y nunca se exigía.
      assert.deepEqual(coloresDominantesReferencia(["pink", "silver", "white", "clear"]), ["rosado", "plateado", "blanco", "transparente"]);
      // Los píxeles no ven un globo transparente: sale de las etiquetas aunque la medida mande en los tonos.
      // Cambio deliberado (2026-10-05): las etiquetas eran ["pink", "clear"] y se esperaba un plateado que
      // solo traía la medida (un neutro sin nombre entraba siempre). Ahora la plata tiene que estar nombrada
      // para ocupar cupo; nombrada, la medida la pone primero.
      assert.deepEqual(
        coloresDominantesReferencia({ observed_colors: ["pink", "silver", "clear"], measured_colors: [{ color: "plateado", share: 0.6 }, { color: "rosado", share: 0.4 }] }),
        ["plateado", "rosado", "transparente"],
      );
      assert.deepEqual(
        coloresDominantesReferencia({ observed_colors: ["pink", "clear"], measured_colors: [{ color: "plateado", share: 0.6 }, { color: "rosado", share: 0.4 }] }),
        ["rosado", "transparente"],
        "sin nombre, la plata medida no entra",
      );
      // "clear pink" es la línea Cristal teñida: rosado, no el transparente incoloro.
      assert.deepEqual(coloresDominantesReferencia(["clear pink", "silver"]), ["rosado", "plateado"]);
    },
  },
  {
    nombre: "transparencia · el gris junto al plateado no ocupa cupo, pero sigue para avisar la sustitución",
    correr: () => {
      // Se compran igual: contarlo dejaba fuera el blanco. Se queda en la lista
      // porque el resolutor le dice al cliente que se hizo con plateado (2.5).
      assert.deepEqual(coloresDominantesReferencia(["pink", "silver", "grey", "white", "clear"]), ["rosado", "plateado", "gris", "blanco", "transparente"]);
      // Sin plateado en la pieza, el gris ocupa su cupo como cualquier color.
      assert.deepEqual(coloresDominantesReferencia(["grey", "pink", "white", "gold"]), ["gris", "rosado", "blanco"]);
    },
  },
];

let fallos = 0;
for (const caso of casos) {
  try {
    caso.correr();
    console.log(`  ok   ${caso.nombre}`);
  } catch (error) {
    fallos += 1;
    console.log(`  FAIL ${caso.nombre}`);
    console.log(`       ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
}
console.log(fallos ? `\n${fallos} de ${casos.length} fallan` : `\n[PASS] ${casos.length} casos`);
process.exit(fallos ? 1 : 0);
