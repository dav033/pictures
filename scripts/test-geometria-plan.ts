import assert from "node:assert/strict";
import { calcularDespieceEstructura, calcularEje } from "../src/lib/medidas/geometria";

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
console.log(`[PASS] geometría tamaño × color — ${uno.totalGlobos} globos, 10 celdas y 200 combinaciones sin pérdida`);
