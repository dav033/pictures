import { calcularMedidas } from "../src/lib/medidas/geometria";
import { resolverVariantesPorDespiece } from "../src/lib/rag/tamanos/resolver";

/** Prueba manual de F3 contra el catálogo SQLite real (no mockeado). */
const PRODUCT_ID = "10134996254913"; // Globo Redondo Fashion Amarillo Miel — 9 variantes R-5..R-24

const medidas = calcularMedidas({ figura: "arco", anchoM: 3, altoM: 2.5, densidad: "media", mezcla: "organica_fina" });
console.log("Despiece calculado:", JSON.stringify(medidas.despiece, null, 2));
console.log("Total globos:", medidas.totalGlobos);

const resuelto = resolverVariantesPorDespiece(PRODUCT_ID, medidas.despiece);
console.log("\n--- Resuelto ---");
for (const linea of resuelto.lineas) {
  console.log(`  R-${linea.diamPulgPedido} -> variant ${linea.variantId} (diam entregado ${linea.diamPulgEntregado}) x${linea.cantidad} paquetes`, linea.sustitucion ? `SUSTITUCION: ${JSON.stringify(linea.sustitucion)}` : "");
}
console.log("Sin cobertura:", resuelto.sinCobertura);

// Caso de fallback: pedir un tamaño que ese producto NO tiene (ej. R-36, no está en las 9 variantes)
console.log("\n--- Caso fallback (R-36 no existe en este producto) ---");
const resuelto2 = resolverVariantesPorDespiece(PRODUCT_ID, [{ tamano: "R-36", pulgadas: 36, cantidad: 5 }]);
console.log(JSON.stringify(resuelto2, null, 2));

// Caso producto sin cobertura en absoluto (producto que no es globo redondo)
console.log("\n--- Caso sin cobertura (producto inexistente) ---");
const resuelto3 = resolverVariantesPorDespiece("producto-que-no-existe", medidas.despiece);
console.log("lineas:", resuelto3.lineas.length, "sinCobertura:", resuelto3.sinCobertura.length);
