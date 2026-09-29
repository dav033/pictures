import assert from "node:assert/strict";
import test from "node:test";
import {
  UTILIDAD_POR_DEFECTO,
  cantidadValida,
  descripcionMateriaPrima,
  filaVacia,
  filasMateriasPrimas,
  pesosEnteros,
  plantillaInicial,
  porcentajeValido,
  subtotalSeccion,
  totalFila,
  totalesPlantilla,
  utilidadEnPesos,
  type CompraParaPlantilla,
  type FilaPlantilla,
  type PlantillaCotizacion,
} from "./plantilla";

function fila(descripcion: string, costoUnitario: number, cantidad: number): FilaPlantilla {
  return { id: `prueba:${descripcion}`, descripcion, costoUnitario, cantidad };
}

/**
 * La cotización real de "Bouquet de flores moradas" (No. 128), fila por fila.
 * Es el oráculo de este módulo: si la hoja de la app deja de dar estos números,
 * dejó de servir para cotizar de verdad.
 */
const MATERIAS_REALES: FilaPlantilla[] = [
  fila("R-5 SILK AMATISTA X 50", 16_900, 1),
  fila("R-9 PATEL MATE LILA X 50", 14_350, 1),
  fila("T-260 SILK DORADO X 20", 10_250, 1),
  fila("R-5 SILK DORADO X 20", 6_850, 1),
  fila("R-9 SILK AMATISTA X 12", 7_000, 1),
  fila("T-260 FASHION FUCSIA X 20", 7_850, 1),
  fila("R-5 FASHION FUCSIA X 12", 3_500, 1),
  fila("R-5 SILK PERLA CREMA X 12", 6_850, 1),
  fila("R-9 SILK PERLA CREMA X 12", 10_600, 1),
  fila("BURBUJA 24 x 1", 6_000, 2),
  fila('FOIL 18" X 1', 5_800, 2),
];

const HOJA_REAL: PlantillaCotizacion = {
  cabecera: { proyecto: "Bouquet de flores moradas", fecha: "2026-02-12", contacto: "EMILIANO OVIEDO", numero: "128", lugar: "", celular: "" },
  secciones: {
    materias: MATERIAS_REALES,
    manoObra: [fila("Hora de mano de obra propia", 12_000, 2)],
    equipos: [fila("Transporte ida", 40_000, 1), fila("Transporte regreso", 10_000, 1)],
    indirectos: [fila("Publicidad x mes", 5_000, 1), fila("Gastos de oficina", 10_000, 1), fila("Personal administrativo", 10_000, 1)],
  },
  utilidadPorcentaje: 30,
};

test("el total de una fila es su costo unitario por su cantidad", () => {
  assert.equal(totalFila(fila("Burbuja 24", 6_000, 2)), 12_000);
  assert.equal(totalFila(fila("Hora propia", 12_000, 2)), 24_000);
  // Media hora de trabajo existe; el total se redondea a pesos enteros.
  assert.equal(totalFila(fila("Media hora", 12_001, 1.5)), 18_002);
});

test("una fila sin cantidad o sin costo no suma nada", () => {
  assert.equal(totalFila(fila("Sin cantidad", 16_900, 0)), 0);
  assert.equal(totalFila(filaVacia("manoObra", 1)), 0);
});

test("la hoja real da los mismos subtotales que la plantilla en papel", () => {
  const totales = totalesPlantilla(HOJA_REAL);
  assert.equal(totales.subtotales.materias, 107_750);
  assert.equal(totales.subtotales.manoObra, 24_000);
  assert.equal(totales.subtotales.equipos, 50_000);
  assert.equal(totales.subtotales.indirectos, 25_000);
});

test("la hoja real da el mismo total de costos, utilidad y total del proyecto", () => {
  const totales = totalesPlantilla(HOJA_REAL);
  assert.equal(totales.costosDirectos, 181_750);
  assert.equal(totales.costosIndirectos, 25_000);
  assert.equal(totales.totalCostos, 206_750);
  assert.equal(totales.utilidad, 62_025);
  assert.equal(totales.totalProyecto, 268_775);
});

test("la utilidad se puede cambiar y arrastra el total del proyecto", () => {
  assert.equal(totalesPlantilla({ ...HOJA_REAL, utilidadPorcentaje: 0 }).totalProyecto, 206_750);
  assert.equal(totalesPlantilla({ ...HOJA_REAL, utilidadPorcentaje: 50 }).utilidad, 103_375);
  assert.equal(totalesPlantilla({ ...HOJA_REAL, utilidadPorcentaje: 50 }).totalProyecto, 310_125);
  // Un margen por encima del 100% es raro, no inválido: la hoja no le pone techo.
  assert.equal(totalesPlantilla({ ...HOJA_REAL, utilidadPorcentaje: 120 }).utilidad, 248_100);
});

test("la utilidad se redondea a pesos enteros", () => {
  const una = { ...HOJA_REAL, secciones: { materias: [fila("Una bolsa", 1_001, 1)], manoObra: [], equipos: [], indirectos: [] }, utilidadPorcentaje: 33 };
  assert.equal(utilidadEnPesos(1_001, 33), 330);
  assert.equal(totalesPlantilla(una).totalProyecto, 1_331);
});

test("borrar todas las filas deja la hoja en cero sin romper los totales", () => {
  const vacia = { ...HOJA_REAL, secciones: { materias: [], manoObra: [], equipos: [], indirectos: [] } };
  const totales = totalesPlantilla(vacia);
  assert.equal(subtotalSeccion([]), 0);
  assert.deepEqual(totales.subtotales, { materias: 0, manoObra: 0, equipos: 0, indirectos: 0 });
  assert.equal(totales.totalCostos, 0);
  assert.equal(totales.utilidad, 0);
  assert.equal(totales.totalProyecto, 0);
});

test("un campo vacío, negativo o con basura vale cero y nunca resta del total", () => {
  assert.equal(pesosEnteros(Number.NaN), 0);
  assert.equal(pesosEnteros(-16_900), 0);
  assert.equal(cantidadValida(Number.POSITIVE_INFINITY), 0);
  assert.equal(cantidadValida(-3), 0);
  assert.equal(porcentajeValido(Number.NaN), 0);
  assert.equal(porcentajeValido(-30), 0);
  const sucia = { ...HOJA_REAL, secciones: { ...HOJA_REAL.secciones, manoObra: [fila("Descuento imposible", -50_000, 1), fila("Basura", Number.NaN, Number.NaN)] } };
  const totales = totalesPlantilla(sucia);
  assert.equal(totales.subtotales.manoObra, 0);
  assert.equal(totales.totalCostos, 182_750);
});

test("las materias primas se precargan copiando el precio y los paquetes del plan", () => {
  const compras: CompraParaPlantilla[] = [
    { variant_id: "v1", titulo: "B2b Globo Latex Redondo Silk Amatista — R-5 / PAQUETE X 50", unidades_paquete: 50, paquetes: 1, precio_paquete: 16_900 },
    { variant_id: "v2", titulo: "B2b Globo Burbuja Cristal", unidades_paquete: 1, paquetes: 2, precio_paquete: 6_000 },
  ];
  const filas = filasMateriasPrimas(compras);
  assert.equal(filas.length, 2);
  assert.equal(filas[0]!.costoUnitario, 16_900);
  assert.equal(filas[0]!.cantidad, 1);
  assert.equal(filas[1]!.costoUnitario, 6_000);
  assert.equal(filas[1]!.cantidad, 2);
  assert.equal(subtotalSeccion(filas), 28_900);
  // Ids únicos: dos variantes iguales en dos compras distintas siguen siendo dos filas.
  const repetidas = filasMateriasPrimas([compras[0]!, compras[0]!]);
  assert.notEqual(repetidas[0]!.id, repetidas[1]!.id);
});

test("la descripción de una materia prima lleva la cuenta de la bolsa una sola vez", () => {
  assert.equal(
    descripcionMateriaPrima({ variant_id: "v", titulo: "B2b Globo Latex Silk Amatista — R-5 / PAQUETE X 50", unidades_paquete: 50, paquetes: 1, precio_paquete: 1 }),
    "B2b Globo Latex Silk Amatista — R-5 / PAQUETE X 50",
  );
  assert.equal(
    descripcionMateriaPrima({ variant_id: "v", titulo: "B2b Globo Burbuja Cristal", unidades_paquete: 12, paquetes: 1, precio_paquete: 1 }),
    "B2b Globo Burbuja Cristal X 12",
  );
  // Sin cuenta de paquete conocida no se inventa ninguna.
  assert.equal(
    descripcionMateriaPrima({ variant_id: "v", titulo: "Figura de icopor unicornio", unidades_paquete: 0, paquetes: 1, precio_paquete: 1 }),
    "Figura de icopor unicornio",
  );
});

test("una hoja nueva solo trae materias primas, cabecera y la utilidad por defecto", () => {
  const hoja = plantillaInicial({
    proyecto: "Montaje Orgánico Azul y Plata",
    fecha: "2026-09-29",
    compras: [{ variant_id: "v1", titulo: "B2b Globo Latex Fashion Azul — R-12 / PAQUETE X 50", unidades_paquete: 50, paquetes: 3, precio_paquete: 14_350 }],
  });
  assert.equal(hoja.cabecera.proyecto, "Montaje Orgánico Azul y Plata");
  assert.equal(hoja.cabecera.fecha, "2026-09-29");
  // Lo que es del cliente lo escribe la persona, no la app.
  assert.deepEqual([hoja.cabecera.contacto, hoja.cabecera.numero, hoja.cabecera.lugar, hoja.cabecera.celular], ["", "", "", ""]);
  assert.equal(hoja.secciones.materias.length, 1);
  assert.deepEqual([hoja.secciones.manoObra, hoja.secciones.equipos, hoja.secciones.indirectos], [[], [], []]);
  assert.equal(hoja.utilidadPorcentaje, UTILIDAD_POR_DEFECTO);
  assert.equal(UTILIDAD_POR_DEFECTO, 30);
  // Sin mano de obra ni transporte inventados, el total es el de los globos más la utilidad.
  const totales = totalesPlantilla(hoja);
  assert.equal(totales.totalCostos, 43_050);
  assert.equal(totales.totalProyecto, 55_965);
});

test("una hoja sin plan arranca vacía y lista para llenarse a mano", () => {
  const hoja = plantillaInicial({ proyecto: "", fecha: "2026-09-29", compras: [] });
  assert.deepEqual(hoja.secciones.materias, []);
  assert.equal(totalesPlantilla(hoja).totalProyecto, 0);
});
