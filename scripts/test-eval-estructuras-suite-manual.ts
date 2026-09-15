import assert from "node:assert/strict";
import { resolve } from "node:path";
import { familiaDesdeClaseOficial, CLASES_OFICIALES } from "../src/lib/eval/estructuras/familia-clase";
import { CLASES_MANUALES, etiquetasCarpeta, importarRegistro, leerCsv, seleccionEstratificada, suiteDesdeManual, type ItemManual } from "../src/lib/eval/estructuras/suite-manual";

/**
 * Suite from the manually collected folder: CSV parsing (comma or Excel
 * semicolon), permission gate, duplicates, path safety and stratified cap.
 */

let casos = 0;
function caso(nombre: string, fn: () => void): void {
  fn();
  casos += 1;
  console.log(`ok - ${nombre}`);
}

const RAIZ = resolve("C:/estructuras-manual-simulado");
const jpeg = (n: number) => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, n, 1, 2, 3, 4, 5, 6, 7]);

caso("CSV: coma con comillas y BOM, y punto y coma de Excel en español", () => {
  const coma = '\uFEFFarchivo,titulo,permiso\n"arco\\a.jpg","Pin, con ""comillas""",cc-by\r\n';
  assert.deepEqual(leerCsv(coma), [{ archivo: "arco\\a.jpg", titulo: 'Pin, con "comillas"', permiso: "cc-by" }]);
  const excel = "archivo;titulo;permiso\r\narco\\a.jpg;Pin, con coma;cc0\r\n;;\r\n";
  assert.deepEqual(leerCsv(excel), [{ archivo: "arco\\a.jpg", titulo: "Pin, con coma", permiso: "cc0" }]);
});

caso("clases: las 12 vigentes (sin denso/no denso ni semiarco regular) tienen familia y la carpeta manual las cubre más negativo y no_se", () => {
  assert.equal(CLASES_OFICIALES.length, 12);
  assert.ok(!CLASES_OFICIALES.includes("semiarco"), "regular half-arch retired");
  assert.ok(!CLASES_OFICIALES.some((clase) => /densa?$/.test(clase)), "no dense / non-dense class remains");
  assert.equal(familiaDesdeClaseOficial("pared"), "pared");
  assert.deepEqual([...CLASES_MANUALES].filter((c) => c !== "negativo" && c !== "no_se").sort(), [...CLASES_OFICIALES].sort());
  assert.deepEqual([familiaDesdeClaseOficial("semiarco_organico"), familiaDesdeClaseOficial("aro_circular"), familiaDesdeClaseOficial("techo_globos")], ["semiarco", "aro", "techo"]);
  assert.throws(() => familiaDesdeClaseOficial("kit"), /desconocida/);
});

caso("permisos: solo cc0, cc-by, dominio-publico y escrito:<id>; el resto queda excluido con motivo", () => {
  const archivos = new Map([[resolve(RAIZ, "arco\\1.jpg"), jpeg(1)], [resolve(RAIZ, "arco\\2.jpg"), jpeg(2)], [resolve(RAIZ, "columna\\3.jpg"), jpeg(3)], [resolve(RAIZ, "semiarco\\4.jpg"), jpeg(4)], [resolve(RAIZ, "semiarco\\5.jpg"), jpeg(5)], [resolve(RAIZ, "aro_circular\\6.jpg"), jpeg(6)], [resolve(RAIZ, "negativo\\7.jpg"), jpeg(7)], [resolve(RAIZ, "arco\\copia.jpg"), jpeg(1)], [resolve(RAIZ, "figura\\texto.jpg"), Uint8Array.from([0x68, 0x6f, 0x6c, 0x61, 0, 0, 0, 0, 0, 0, 0, 0])]]);
  const filas = [
    { archivo: "arco\\1.jpg", clase_candidata: "arco", permiso: "cc-by" },
    { archivo: "arco\\2.jpg", clase_candidata: "arco", permiso: "" },
    { archivo: "columna\\3.jpg", clase_candidata: "columna", permiso: "BY-SA" },
    { archivo: "semiarco\\4.jpg", clase_candidata: "semiarco_organico", permiso: "escrito:decorador-07" },
    { archivo: "semiarco\\5.jpg", clase_candidata: "semiarco_organico", permiso: "lo tengo" },
    { archivo: "aro_circular\\6.jpg", clase_candidata: "aro_circular", permiso: "Dominio-Publico" },
    { archivo: "negativo\\7.jpg", clase_candidata: "negativo", permiso: "cc0" },
    { archivo: "arco\\copia.jpg", clase_candidata: "arco", permiso: "cc0" },
    { archivo: "..\\fuera.jpg", clase_candidata: "arco", permiso: "cc0" },
    { archivo: "figura\\texto.jpg", clase_candidata: "figura", permiso: "cc0" },
    { archivo: "techo_globos\\no-existe.jpg", clase_candidata: "techo_globos", permiso: "cc0" },
    { archivo: "kit\\x.jpg", clase_candidata: "kit", permiso: "cc0" },
  ];
  const resultado = importarRegistro(filas, RAIZ, (ruta) => archivos.get(ruta) ?? null);
  assert.deepEqual(resultado.aceptadas.map((item) => [item.archivo, item.permiso]), [["arco\\1.jpg", "cc-by"], ["semiarco\\4.jpg", "escrito:decorador-07"], ["aro_circular\\6.jpg", "dominio-publico"]]);
  assert.deepEqual(Object.fromEntries(resultado.excluidas.map(({ archivo, motivo }) => [archivo, motivo])), {
    "arco\\2.jpg": "sin_permiso", "columna\\3.jpg": "by_sa_revision_legal", "semiarco\\5.jpg": "permiso_no_reconocido", "negativo\\7.jpg": "negativo_o_no_se",
    "arco\\copia.jpg": "duplicado_exacto", "..\\fuera.jpg": "fuera_de_la_carpeta", "figura\\texto.jpg": "formato_no_admitido", "techo_globos\\no-existe.jpg": "archivo_inexistente", "kit\\x.jpg": "clase_desconocida",
  });
  assert.deepEqual(resultado.por_familia, { arco: 1, semiarco: 1, aro: 1 });
});

caso("selección: tope estratificado por familia, determinista, y suite válida para el runner", () => {
  const item = (clase: string, n: number): ItemManual => ({ sha256: n.toString(16).padStart(64, "0"), archivo: `${clase}\\${n}.jpg`, clase: clase as ItemManual["clase"], permiso: "cc0" });
  const items = [...Array.from({ length: 10 }, (_, i) => item("arco", i + 1)), item("semiarco_organico", 20), item("semiarco_organico", 21), item("techo_globos", 30)];
  const elegidas = seleccionEstratificada(items, 6);
  assert.equal(elegidas.length, 6);
  assert.deepEqual(elegidas.map((e) => familiaDesdeClaseOficial(e.clase)).sort(), ["arco", "arco", "arco", "semiarco", "semiarco", "techo"]);
  assert.deepEqual(seleccionEstratificada([...items].reverse(), 6), elegidas, "order of input does not matter");
  assert.equal(seleccionEstratificada(items, 100).length, items.length);
  const suite = suiteDesdeManual(elegidas, "dev-seed-v0");
  assert.equal(suite.items.length, 6);
  assert.ok(suite.items.every((i) => i.evaluacion_con_proveedor_externo && i.envio_proveedores_ia_permitido));
  assert.doesNotMatch(JSON.stringify(suite), /pinterest|autor|url_pagina/i);
});

caso("excepción del dueño: permiso vacío entra como excepcion:<id>, registrada en la suite; BY-SA sigue fuera", () => {
  const archivos = new Map([[resolve(RAIZ, "arco\\1.jpg"), jpeg(1)], [resolve(RAIZ, "columna\\2.jpg"), jpeg(2)], [resolve(RAIZ, "arco\\3.jpg"), jpeg(3)]]);
  const filas = [
    { archivo: "arco\\1.jpg", clase_candidata: "arco", permiso: "" },
    { archivo: "columna\\2.jpg", clase_candidata: "columna", permiso: "by-sa" },
    { archivo: "arco\\3.jpg", clase_candidata: "arco", permiso: "cc0" },
  ];
  const excepcion = { id: "dt7-excepcion-interna-20260915", aprobadaEn: "2026-09-15", registro: "REVISION-HUMANA.md" };
  const sin = importarRegistro(filas, RAIZ, (ruta) => archivos.get(ruta) ?? null);
  assert.equal(sin.aceptadas.length, 1, "without the exception only the cc0 row passes");
  const con = importarRegistro(filas, RAIZ, (ruta) => archivos.get(ruta) ?? null, excepcion);
  assert.deepEqual(con.aceptadas.map((item) => item.permiso).sort(), ["cc0", "excepcion:dt7-excepcion-interna-20260915"]);
  assert.deepEqual(con.excluidas, [{ archivo: "columna\\2.jpg", motivo: "by_sa_revision_legal" }]);
  const suite = suiteDesdeManual(con.aceptadas, "validacion", excepcion);
  assert.deepEqual(suite.excepcion_permiso, { id: excepcion.id, aprobada_en: "2026-09-15", alcance: "evaluacion_interna_orientativa", registro: "REVISION-HUMANA.md" });
  assert.throws(() => suiteDesdeManual(con.aceptadas, "validacion"), /sin la excepción registrada/);
  assert.equal(suiteDesdeManual(sin.aceptadas, "limpia").excepcion_permiso, undefined);
  assert.deepEqual(etiquetasCarpeta(con.aceptadas), Object.fromEntries(con.aceptadas.map((item) => [item.sha256, "arco"])));
});

console.log(`[PASS] ${casos} casos de la suite desde la carpeta manual`);
