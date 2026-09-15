import assert from "node:assert/strict";
import { calcularDespieceEstructura, calcularEje, calcularMedidas, ErrorRepartoGlobos, MEZCLAS_DISPONIBLES, proporcionesEfectivas, pulgadasDeMezcla, type Densidad, type Figura, type Mezcla } from "../src/lib/medidas/geometria";

const base = {
  tipo: "arco" as const,
  medidas: { anchoM: 3, altoM: 2.4 },
  densidad: "media" as const,
  mezcla: "organica_fina" as const,
};
const uno = calcularDespieceEstructura({ ...base, repeticiones: 1, materiales: [{ color: "rojo", participacion: 0.6 }, { color: "dorado", participacion: 0.4 }] });
const seis = calcularDespieceEstructura({ ...base, repeticiones: 6, materiales: [{ color: "rojo", participacion: 0.6 }, { color: "dorado", participacion: 0.4 }] });
const tamanos = new Set(uno.despiece.map((linea) => linea.pulgadas));
assert.equal(uno.despiece.length, 10);
for (const tamano of tamanos) {
  assert.ok(uno.despiece.some((linea) => linea.pulgadas === tamano && linea.color === "rojo"));
  assert.ok(uno.despiece.some((linea) => linea.pulgadas === tamano && linea.color === "dorado"));
}
assert.equal(uno.despiece.reduce((sum, linea) => sum + linea.cantidad, 0), uno.totalGlobos);
assert.ok(seis.despiece.every((linea, index) => linea.cantidad === uno.despiece[index]!.cantidad * 6));
for (let i = 0; i < 200; i += 1) {
  const rojo = (i + 1) / 201;
  const resultado = calcularDespieceEstructura({ ...base, repeticiones: 1, materiales: [{ color: "rojo", participacion: rojo }, { color: "dorado", participacion: 1 - rojo }] });
  assert.equal(resultado.despiece.reduce((sum, linea) => sum + linea.cantidad, 0), resultado.totalGlobos);
}
const estableA = JSON.stringify(calcularDespieceEstructura({ ...base, repeticiones: 2, materiales: [{ color: "rojo", participacion: 0.7 }, { color: "dorado", participacion: 0.3 }] }));
const estableB = JSON.stringify(calcularDespieceEstructura({ ...base, repeticiones: 2, materiales: [{ color: "rojo", participacion: 0.7 }, { color: "dorado", participacion: 0.3 }] }));
assert.equal(estableA, estableB);

const referenciaArco = calcularDespieceEstructura({
  tipo: "arco",
  medidas: { anchoM: 3, altoM: 2.5 },
  repeticiones: 1,
  densidad: "media",
  mezcla: "organica_fina",
  materiales: [{ participacion: 1 }],
});
const referenciaColumnas = calcularDespieceEstructura({
  tipo: "columna",
  medidas: { altoM: 1.5 },
  repeticiones: 2,
  densidad: "media",
  mezcla: "organica_fina",
  materiales: [{ participacion: 1 }],
});
const referencia = [...referenciaArco.despiece, ...referenciaColumnas.despiece].reduce((totales, linea) => {
  totales.set(linea.pulgadas, (totales.get(linea.pulgadas) ?? 0) + linea.cantidad);
  return totales;
}, new Map<number, number>());
assert.ok(referenciaArco.totalGlobos >= 110 && referenciaArco.totalGlobos <= 140);
assert.ok(referenciaColumnas.totalGlobos / 2 >= 25 && referenciaColumnas.totalGlobos / 2 <= 32);
assert.ok(referenciaArco.totalGlobos + referenciaColumnas.totalGlobos >= 166 && referenciaArco.totalGlobos + referenciaColumnas.totalGlobos <= 217);
assert.ok((referencia.get(5) ?? 0) >= 35 && (referencia.get(5) ?? 0) <= 50);
assert.ok((referencia.get(9) ?? 0) >= 30 && (referencia.get(9) ?? 0) <= 40);
assert.ok((referencia.get(12) ?? 0) >= 90 && (referencia.get(12) ?? 0) <= 110);
assert.ok((referencia.get(18) ?? 0) >= 8 && (referencia.get(18) ?? 0) <= 12);
assert.ok((referencia.get(24) ?? 0) >= 3 && (referencia.get(24) ?? 0) <= 5);
// Regresión: el eje del semiarco era `largo || ancho` e ignoraba el alto, así
// que un semiarco alto de 1,2 × 2,2 m contaba menos globos que una columna de 1,8 m.
const semiarcoAlto = calcularDespieceEstructura({ tipo: "semiarco", medidas: { anchoM: 1.2, altoM: 2.2 }, repeticiones: 1, densidad: "media", mezcla: "organica_fina", materiales: [{ participacion: 1 }] });
const columnaMedia = calcularDespieceEstructura({ tipo: "columna", medidas: { altoM: 1.8 }, repeticiones: 1, densidad: "media", mezcla: "organica_fina", materiales: [{ participacion: 1 }] });
assert.ok(Math.abs(calcularEje("semiarco", { anchoM: 1.2, altoM: 2.2 }) - 2.7284) < 1e-3);
assert.ok(semiarcoAlto.ejeM > columnaMedia.ejeM && semiarcoAlto.totalGlobos > columnaMedia.totalGlobos, `${semiarcoAlto.totalGlobos} vs ${columnaMedia.totalGlobos}`);
assert.ok(calcularEje("semiarco", { anchoM: 1.2, altoM: 3 }) > calcularEje("semiarco", { anchoM: 1.2, altoM: 2.2 }));
// Regresión: el chat manda largo_m como profundidad; con ancho y alto manda la elipse.
assert.ok(Math.abs(calcularEje("semiarco", { anchoM: 1.2, altoM: 2.2, largoM: 0.5 }) - 2.7284) < 1e-3);
assert.equal(calcularEje("semiarco", { largoM: 3 }), 3);
assert.equal(calcularEje("semiarco", { anchoM: 2.4 }), 2.4);
assert.equal(calcularEje("guirnalda", { largoM: 2.5, altoM: 2.2 }), 2.5);
// Regresión I12: dos materiales del mismo color son dos productos; cada línea conserva su material.
const dosAzules = calcularDespieceEstructura({ tipo: "columna", medidas: { altoM: 1.8 }, repeticiones: 1, densidad: "media", mezcla: "clasica", materiales: [{ color: "azul", participacion: 0.6 }, { color: "azul", participacion: 0.4 }] });
const unidadesDeMaterial = (indice: number) => dosAzules.despiece.filter((linea) => linea.materialIndex === indice).reduce((suma, linea) => suma + linea.cantidad, 0);
assert.ok(unidadesDeMaterial(0) > unidadesDeMaterial(1) && unidadesDeMaterial(1) > 0, `${unidadesDeMaterial(0)} / ${unidadesDeMaterial(1)}`);
assert.equal(unidadesDeMaterial(0) + unidadesDeMaterial(1), dosAzules.totalGlobos);

// --- Tamaños obligatorios del cliente (ADR 0022) ---------------------------
// La mezcla efectiva son los tamaños de la mezcla dentro del conjunto pedido,
// renormalizados a 1; si ninguno está, partes iguales entre los pedidos. El
// total sale de esa mezcla efectiva, así que el arco deja de cotizarse a la
// mitad (R-12 solo) y un tamaño fuera de la mezcla deja de multiplicarlo.
const arcoBase = { tipo: "arco" as const, medidas: { anchoM: 3, altoM: 2.4 }, repeticiones: 1, densidad: "media" as const, materiales: [{ participacion: 1 }] };
const arcoConTamanos = (mezcla: Mezcla, tamanos?: number[]) => calcularDespieceEstructura({ ...arcoBase, mezcla, tamanos });
assert.equal(arcoConTamanos("organica_fina").totalGlobos, 119);
assert.equal(arcoConTamanos("organica_fina", [12]).totalGlobos, 104, "antes 65: el total salía de la mezcla completa");
assert.equal(arcoConTamanos("organica_fina", [12, 18]).totalGlobos, 94, "antes 71");
assert.equal(arcoConTamanos("clasica", [18, 24]).totalGlobos, 64, "antes 264: proporción 1 por tamaño");
assert.equal(arcoConTamanos("organica_fina", [36]).totalGlobos, 35, "antes 119 globos de 36 pulgadas");
// Un tamaño pedido que la mezcla no puede ubicar queda visible, no se pierde.
assert.deepEqual(arcoConTamanos("organica_fina", [12, 36]).tamanosSinUbicar, [36]);
assert.deepEqual(arcoConTamanos("organica_fina", [12, 36]).despiece.map((linea) => linea.pulgadas), [12]);
assert.deepEqual(arcoConTamanos("organica_fina", [36]).tamanosSinUbicar, [], "sin tamaños de la mezcla se reparten por partes iguales");
// El conteo baja al crecer el diámetro exigido: es el mismo modelo de área.
const totalesPorTamano = [5, 9, 12, 18, 24].map((pulgadas) => arcoConTamanos("organica_fina", [pulgadas]).totalGlobos);
assert.ok(totalesPorTamano.every((total, index) => index === 0 || total < totalesPorTamano[index - 1]!), JSON.stringify(totalesPorTamano));
// El invariante de cuotas falla en vez de inventar un conteo.
assert.throws(
  () => calcularMedidas({ figura: "arco", anchoM: 3, altoM: 2.4, proporciones: [{ pulgadas: 12, proporcion: 0.5 }] }),
  ErrorRepartoGlobos,
);
for (const mezcla of MEZCLAS_DISPONIBLES) {
  const pedidos = [5, 9, 12, 18, 24, 36];
  for (let mascara = 1; mascara < 2 ** pedidos.length; mascara += 1) {
    const tamanos = pedidos.filter((_pulgadas, indice) => (mascara >> indice) & 1);
    const { proporciones, sinUbicar } = proporcionesEfectivas(mezcla, tamanos);
    const suma = proporciones.reduce((total, tamano) => total + tamano.proporcion, 0);
    assert.ok(Math.abs(suma - 1) < 1e-9, `${mezcla} ${tamanos}: proporciones suman ${suma}`);
    assert.ok(proporciones.every((tamano) => tamanos.includes(tamano.pulgadas)), `${mezcla} ${tamanos}: tamaño fuera de lo pedido`);
    const enMezcla = pulgadasDeMezcla(mezcla).filter((pulgadas) => tamanos.includes(pulgadas));
    assert.deepEqual(sinUbicar, enMezcla.length ? tamanos.filter((pulgadas) => !enMezcla.includes(pulgadas)) : []);
    const resultado = calcularDespieceEstructura({ ...arcoBase, mezcla, tamanos, materiales: [{ color: "rojo", participacion: 0.7 }, { color: "azul", participacion: 0.3 }] });
    assert.equal(resultado.despiece.reduce((total, linea) => total + linea.cantidad, 0), resultado.totalGlobos);
    assert.ok(resultado.despiece.every((linea) => tamanos.includes(linea.pulgadas)), `${mezcla} ${tamanos}: línea fuera de lo pedido`);
  }
}

// --- Reparto en dos márgenes (ADR 0022) ------------------------------------
// El total por tamaño no depende de cuántos colores tenga la estructura (antes
// un segundo color borraba el acento R-24) y el total por material se queda a
// menos de una unidad de su participación en cada instancia.
const FIGURAS: Array<{ tipo: Figura; medidas: { anchoM?: number; altoM?: number; largoM?: number }; repeticiones: number }> = [
  { tipo: "arco", medidas: { anchoM: 3, altoM: 2.4 }, repeticiones: 1 },
  { tipo: "columna", medidas: { altoM: 1.8 }, repeticiones: 3 },
  { tipo: "guirnalda", medidas: { largoM: 2.5 }, repeticiones: 2 },
  { tipo: "centro_mesa", medidas: { anchoM: 0.4, altoM: 0.5 }, repeticiones: 10 },
  { tipo: "pared", medidas: { anchoM: 2.4, altoM: 2.4 }, repeticiones: 1 },
];
const REPARTOS: number[][] = [[1], [0.5, 0.5], [0.6, 0.4], [0.7, 0.2, 0.1], [0.34, 0.33, 0.33], [0.4, 0.3, 0.2, 0.1], [0.97, 0.01, 0.01, 0.01]];
const DENSIDADES: Densidad[] = ["sencilla", "media", "lujosa"];
let combinaciones = 0;
for (const figura of FIGURAS) {
  for (const mezcla of MEZCLAS_DISPONIBLES) {
    for (const densidad of DENSIDADES) {
      const referencia = calcularDespieceEstructura({ tipo: figura.tipo, medidas: figura.medidas, repeticiones: 1, densidad, mezcla, materiales: [{ participacion: 1 }] });
      const totalPorTamanoReferencia = new Map(referencia.despiece.map((linea) => [linea.pulgadas, linea.cantidad]));
      for (const participaciones of REPARTOS) {
        const materiales = participaciones.map((participacion, indice) => ({ color: `color-${indice}`, participacion }));
        const resultado = calcularDespieceEstructura({ tipo: figura.tipo, medidas: figura.medidas, repeticiones: figura.repeticiones, densidad, mezcla, materiales });
        const etiqueta = `${figura.tipo}/${mezcla}/${densidad}/${participaciones.length} materiales`;
        combinaciones += 1;
        assert.equal(resultado.despiece.length, pulgadasDeMezcla(mezcla).length * participaciones.length, etiqueta);
        assert.equal(resultado.despiece.reduce((total, linea) => total + linea.cantidad, 0), resultado.totalGlobos, etiqueta);
        assert.equal(resultado.totalGlobos, referencia.totalGlobos * figura.repeticiones, etiqueta);
        const porTamano = new Map<number, number>();
        const porMaterial = new Map<number, number>();
        for (const linea of resultado.despiece) {
          porTamano.set(linea.pulgadas, (porTamano.get(linea.pulgadas) ?? 0) + linea.cantidad);
          porMaterial.set(linea.materialIndex, (porMaterial.get(linea.materialIndex) ?? 0) + linea.cantidad);
        }
        for (const [pulgadas, cantidad] of porTamano) {
          assert.equal(cantidad, (totalPorTamanoReferencia.get(pulgadas) ?? 0) * figura.repeticiones, `${etiqueta}: R-${pulgadas} depende del número de colores`);
        }
        for (const [indice, cantidad] of porMaterial) {
          const esperado = referencia.totalGlobos * participaciones[indice]!;
          assert.ok(Math.abs(cantidad / figura.repeticiones - esperado) < 1, `${etiqueta}: material ${indice} con ${cantidad / figura.repeticiones} frente a ${esperado}`);
        }
      }
    }
  }
}

console.log(`[PASS] geometría tamaño × color — ${uno.totalGlobos} globos, 10 celdas, 200 combinaciones sin pérdida, ${combinaciones} repartos en dos márgenes y 252 subconjuntos de tamaños obligatorios`);
