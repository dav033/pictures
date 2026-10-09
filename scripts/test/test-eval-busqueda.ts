/**
 * Evaluación de la búsqueda del taller (REQ-002, paso 7): el oro está bien formado y cita ids que existen, y las métricas
 * dan lo que da la cuenta hecha a mano. Sin red ni gasto. Necesita `data/taller/fichas.jsonl`
 * (`npx tsx scripts/taller/extraer-biblioteca.ts` lo genera).
 */
import { strict as assert } from "node:assert";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { REFERENCIAS_DUENO } from "@/lib/globos3d/referencias-dueno";
import {
  SistemaNoDisponible, consultasDeFoto, consultasDeTexto, desglosePorCategoria, evaluarSistema, metricasDeConsulta, peoresConsultas, promediar, tablaComparativa,
  type Relevante, type SistemaBusqueda,
} from "@/lib/taller/evaluar";
import { idsDelOro, leerOro } from "@/lib/taller/evaluar-oro";
import { sistemaActual, sistemaRag } from "../taller/sistemas-busqueda";

const RAIZ = path.resolve(__dirname, "../..");
const cerca = (real: number, esperado: number, mensaje: string) => assert.ok(Math.abs(real - esperado) < 1e-9, `${mensaje}: ${real} != ${esperado}`);

async function main() {
  // -------------------------------------------------------------------------------------------------------- el oro
  const oro = leerOro(JSON.parse(readFileSync(path.join(RAIZ, "scripts/test/fixtures/oro-busqueda-taller.json"), "utf8")));
  assert.equal(oro.consultas.length, 40, "El oro trae 40 consultas de texto.");
  assert.equal(oro.fotos.length, 13, "El oro trae las 13 fotos del dueño.");
  assert.equal(new Set(oro.consultas.map((c) => c.id)).size, 40, "Ids de consulta únicos.");
  assert.equal(new Set(oro.consultas.map((c) => c.texto)).size, 40, "Textos de consulta únicos.");
  for (const c of oro.consultas) {
    assert.equal(new Set(c.relevantes.map((r) => r.id)).size, c.relevantes.length, `${c.id}: relevantes repetidos.`);
    assert.ok(c.relevantes.some((r) => r.grado === 2) || c.nota.startsWith("AMBIGUA"), `${c.id}: sin ningún exacto y sin marcarse AMBIGUA.`);
  }
  const categorias = new Set(oro.consultas.flatMap((c) => c.categoria.split("-")));
  for (const esperada of ["estructura", "decoracion", "formato", "color", "ocasion", "tema", "medida", "fuente"]) assert.ok(categorias.has(esperada), `El oro cubre la categoría «${esperada}».`);

  const fichas = path.join(RAIZ, "data/taller/fichas.jsonl");
  assert.ok(existsSync(fichas), "Falta data/taller/fichas.jsonl: corre `npx tsx scripts/taller/extraer-biblioteca.ts`.");
  const existentes = new Set(readFileSync(fichas, "utf8").split("\n").filter(Boolean).map((linea) => (JSON.parse(linea) as { id: string }).id));
  const inexistentes = idsDelOro(oro).filter((id) => !existentes.has(id));
  assert.deepEqual(inexistentes, [], `Ids del oro que no existen en las fichas: ${inexistentes.join(", ")}`);

  // El oro de reserva (holdout): 15 consultas que no se miran al afinar. Misma forma, ids que existen, sin repetir las del desarrollo.
  const reserva = leerOro(JSON.parse(readFileSync(path.join(RAIZ, "scripts/test/fixtures/oro-busqueda-taller-holdout.json"), "utf8")));
  assert.equal(reserva.consultas.length, 15, "La reserva trae 15 consultas de texto.");
  assert.equal(reserva.fotos.length, 0, "Las fotos del dueño ya están en el oro de desarrollo.");
  const idsDev = new Set(oro.consultas.map((c) => c.id)), textosDev = new Set(oro.consultas.map((c) => c.texto));
  for (const c of reserva.consultas) {
    assert.ok(!idsDev.has(c.id), `${c.id}: el id ya está en el oro de desarrollo.`);
    assert.ok(!textosDev.has(c.texto), `${c.id}: la consulta «${c.texto}» ya está en el oro de desarrollo.`);
    assert.ok(c.relevantes.some((r) => r.grado === 2), `${c.id}: sin ningún exacto.`);
  }
  const faltan = idsDelOro(reserva).filter((id) => !existentes.has(id));
  assert.deepEqual(faltan, [], `Ids de la reserva que no existen en las fichas: ${faltan.join(", ")}`);
  const categoriasReserva = new Set(reserva.consultas.flatMap((c) => c.categoria.split("-")));
  for (const esperada of ["estructura", "decoracion", "formato", "color", "ocasion", "tema", "medida", "fuente"]) assert.ok(categoriasReserva.has(esperada), `La reserva cubre la categoría «${esperada}».`);

  // Las fotos: una por referencia del dueño, con su número, y el esperado es esa referencia.
  assert.equal(new Set(oro.fotos.map((f) => f.numero)).size, 13, "Un número de foto por cada una.");
  for (const foto of oro.fotos) {
    const referencia = REFERENCIAS_DUENO.find((r) => r.numero === foto.numero);
    assert.ok(referencia, `Foto ${foto.numero}: no hay referencia del dueño con ese número.`);
    assert.equal(foto.esperado, referencia.id, `Foto ${foto.numero}: el esperado debe ser ${referencia.id}.`);
    assert.ok(foto.archivo.startsWith(`${String(foto.numero).padStart(2, "0")}-`), `Foto ${foto.numero}: el archivo ${foto.archivo} no empieza por su número.`);
    assert.ok(!foto.parecidos.includes(foto.esperado), `Foto ${foto.numero}: el esperado no va entre los parecidos.`);
  }
  assert.equal(consultasDeFoto(oro).length, 13);
  assert.equal(consultasDeTexto(oro).length, 40);
  assert.throws(() => leerOro({ ...oro, consultas: [{ ...oro.consultas[0], relevantes: [] }] }), "Una consulta sin relevantes no es válida.");
  assert.throws(() => leerOro({ ...oro, consultas: [{ ...oro.consultas[0], relevantes: [{ id: "x", grado: 3 }] }] }), "Un grado fuera de 1–2 no es válido.");

  // ----------------------------------------------------------------------------------------------- métricas a mano
  // Relevantes: A exacto (2), B y C aceptables (1). El sistema devuelve [X, A, Y, B, Z].
  const relevantes: Relevante[] = [{ id: "A", grado: 2 }, { id: "B", grado: 1 }, { id: "C", grado: 1 }];
  const m = metricasDeConsulta(["X", "A", "Y", "B", "Z"], relevantes);
  cerca(m.recall5, 2 / 3, "recall@5");
  cerca(m.recall10, 2 / 3, "recall@10");
  cerca(m.acierto5, 1, "acierto@5");
  cerca(m.mrr, 1 / 2, "MRR");
  // DCG = (2^2−1)/log2(2+1) + (2^1−1)/log2(4+1); ideal = A, B, C en las posiciones 1, 2 y 3.
  cerca(m.ndcg10, (3 / Math.log2(3) + 1 / Math.log2(5)) / (3 + 1 / Math.log2(3) + 1 / Math.log2(4)), "nDCG@10");
  assert.ok(m.ndcg10 > 0.56 && m.ndcg10 < 0.57, `nDCG@10 ≈ 0,5625 (${m.ndcg10}).`);

  // Lo bueno fuera del top-5 cuenta en recall@10 pero no en recall@5 ni en acierto@5; el MRR lo ve en su posición.
  const tarde = metricasDeConsulta(["X1", "X2", "X3", "X4", "X5", "X6", "B", "X7"], relevantes);
  cerca(tarde.recall5, 0, "recall@5 con el relevante en el puesto 7");
  cerca(tarde.recall10, 1 / 3, "recall@10 con el relevante en el puesto 7");
  cerca(tarde.acierto5, 0, "acierto@5 con el relevante en el puesto 7");
  cerca(tarde.mrr, 1 / 7, "MRR con el relevante en el puesto 7");
  // Lo que pasa del puesto 10 no cuenta.
  cerca(metricasDeConsulta(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "A"], relevantes).recall10, 0, "recall@10 no mira el puesto 11");
  // Orden ideal = nDCG 1; sin aciertos = todo cero; repetidos no cuentan dos veces.
  const perfecto = metricasDeConsulta(["A", "B", "C"], relevantes);
  cerca(perfecto.ndcg10, 1, "nDCG@10 del orden ideal");
  cerca(perfecto.recall5, 1, "recall@5 del orden ideal");
  cerca(perfecto.mrr, 1, "MRR del orden ideal");
  assert.deepEqual(metricasDeConsulta(["X", "Y"], relevantes), { recall5: 0, recall10: 0, acierto5: 0, mrr: 0, ndcg10: 0 });
  assert.deepEqual(metricasDeConsulta([], relevantes), { recall5: 0, recall10: 0, acierto5: 0, mrr: 0, ndcg10: 0 });
  cerca(metricasDeConsulta(["A", "A", "A", "A", "A", "B"], relevantes).recall5, 2 / 3, "los repetidos no ocupan puestos");
  // Un exacto antes que un aceptable puntúa más que al revés.
  assert.ok(metricasDeConsulta(["A", "B"], relevantes).ndcg10 > metricasDeConsulta(["B", "A"], relevantes).ndcg10, "El exacto primero gana en nDCG.");
  const promedio = promediar([m, perfecto]);
  cerca(promedio.mrr, (1 / 2 + 1) / 2, "promedio del MRR");
  cerca(promedio.recall5, (2 / 3 + 1) / 2, "promedio del recall@5");

  // ------------------------------------------------------------------------------------ evaluar un sistema falso
  const consultas = [
    { id: "Q1", categoria: "tema", texto: "uno", relevantes: [{ id: "A", grado: 2 as const }] },
    { id: "Q2", categoria: "tema-color", texto: "dos", relevantes: [{ id: "B", grado: 2 as const }, { id: "C", grado: 1 as const }] },
    { id: "Q3", categoria: "medida", texto: "tres", relevantes: [{ id: "D", grado: 1 as const }] },
  ];
  const respuestas: Record<string, string[]> = { uno: ["A", "Z"], dos: ["Z", "C"], tres: [] };
  const falso: SistemaBusqueda = { nombre: "falso", buscarTexto: (texto) => respuestas[texto] ?? [] };
  const evaluado = await evaluarSistema(falso, consultas);
  assert.equal(evaluado.consultas.length, 3);
  cerca(evaluado.consultas[0].metricas.mrr, 1, "Q1 acierta a la primera");
  cerca(evaluado.consultas[1].metricas.mrr, 1 / 2, "Q2 acierta a la segunda");
  cerca(evaluado.promedio.mrr, (1 + 1 / 2 + 0) / 3, "MRR promedio del sistema falso");
  assert.equal(evaluado.errores, 0);
  assert.deepEqual(peoresConsultas(evaluado, 2).map((r) => r.id), ["Q3", "Q2"], "Las peores primero.");
  const porCategoria = desglosePorCategoria(evaluado);
  assert.deepEqual(porCategoria.map((g) => [g.categoria, g.n]), [["color", 1], ["medida", 1], ["tema", 2]], "«tema-color» cuenta en tema y en color.");

  const roto: SistemaBusqueda = { nombre: "roto", buscarTexto: (texto) => { if (texto === "dos") throw new Error("falló"); return ["A"]; } };
  const conError = await evaluarSistema(roto, consultas);
  assert.equal(conError.errores, 1, "Una consulta que falla se anota y se sigue.");
  assert.equal(conError.consultas[1].error, "falló");
  cerca(conError.consultas[1].metricas.ndcg10, 0, "La consulta con error puntúa cero");

  await assert.rejects(evaluarSistema(sistemaRag, consultas), SistemaNoDisponible, "El RAG sin implementar avisa «no disponible».");
  await assert.rejects(evaluarSistema(falso, consultasDeFoto(oro)), SistemaNoDisponible, "Un sistema solo de texto no busca por foto.");

  const tabla = tablaComparativa("Texto", [{ sistema: "falso", resultado: evaluado }, { sistema: "RAG", resultado: null, motivo: "no disponible" }]);
  assert.match(tabla, /\| falso \| 3 \|/);
  assert.match(tabla, /\| RAG \| - \| n\/d/);
  assert.ok(tabla.includes("recall@5") && tabla.includes("nDCG@10") && tabla.includes("MRR"), "La tabla trae las métricas pedidas.");

  // ---------------------------------------------------------------------------- la búsqueda de hoy, de punta a punta
  const palmera = await sistemaActual.buscarTexto("palmera", 5);
  assert.ok(palmera.includes("idea:palmera"), `La búsqueda de hoy encuentra la palmera (${palmera.join(", ")}).`);

  console.log("test-eval-busqueda OK");
}

main().catch((e) => { console.error(e); process.exit(1); });
