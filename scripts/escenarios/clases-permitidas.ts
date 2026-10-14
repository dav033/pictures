/** La lista compartida de clases de fallo admitidas (matriz y barrido de CI): una clase fuera de ella falla la prueba. */
/**
 * Las únicas clases de fallo que la matriz admite: exactas, con su dirección, su causa medida y el extremo de globos por metro
 * que se midió (el más bajo para un «bajo», el más alto para un «sobre»). Una clase fuera de esta lista falla la prueba.
 */
export const CLASES_PERMITIDAS: ReadonlyMap<string, { razon: string; extremo: number }> = new Map([
  ["banda_conteo:guirnalda:media:bajo", { extremo: 15.75, razon: "Guirnalda orgánica media de 1,27 m, con R-9 (570) o sin él (932, tras el relleno compensado de P-087): 20 globos, 15,7 por metro frente al mínimo de 19 (banda de PARIDAD con 3 globos de margen = 21), y 65 contra 66 en la de 3,66 m sin R-9. Queda de P-087: el defecto del motor en guirnaldas medias." }],
  // P-089: las columnas orgánicas llenan menos que su banda en tres casos medidos (barrido de 0,05 en 0,05 m de grosor y de 1 a 4 m de alto, con el 570 y el 056 sin R-9).
  // `margenBajoSinR9` perdona hasta el 30 % del mínimo; lo que queda por debajo se declara aquí con su extremo, no se esconde con una fracción mayor.
  ["banda_conteo:columna:media:bajo", { extremo: 11.5, razon: "Columna orgánica media: el 056 (sin R-9) de 0,7 m de grosor y 4 m de alto da 11,5 por metro contra la banda de PARIDAD del grosor por defecto (19 a 26 por metro menos el 30 %); las de 1 m de alto con R-9 dan 12 por metro (las bajas llevan menos globos por metro). Las columnas no reciben el relleno compensado de la guirnalda: P-089." }],
  ["banda_conteo:columna_asimetrica:media:bajo", { extremo: 11.5, razon: "Columna asimétrica media: mismo caso que la columna, 056 de 0,7 m de grosor y 4 m de alto (11,5 por metro), o de 1 m de alto con R-9 (15 por metro). P-089." }],
  ["banda_conteo:columna:lujosa:bajo", { extremo: 19, razon: "Columna orgánica lujosa de 1,05 m de grosor y 1 m de alto con el 056 (sin R-9): 19 por metro contra un mínimo medido de 29 a 47 por metro menos el 30 %; con R-9, 23 por metro a 0,7 m y 4 m de alto contra la banda de PARIDAD (24 a 40). P-089." }],
  ["banda_conteo:columna_asimetrica:lujosa:bajo", { extremo: 23, razon: "Columna asimétrica lujosa de 1,05 m de grosor y 1 m de alto con el 056 (sin R-9): 23 por metro contra el mínimo medido menos el 30 %. P-089." }],
]);
