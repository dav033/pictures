/** La lista compartida de clases de fallo admitidas (matriz y barrido de CI): una clase fuera de ella falla la prueba. */
/**
 * Las únicas clases de fallo que la matriz admite: exactas, con su dirección, su causa medida y el extremo de globos por metro
 * que se midió (el más bajo para un «bajo», el más alto para un «sobre»). Una clase fuera de esta lista falla la prueba.
 */
export const CLASES_PERMITIDAS: ReadonlyMap<string, { razon: string; extremo: number }> = new Map([
  ["banda_conteo:guirnalda:media:bajo", { extremo: 15.75, razon: "Guirnalda orgánica media de 1,27 m con un color que sí tiene R-9 (570): 20 globos, 15,7 por metro frente al mínimo de 19 (banda de PARIDAD con 3 globos de margen = 21). Defecto del motor en guirnaldas cortas, visible desde que el margen relativo solo aplica a colores sin R-9; ver P-087." }],
  ["banda_conteo:aro_circular:lujosa:bajo", { extremo: 16.71, razon: "El aro lujoso cuenta por debajo de la banda de PARIDAD (24 a 40 por metro): PERFIL_ARO de calibracion-organica.ts recorta el relleno R-5 del aro." }],
  ["banda_conteo:aro_circular:media:bajo", { extremo: 13.79, razon: "El aro medio cuenta por debajo de la banda (19 a 26 por metro) por el mismo PERFIL_ARO." }],
  ["banda_conteo:aro_circular:sencilla:bajo", { extremo: 10.88, razon: "El aro ligero cuenta por debajo de la banda (13 a 20 por metro) por el mismo PERFIL_ARO." }],
  ["banda_conteo:columna:sencilla:bajo", { extremo: 10.53, razon: "Columna orgánica de 0,55 m de grosor: la banda de PARIDAD supone el grosor por defecto de 0,7 m (medidas-espec.ts, GROSOR_ORGANICO_POR_DEFECTO_M)." }],
  ["banda_conteo:columna:media:bajo", { extremo: 13.16, razon: "Columna orgánica de 0,55 m de grosor, mismo límite de grosor que la banda de 0,7 m." }],
  ["banda_conteo:columna:lujosa:bajo", { extremo: 18.95, razon: "Columna orgánica lujosa de 0,55 m: cuenta por debajo de la banda de 0,7 m." }],
  ["banda_conteo:columna_asimetrica:sencilla:bajo", { extremo: 10.53, razon: "Columna asimétrica de 0,55 m, mismo límite de grosor que la columna orgánica." }],
  ["banda_conteo:columna_asimetrica:media:bajo", { extremo: 13.68, razon: "Columna asimétrica de 0,55 m, mismo límite de grosor que la columna orgánica." }],
  ["banda_conteo:columna_asimetrica:lujosa:bajo", { extremo: 17.89, razon: "Columna asimétrica lujosa de 0,55 m: cuenta por debajo de la banda de 0,7 m." }],
  ["banda_conteo:columna_asimetrica:lujosa:sobre", { extremo: 45.35, razon: "Columna asimétrica de 0,72 m de grosor: el tubo más grueso que el de referencia (0,7 m) lleva más globos por metro que la banda." }],
]);
