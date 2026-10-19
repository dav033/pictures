import assert from "node:assert/strict";
import test from "node:test";
import { armarEscena, type Escena, type EscenaArmada } from "./escena";
import { BIBLIOTECA_FABRICA, escenaDeItem } from "./biblioteca";
import { ESCENAS_PREDEFINIDAS } from "./escenas-presets";
import { filasBomba, inflablesDeEscena } from "./bomba-segundos";
import { esGloboDeHelio } from "./helio-cinta";
import { impresoDe } from "./hoja-armado-impresos";
import { MAX_GLOBOS_ANILLO } from "./hoja-armado-capas";
import { agruparPorNivel, sumaSinRedondear } from "./hoja-armado-comun";
import { MAX_GLOBOS_COMPACTA, anexosDeFila, esFormatoDeTubo, llevaTubos, marcasDeLinea } from "./hoja-armado-compacta";
import { centrosDeUnidad } from "./hoja-armado-local";
import { PAGINA_MM, altoDePagina } from "./hoja-armado-paginas";
import { hojaDeEscena, paginasDeHoja, type HojaArmado, type PaginaHoja } from "./hoja-armado";

// ---------------------------------------------------------------------------------------------------------------------
// TODA la biblioteca: las escenas de fábrica y los presets (las mismas que mira la prueba dorada del motor)
// ---------------------------------------------------------------------------------------------------------------------

type EscenaDeBiblioteca = { id: string; nombre: string; escena: Escena };

/** Cada escena y cada conjunto de la biblioteca de fábrica, y los presets: 405 escenas. */
function escenasDeBiblioteca(): EscenaDeBiblioteca[] {
  const salida: EscenaDeBiblioteca[] = [];
  for (const item of BIBLIOTECA_FABRICA) if (item.contenido.tipo === "escena" || item.contenido.tipo === "conjunto") salida.push({ id: item.id, nombre: item.nombre ?? item.id, escena: escenaDeItem(item) });
  for (const p of ESCENAS_PREDEFINIDAS) salida.push({ id: `preset:${p.id}`, nombre: p.nombre, escena: p.escena });
  return salida;
}

type Recorrido = EscenaDeBiblioteca & { armada: EscenaArmada; hoja: HojaArmado; paginas: PaginaHoja[] };
let recorrido: Recorrido[] | undefined;
/** Se arma una sola vez: armar las 405 escenas es lo que más tarda. */
function biblioteca(): Recorrido[] {
  recorrido ??= escenasDeBiblioteca().map((e) => {
    const armada = armarEscena(e.escena);
    const hoja = hojaDeEscena(e.nombre, e.escena, armada);
    return { ...e, armada, hoja, paginas: paginasDeHoja(hoja) };
  });
  return recorrido;
}

const tipoDe = (r: Recorrido, id: string) => r.escena.nodos.find((n) => n.id === id)?.pieza.tipo;

function sumar(cuenta: Map<string, number>, clave: string, n: number) { cuenta.set(clave, (cuenta.get(clave) ?? 0) + n); }

test("biblioteca: la hoja tiene todos los globos de la escena, ni uno más, por formato y color", () => {
  const escenas = biblioteca();
  assert.ok(escenas.length >= 400, `${escenas.length} escenas`);
  for (const r of escenas) {
    const enEscena = new Map<string, number>();
    for (const g of r.armada.globos) sumar(enEscena, `${g.formatoId}|${g.codigo}`, 1);
    const enHoja = new Map<string, number>();
    for (const e of r.hoja.estructuras) for (const c of e.colores) sumar(enHoja, `${c.formatoId}|${c.codigo}`, c.cantidad * e.unidades);
    for (const f of r.hoja.compactas) for (const l of f.contenido) if (!esFormatoDeTubo(l.formatoId)) sumar(enHoja, `${l.formatoId}|${l.codigo}`, l.cantidad * f.unidades);
    assert.deepEqual([...enHoja].sort(), [...enEscena].sort(), `${r.id}: globos por color`);
    const total = r.hoja.estructuras.reduce((s, e) => s + e.totalGlobos, 0) + r.hoja.compactas.reduce((s, f) => s + f.globos, 0);
    assert.equal(total, r.armada.globos.length, `${r.id}: total de globos`);
  }
});

test("biblioteca: la bomba de la hoja es la de la escena", () => {
  for (const r of biblioteca()) {
    const esperado = sumaSinRedondear(filasBomba(inflablesDeEscena(r.armada)));
    assert.ok(Math.abs(r.hoja.segundosBomba - esperado) < 0.05, `${r.id}: bomba ${r.hoja.segundosBomba} vs ${esperado}`);
  }
});

test("biblioteca: toda estructura tiene algo que armar, más de 3 globos por copia y cuentas que cuadran", () => {
  for (const r of biblioteca()) {
    for (const e of r.hoja.estructuras) {
      const etiqueta = `${r.id}: ${e.nombre}`;
      assert.ok(e.capas.length + e.tramos.length + e.cuartetos.length > 0, `${etiqueta}: sin capas, tramos ni cuartetos`);
      assert.ok(e.globosPorUnidad > MAX_GLOBOS_COMPACTA, `${etiqueta}: es pequeña y debía ir a la tabla`);
      assert.equal(e.totalGlobos, e.unidades * e.globosPorUnidad, `${etiqueta}: total por copias`);
      assert.equal(e.colores.reduce((s, c) => s + c.cantidad, 0), e.globosPorUnidad, `${etiqueta}: colores`);
      const enCapas = e.capas.reduce((s, c) => s + c.repeticiones * c.globos.length, 0);
      const enTramos = e.tramos.reduce((s, t) => s + t.globos.length, 0);
      const enCuartetos = e.cuartetos.reduce((s, c) => s + c.repeticiones * c.globos.length, 0);
      const aparte = e.aparte.reduce((s, a) => s + a.cantidad, 0);
      assert.equal(enCapas + enTramos + enCuartetos + aparte, e.globosPorUnidad, `${etiqueta}: capas, tramos y aparte`);
    }
  }
});

test("biblioteca: todo anillo dibujado tiene el tamaño del módulo (4 en un cuarteto), numerado de 1 a n, con su orden de color propio", () => {
  let dibujados = 0;
  for (const r of biblioteca()) {
    for (const e of r.hoja.estructuras.filter((x) => x.modo === "anillos")) {
      const esperado = e.modulo ? e.modulo.globosPorGrupo : 4;
      let siguiente = 1;
      for (const capa of e.capas) {
        const etiqueta = `${r.id}: ${e.nombre}, capa ${capa.numero}`;
        assert.equal(capa.numero, siguiente, `${etiqueta}: bloques seguidos`);
        siguiente = capa.hasta + 1;
        assert.equal(capa.repeticiones, capa.hasta - capa.numero + 1);
        assert.equal(capa.globos.length, esperado, `${etiqueta}: ${capa.globos.length} globos, el módulo lleva ${esperado}`);
        assert.ok(capa.globos.length <= MAX_GLOBOS_ANILLO);
        assert.deepEqual(capa.globos.map((g) => g.numero), capa.globos.map((_, k) => k + 1), `${etiqueta}: numeración`);
        assert.equal(capa.secuencia.reduce((s, t) => s + t.veces, 0), capa.globos.length, `${etiqueta}: secuencia`);
        const expandida = capa.secuencia.flatMap((t) => Array.from({ length: t.veces }, () => `${t.formatoId}|${t.codigo}`));
        assert.deepEqual(expandida, capa.globos.map((g) => `${g.formatoId}|${g.codigo}`), `${etiqueta}: la secuencia no es el orden de la capa`);
        assert.deepEqual(capa.secuencia.map((t) => t.desde), capa.secuencia.map((_, k) => 1 + capa.secuencia.slice(0, k).reduce((s, t) => s + t.veces, 0)));
        dibujados += 1;
      }
      assert.equal(siguiente - 1, e.capas.reduce((s, c) => s + c.repeticiones, 0));
    }
  }
  assert.ok(dibujados > 400, `se dibujaron ${dibujados} bloques de anillos`);
});

/**
 * Una pieza puesta con un marco espejo (sobre otra pieza o en un ancla) se ve reflejada en el 3D, y la hoja la da reflejada
 * (`centrosDeUnidad`): su numeración va en sentido antihorario y su espiral gira a la derecha. Lo que no cambia con el espejo
 * es la relación entre las dos: la espiral gira siempre en contra de la numeración.
 */
test("biblioteca: los anillos se numeran en el sentido que dicen y la trenza gira 45° contra la numeración por capa (el zig-zag, a los dos lados)", () => {
  let giradas = 0;
  const sentidos = { horario: 0, antihorario: 0 };
  for (const r of biblioteca()) {
    for (const e of r.hoja.estructuras.filter((x) => x.modo === "anillos")) {
      const pieza = r.escena.nodos.find((n) => n.id === e.id)?.pieza;
      const patron = pieza?.tipo === "columna" ? pieza.patron : undefined;
      for (const capa of e.capas) {
        const n = capa.globos.length;
        const signo = capa.sentidoNumeracion === "horario" ? 1 : -1;
        sentidos[capa.sentidoNumeracion] += 1;
        const angulos = capa.globos.map((g) => (Math.atan2(g.y, g.x) * 180) / Math.PI);
        angulos.forEach((a, j) => {
          const paso = ((angulos[(j + 1) % n]! - a + 540) % 360) - 180;
          assert.ok(Math.abs(paso - (signo * 360) / n) < 1e-6, `${r.id}: ${e.nombre}, capa ${capa.numero}: el globo ${j + 2} no sigue al ${j + 1} en sentido ${capa.sentidoNumeracion}`);
        });
        if (capa.giroGrados === null) continue;
        assert.ok(patron !== undefined, `${r.id}: ${e.nombre} gira pero no es una columna de trenza`);
        const permitidos = patron === "zigzag" ? [-45, 45] : [-45 * signo];
        assert.ok(permitidos.includes(capa.giroGrados), `${r.id}: ${e.nombre} gira ${capa.giroGrados}° con el patrón ${patron}, numerada en sentido ${capa.sentidoNumeracion}`);
        if (capa.giroGrados === -45 * signo) giradas += 1;
      }
    }
  }
  assert.ok(giradas > 20, `${giradas} bloques con giro`);
  assert.ok(sentidos.horario > 100 && sentidos.antihorario > 20, `sentidos ${JSON.stringify(sentidos)}: la prueba tiene que ver piezas en espejo`);
});

test("biblioteca: las columnas siempre son anillos, también las acostadas o colgadas (que sí las hay)", () => {
  let columnas = 0, inclinadas = 0;
  for (const r of biblioteca()) {
    for (const nodo of r.armada.porNodo) {
      if (tipoDe(r, nodo.id) !== "columna" || nodo.copias === 0) continue;
      columnas += nodo.copias;
      inclinadas += nodo.puestas.filter((p) => Math.abs(p.marco.m[4]) < 0.999).length;
    }
    for (const e of r.hoja.estructuras) if (tipoDe(r, e.id) === "columna") assert.equal(e.modo, "anillos", `${r.id}: ${e.nombre} debía ser de anillos`);
  }
  assert.ok(columnas > 600, `${columnas} columnas`);
  assert.ok(inclinadas > 20, `${inclinadas} columnas inclinadas: la prueba tiene que ejercitar las acostadas`);
});

test("biblioteca: arcos y guirnaldas van cuarteto a cuarteto, en el orden del recorrido y sin mezclar las patas", () => {
  let arcos = 0;
  for (const r of biblioteca()) {
    for (const e of r.hoja.estructuras) {
      const tipo = tipoDe(r, e.id);
      if (tipo !== "arco" && tipo !== "guirnalda") continue;
      assert.equal(e.modo, "trenza", `${r.id}: ${e.nombre}`);
      assert.match(e.sentido ?? "", /cuarteto a cuarteto/);
      let siguiente = 1;
      for (const c of e.cuartetos) { assert.equal(c.desde, siguiente, `${r.id}: ${e.nombre} cuarteto ${c.desde}`); siguiente = c.hasta + 1; }
      if (tipo === "arco") {
        arcos += 1;
        assert.match(e.sentido ?? "", /las patas no se arman a la vez/);
        // El recorrido es de un pie al otro: x avanza (con un cm de margen) de un cuarteto al siguiente, sin saltar de una pata a la otra.
        const nodo = r.armada.porNodo.find((n) => n.id === e.id)!;
        const { niveles } = agruparPorNivel(centrosDeUnidad(nodo));
        const xs = niveles.map((n) => n.reduce((s, c) => s + c.x, 0) / n.length);
        const sentido = Math.sign(xs[xs.length - 1]! - xs[0]!) || 1;
        for (let k = 1; k < xs.length; k++) assert.ok(sentido * (xs[k]! - xs[k - 1]!) >= -1, `${r.id}: ${e.nombre}, el cuarteto ${k + 1} vuelve atrás`);
      }
    }
  }
  assert.ok(arcos > 10, `${arcos} arcos`);
});

test("biblioteca: las paredes dicen dónde está el 1, y se numeran de ese extremo al otro", () => {
  let paredes = 0;
  for (const r of biblioteca()) {
    for (const e of r.hoja.estructuras.filter((x) => x.modo === "paredes")) {
      paredes += 1;
      assert.match(e.sentido ?? "", /El globo 1 está en el extremo/, `${r.id}: ${e.nombre}`);
      const globos = e.tramos.flatMap((t) => t.globos);
      assert.deepEqual(globos.map((g) => g.numero), globos.map((_, i) => i + 1));
      for (let i = 1; i < globos.length; i++) assert.ok(globos[i]!.posicionCm >= globos[i - 1]!.posicionCm);
    }
  }
  assert.ok(paredes >= 5, `${paredes} paredes`);
});

test("biblioteca: lo que no se arma por capas lo dice (franjas de altura) y las formas de anillos van por capa", () => {
  for (const r of biblioteca()) {
    for (const e of r.hoja.estructuras) {
      if (e.modo === "alturas") assert.match(e.nota ?? "", /No sirve para armar por capas/, `${r.id}: ${e.nombre}`);
      if (e.modo === "capas") assert.ok(e.tramos.every((t) => /^Capa \d+/.test(t.etiqueta)), `${r.id}: ${e.nombre}`);
    }
  }
});

test("biblioteca: tubos, links y piezas pequeñas van en la tabla, no en páginas vacías ni como «sin globos»", () => {
  let links = 0;
  for (const r of biblioteca()) {
    for (const nodo of r.armada.porNodo) {
      if (!llevaTubos(nodo) || nodo.globos.length > 0) continue;
      const enTabla = r.hoja.compactas.some((f) => f.contenido.some((l) => esFormatoDeTubo(l.formatoId) && nodo.materiales.some((m) => m.formatoId === l.formatoId && m.codigo === l.codigo)));
      assert.ok(enTabla, `${r.id}: «${nodo.nombre}» lleva tubos y no está en la tabla`);
      if (nodo.materiales.some((m) => m.formatoId === "LOL-660")) links += 1;
    }
    for (const f of r.hoja.compactas) {
      assert.ok(f.unidades > 0 && f.contenido.length > 0, `${r.id}: fila vacía`);
      const porCopia = f.contenido.filter((l) => !esFormatoDeTubo(l.formatoId)).reduce((s, l) => s + l.cantidad, 0);
      assert.ok(porCopia <= MAX_GLOBOS_COMPACTA, `${r.id}: una fila lleva ${porCopia} globos por copia`);
    }
    const nombres = new Set(r.hoja.estructuras.map((e) => e.nombre));
    assert.ok(r.hoja.otrasPiezas.every((n) => !nombres.has(n)), `${r.id}: otras piezas sin estructura`);
  }
  assert.ok(links >= 10, `${links} piezas de LOL-660 sin globos`);
});

type Rasgos = { helio: boolean; impreso?: { clave: string }; confeti: boolean };

/** Cuántos globos de helio, impresos (por dibujo) y con confeti dice la hoja: en capas, tramos y cuartetos, y en la tabla. */
function rasgosEnLaHoja(hoja: HojaArmado): Map<string, number> {
  const cuenta = new Map<string, number>();
  const contar = (globos: readonly Rasgos[], veces: number) => {
    for (const g of globos) {
      if (g.helio) sumar(cuenta, "helio", veces);
      if (g.impreso) sumar(cuenta, `impreso ${g.impreso.clave}`, veces);
      if (g.confeti) sumar(cuenta, "confeti", veces);
    }
  };
  for (const e of hoja.estructuras) {
    for (const c of e.capas) contar(c.globos, c.repeticiones * e.unidades);
    for (const t of e.tramos) contar(t.globos, e.unidades);
    for (const c of e.cuartetos) contar(c.globos, c.repeticiones * e.unidades);
  }
  for (const f of hoja.compactas) for (const l of f.contenido) contar([l], l.cantidad * f.unidades);
  return cuenta;
}

test("biblioteca: los globos de helio, los impresos (cada dibujo aparte) y los cristales con confeti salen todos en la hoja", () => {
  const total = new Map<string, number>();
  for (const r of biblioteca()) {
    const esperado = new Map<string, number>();
    for (const g of r.armada.globos) {
      if (esGloboDeHelio(g)) sumar(esperado, "helio", 1);
      const impreso = impresoDe(g.estampado);
      if (impreso) sumar(esperado, `impreso ${impreso.clave}`, 1);
      if (g.confeti) sumar(esperado, "confeti", 1);
    }
    assert.deepEqual([...rasgosEnLaHoja(r.hoja)].sort(), [...esperado].sort(), `${r.id}: helio, impresos y confeti`);
    for (const [clave, n] of esperado) sumar(total, clave.split(" ")[0]!, n);
  }
  assert.ok((total.get("helio") ?? 0) > 100 && (total.get("impreso") ?? 0) > 500 && (total.get("confeti") ?? 0) > 10, JSON.stringify([...total]));
});

test("biblioteca: las flores de las piezas con globos y el relleno de las burbujas salen en la hoja", () => {
  let flores = 0, rellenas = 0;
  for (const r of biblioteca()) {
    const piezas = new Map(r.escena.nodos.map((n) => [n.id, n.pieza] as const));
    const conGlobos = r.armada.porNodo.filter((n) => n.globos.length > 0 && n.copias > 0);
    const floresEsperadas = conGlobos.reduce((s, n) => s + n.flores.length, 0);
    const unidades = (lista: ReadonlyArray<{ cantidad: number }>) => lista.reduce((s, f) => s + f.cantidad, 0);
    const floresEnHoja = r.hoja.estructuras.reduce((s, e) => s + unidades(e.flores) * e.unidades, 0) + r.hoja.compactas.reduce((s, f) => s + unidades(f.flores) * f.unidades, 0);
    assert.equal(floresEnHoja, floresEsperadas, `${r.id}: flores`);
    flores += floresEsperadas;
    const burbujas = conGlobos.filter((n) => {
      const p = piezas.get(n.id);
      return p?.tipo === "decoracion" && p.decoracion.tipo === "burbuja" && p.decoracion.propiedades.relleno !== null && n.tubos.some((t) => t.papel?.relleno);
    }).reduce((s, n) => s + n.copias, 0);
    const conRelleno = r.hoja.estructuras.filter((e) => e.relleno).reduce((s, e) => s + e.unidades, 0) + r.hoja.compactas.filter((f) => f.relleno).reduce((s, f) => s + f.unidades, 0);
    assert.equal(conRelleno, burbujas, `${r.id}: burbujas rellenas`);
    rellenas += burbujas;
  }
  assert.ok(flores > 50 && rellenas > 10, `${flores} flores, ${rellenas} burbujas rellenas`);
});

test("biblioteca: dos filas de la tabla compacta nunca se imprimen igual (lo que se ve igual se arma igual y va en una fila)", () => {
  const textoDeFila = (f: HojaArmado["compactas"][number]) => JSON.stringify([
    f.contenido.map((l) => `${l.cantidad} × ${l.formatoId} ${l.nombreColor}${l.infladoCm !== undefined ? ` a ${Math.round(l.infladoCm)} cm` : ""} ${marcasDeLinea(l).join(" · ")}`),
    anexosDeFila(f),
  ]);
  for (const r of biblioteca()) {
    const vistas = r.hoja.compactas.map(textoDeFila);
    const repetidas = vistas.filter((v, i) => vistas.indexOf(v) !== i);
    assert.deepEqual(repetidas, [], `${r.id}: filas que se imprimen igual`);
  }
});

test("biblioteca: las piezas iguales se juntan: el mural de neón pasa de 118 páginas a unas pocas", () => {
  const neon = biblioteca().find((r) => r.id === "idea:mural-neon")!;
  assert.ok(neon.armada.porNodo.length > 100);
  assert.ok(neon.hoja.estructuras.length <= 2, `${neon.hoja.estructuras.length} estructuras`);
  assert.ok(neon.hoja.compactas.length <= 8, `${neon.hoja.compactas.length} filas`);
  assert.ok(neon.paginas.length <= 4, `${neon.paginas.length} páginas`);
  const bonsai = biblioteca().find((r) => r.id === "idea:bonsai-cerezo")!;
  assert.ok(bonsai.paginas.length <= 8, `${bonsai.paginas.length} páginas`);
});

test("biblioteca: cuántas páginas sale una hoja (p50, p90 y máximo de las 405 escenas)", () => {
  const cuentas = biblioteca().map((r) => r.paginas.length).sort((a, b) => a - b);
  const p = (q: number) => cuentas[Math.min(cuentas.length - 1, Math.floor(q * cuentas.length))]!;
  assert.ok(p(0.5) <= 4, `p50 ${p(0.5)}`);
  assert.ok(p(0.9) <= 7, `p90 ${p(0.9)}`);
  assert.ok(p(0.95) <= 9, `p95 ${p(0.95)}`);
  assert.ok(cuentas[cuentas.length - 1]! <= 16, `máximo ${cuentas[cuentas.length - 1]}`);
  for (const r of biblioteca()) {
    // La lista cierra la hoja; después de ella, solo el total de helio (si la escena lleva helio) y nada más.
    const trozos = r.paginas.flatMap((pagina) => pagina.trozos);
    const alFinal = r.hoja.helio ? ["helio"] : [];
    assert.deepEqual(trozos.slice(trozos.length - alFinal.length).map((t) => t.tipo), alFinal, `${r.id}: el total de helio va al final, y solo si hay helio`);
    assert.ok(r.paginas.length >= 1 && trozos.slice(0, trozos.length - alFinal.length).slice(-1)[0]?.tipo === "lista", `${r.id}: la lista cierra la hoja`);
    assert.ok(r.paginas[r.paginas.length - 1]!.trozos.every((t) => t.tipo === "lista" || t.tipo === "helio"), `${r.id}: la última página es la lista`);
    r.paginas.forEach((pagina, i) => {
      assert.equal(pagina.numero, i + 1);
      assert.ok(pagina.trozos.length > 0, `${r.id}: página vacía`);
    });
  }
});

/**
 * El paginador respeta su propio presupuesto (`PAGINA_MM`), medido con su propia estimación: es una invariante del reparto, no
 * una prueba de que la página quepa en el papel. Eso lo comprueba `scripts/ops/medir-hoja-armado.ts` en Chrome, con las letras
 * de la app: mide cada página y cuenta las hojas de papel del PDF de cada escena (tienen que ser tantas como páginas).
 */
test("biblioteca: el paginador no pasa de su presupuesto por página, salvo un elemento que solo ya es más grande", () => {
  const elementos = (t: PaginaHoja["trozos"][number]) => (t.tipo === "estructura" ? t.capas.length + t.tramos.length + t.cuartetos.length : t.tipo === "compacta" ? t.filas.length : t.tipo === "metalizados" ? t.lineas.length : t.tipo === "lista" ? t.lineas.length + 1 : 1);
  for (const r of biblioteca()) {
    for (const pagina of r.paginas) {
      const sola = pagina.trozos.length === 1 && elementos(pagina.trozos[0]!) === 1;
      assert.ok(altoDePagina(pagina) <= PAGINA_MM + 1e-6 || sola, `${r.id}, página ${pagina.numero}: ${altoDePagina(pagina).toFixed(0)} mm de ${PAGINA_MM}`);
    }
  }
});

test("biblioteca: cada estructura aparece completa en las páginas, una sola vez", () => {
  for (const r of biblioteca()) {
    for (const e of r.hoja.estructuras) {
      const trozos = r.paginas.flatMap((p) => p.trozos).filter((t) => t.tipo === "estructura" && t.estructura === e);
      assert.ok(trozos.length >= 1, `${r.id}: ${e.nombre} no está en ninguna página`);
      assert.equal(trozos.filter((t) => t.tipo === "estructura" && t.primero).length, 1);
      const capas = trozos.flatMap((t) => (t.tipo === "estructura" ? t.capas : []));
      const tramos = trozos.flatMap((t) => (t.tipo === "estructura" ? t.tramos : []));
      const cuartetos = trozos.flatMap((t) => (t.tipo === "estructura" ? t.cuartetos : []));
      assert.deepEqual([capas.length, tramos.length, cuartetos.length], [e.capas.length, e.tramos.length, e.cuartetos.length], `${r.id}: ${e.nombre}`);
    }
    const filas = r.paginas.flatMap((p) => p.trozos).flatMap((t) => (t.tipo === "compacta" ? t.filas : []));
    assert.equal(filas.length, r.hoja.compactas.length, `${r.id}: filas de la tabla`);
  }
});

