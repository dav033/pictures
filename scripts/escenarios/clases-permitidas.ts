/** La lista compartida de clases de fallo admitidas (matriz y barrido de CI): una clase fuera de ella falla la prueba. */
/**
 * Las únicas clases de fallo que la matriz admite: exactas, con su dirección, su causa medida y el extremo de globos por metro
 * que se midió (el más bajo para un «bajo», el más alto para un «sobre»). Una clase fuera de esta lista falla la prueba.
 */
export const CLASES_PERMITIDAS: ReadonlyMap<string, { razon: string; extremo: number }> = new Map([
  ["banda_conteo:guirnalda:media:bajo", { extremo: 15.75, razon: "Guirnalda orgánica media de 1,27 m, con R-9 (570) o sin él (932, tras el relleno compensado de P-087): 20 globos, 15,7 por metro frente al mínimo de 19 (banda de PARIDAD con 3 globos de margen = 21), y 65 contra 66 en la de 3,66 m sin R-9. Queda de P-087: el defecto del motor en guirnaldas medias." }],
  // Tras P-089, los casos 056 sin R-9 quedan dentro de la tolerancia medida; las clases restantes usan 570 con R-9.
  ["banda_conteo:columna:media:bajo", { extremo: 12, razon: "Columna orgánica media con 570 (R-9): alturas de 1 m y 1,24 m y grosores de 1,05 m quedan bajo PARIDAD por el peso del remate; extremo medido 12 globos/m. Los repros 056 sin R-9 pasan con P-089." }],
  ["banda_conteo:columna_asimetrica:media:bajo", { extremo: 16.75, razon: "Columna asimétrica media con 570 (R-9), 0,7 m de grosor y 4 m de alto: 16,75 globos/m frente al mínimo de 19. Los repros 056 sin R-9 pasan con P-089." }],
  ["banda_conteo:columna:lujosa:bajo", { extremo: 23, razon: "Columna orgánica lujosa con 570 (R-9), 0,7 m de grosor y 4 m de alto: 23 globos/m frente al mínimo de 24. Los repros 056 sin R-9 pasan con P-089." }],
  ["banda_conteo:columna_asimetrica:lujosa:bajo", { extremo: 23, razon: "Columna asimétrica lujosa con 570 (R-9), 0,7 m de grosor y 4 m de alto: 23 globos/m frente al mínimo de 24. Los repros 056 sin R-9 pasan con P-089." }],
]);
