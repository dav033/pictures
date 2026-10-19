/**
 * Pulido de la vista guiada para la presentación (2026-10-07). Sin red, sin modelo, sin coste.
 * Run: npx tsx scripts/test/test-pulido-presentacion-guiada.ts
 *
 * 1. Galería de fotos en la guiada: SIEMPRE la biblioteca real de Sempertex (DialogoBiblioteca, en todos los entornos),
 *    discreta y a 390 px; la foto elegida es el mismo `File` que subir ese JPEG a mano (bytes, nombre y tipo), pasa por
 *    el mismo `elegirFoto` (misma validación y registro) y el servidor la reconoce con la misma lectura revisada.
 * 2. El botón «Arco orgánico» da el arco completo (`arco`) con mezcla de tamaños, como el texto «arco orgánico».
 * 3. «Ajustar mi precio» (EncabezadoPrecio) cabe a 390 px: la fila se envuelve y el botón no se corta.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import { FotosEjemploGuiada, TEXTO_FOTOS_EJEMPLO } from "@/components/guiado/FotosEjemploGuiada";
import { GaleriaEjemplos } from "@/components/ui/shell/GaleriaEjemplos";
import { DESTINO_POR_DEFECTO } from "@/lib/auth/destino-por-defecto";
import { fotoSubidaValida } from "@/components/guiado/foto-subida";
import { PIEZAS_INDIVIDUALES } from "@/components/guiado/PreguntaPropuesta";
import { EncabezadoPrecio } from "@/components/cotizacion/EncabezadoPrecio";
import { archivoDeFotoEjemplo, MANIFIESTO_REFERENCIAS_EJEMPLO, urlFotoEjemplo } from "@/lib/referencias-ejemplo/manifiesto";
import { briefConHechos, estructuraDeTexto, hechosDelCliente, piezaOrganicaDelBoton } from "@/lib/ia/guiado/hechos-cliente";
import { contextoClienteGuiado } from "@/lib/ia/guiado/contexto-cliente";
import { instruccionPlanGuiado } from "@/lib/ia/guiado/instruccion-plan";
import { normalizarPropuestaComposicion } from "@/lib/ia/guiado/propuesta-composicion";

const raiz = process.cwd();
const leer = (relativa: string) => readFileSync(path.join(raiz, relativa), "utf8");
const fotoEnDisco = (archivo: string) => readFileSync(path.join(raiz, "public", "referencias-ejemplo", archivo));

let casos = 0;
async function caso(nombre: string, fn: () => Promise<void> | void): Promise<void> {
  await fn();
  casos += 1;
  console.log(`ok - ${nombre}`);
}

async function run(): Promise<void> {
  // ── 1. Galería de fotos de ejemplo ────────────────────────────────────────────────────────────────────────────
  await caso("1: la guiada ofrece «o prueba con una de nuestras fotos» (SSR), discreto, con teclado y toque", () => {
    const nada = () => undefined;
    const html = renderToStaticMarkup(createElement(FotosEjemploGuiada, { deshabilitado: false, fotoActual: null, onFoto: nada, onRegistrar: nada, onFallo: nada }));
    assert.match(html, new RegExp(TEXTO_FOTOS_EJEMPLO));
    assert.equal(TEXTO_FOTOS_EJEMPLO, "o prueba con una de nuestras fotos");
    assert.match(html, /<button type="button" aria-haspopup="dialog"/, "un botón real: Enter/Espacio y toque");
    assert.match(html, /min-h-11/, "44 px de alto para el dedo");
    assert.match(html, /max-w-full/, "no se sale a 390 px");
    assert.match(html, /text-texto-suave/, "tokens del tema: claro y oscuro");
    assert.doesNotMatch(html, /disabled=""/);
    assert.doesNotMatch(html, /galeria-ejemplos/, "cerrado: la galería no se pinta hasta abrir el diálogo");
    const deshabilitado = renderToStaticMarkup(createElement(FotosEjemploGuiada, { deshabilitado: true, fotoActual: null, onFoto: nada, onRegistrar: nada, onFallo: nada }));
    assert.match(deshabilitado, /disabled=""/, "antes de hidratar no se puede tocar");
  });

  await caso("1: la galería de la guiada es SIEMPRE la biblioteca real (D-039); la de la clásica sigue con sus 10 fotos, en 2 columnas a 390 px", () => {
    const fuente = leer("src/components/guiado/FotosEjemploGuiada.tsx");
    // Pedido del dueño (2026-10-07) y D-039: la misma galería en local, vista previa, Vercel y VPS; sin bandera por entorno.
    assert.match(fuente, /<DialogoBiblioteca\s/, "la guiada abre la biblioteca de Sempertex");
    assert.match(fuente, /FOTOS_BIBLIOTECA\.map/, "muestra las fotos de la biblioteca");
    assert.doesNotMatch(fuente, /<DialogoEjemplos|from "@\/components\/ui\/shell\/GaleriaEjemplos"/, "ya no usa las 10 fotos de ejemplo de la clásica");
    assert.doesNotMatch(fuente, /SOLO_GUIADA|process\.env/, "no elige la galería según el entorno");
    const html = renderToStaticMarkup(createElement(GaleriaEjemplos, { onElegir: () => undefined, titulo: "Fotos de decoraciones con globos" }));
    assert.equal(MANIFIESTO_REFERENCIAS_EJEMPLO.fotos.length, 10);
    for (const foto of MANIFIESTO_REFERENCIAS_EJEMPLO.fotos) assert.match(html, new RegExp(`data-testid="ejemplo-${foto.id}"`), foto.id);
    assert.equal(html.match(/<button type="button"/g)?.length, 10, "cada foto es un botón");
    const css = leer("src/app/globals.css");
    assert.match(css, /\.galeria \{\s*display: grid;\s*width: 100%;\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/, "2 columnas por debajo de 560 px");
    assert.match(leer("src/components/ui/shell/GaleriaEjemplos.tsx"), /w-\[min\(52rem,calc\(100vw-1\.5rem\)\)\] [^"]*overflow-y-auto/, "el diálogo cabe en 390 px y se desplaza");
  });

  await caso("1: en la guiada la elegida entra por `elegirFoto` (mismo camino y registro que una subida)", () => {
    const vista = leer("src/components/guiado/VistaGuiada.tsx");
    assert.match(vista, /<FotosEjemploGuiada deshabilitado=\{!hidratado\} fotoActual=\{foto\} onFoto=\{elegirFoto\} onRegistrar=\{registrarAccion\} onFallo=\{falloFotoEjemplo\} \/>/);
    assert.match(vista, /onFoto=\{elegirFoto\}\s*textoRef=\{textoRef\}/, "el compositor usa el mismo manejador");
    assert.match(vista, /const valida = fotoSubidaValida\(archivo\);\s*registrarAccion\("foto\.elegir", \{ tipo: archivo\.type, bytes: archivo\.size, valida \}\);/);
    assert.match(vista, /registrarFallo\("foto\.ejemplo\.cargar"/);
    const fuente = leer("src/components/guiado/FotosEjemploGuiada.tsx");
    for (const evento of ["foto.ejemplos.abrir", "foto.biblioteca.elegir", "foto.ejemplos.cerrar"]) assert.ok(fuente.includes(`"${evento}"`), `registra ${evento}`);
    assert.match(fuente, /const \[archivo\] = await Promise\.all\(\[archivoDeFotoBiblioteca\(foto\), focoDevuelto\(botonRef\.current\)\]\);\s*setElegida\(\{ id: foto\.id, archivo \}\);\s*onFoto\(archivo\);/, "la foto entra cuando el diálogo ya devolvió el foco: `elegirFoto` lo lleva a la caja de texto");
  });

  await caso("1: la foto de ejemplo es el mismo File que subir ese JPEG y el servidor le da la misma lectura revisada", async () => {
    // Lo que sirve Next desde public/: el archivo intacto como image/jpeg.
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async (entrada: string | URL | Request) => {
      const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.pathname : new URL(entrada.url).pathname;
      const archivo = path.basename(url);
      return new Response(new Uint8Array(fotoEnDisco(archivo)), { status: 200, headers: { "content-type": "image/jpeg" } });
    }) as typeof fetch;
    try {
      const { LECTURAS_EJEMPLOS, lecturaDeEjemplo, sha256DeBytes } = await import("@/lib/ia/amaterasu/lecturas-ejemplos");
      // La variante y el parser de la ruta son los del archivo (lo comprueba test-lecturas-ejemplos.ts, con react-server);
      // aquí no se importa la ruta para poder pintar React en el mismo proceso.
      const opciones = { parserVersion: LECTURAS_EJEMPLOS.parser_version, variante: LECTURAS_EJEMPLOS.variante };
      for (const foto of MANIFIESTO_REFERENCIAS_EJEMPLO.fotos) {
        assert.equal(urlFotoEjemplo(foto), `/referencias-ejemplo/${foto.archivo}`);
        const deEjemplo = await archivoDeFotoEjemplo(foto);
        const bytes = fotoEnDisco(foto.archivo);
        // Lo que da <input type="file"> al subir ese mismo JPEG.
        const subida = new File([new Uint8Array(bytes)], foto.archivo, { type: "image/jpeg" });
        assert.equal(deEjemplo.name, subida.name, foto.id);
        assert.equal(deEjemplo.type, subida.type, foto.id);
        assert.equal(deEjemplo.size, subida.size, foto.id);
        const bytesEjemplo = Buffer.from(await deEjemplo.arrayBuffer());
        assert.ok(bytesEjemplo.equals(Buffer.from(await subida.arrayBuffer())), `${foto.id}: mismos bytes que la subida`);
        assert.equal(fotoSubidaValida(deEjemplo), true, `${foto.id}: pasa la misma validación que una subida`);
        assert.equal(sha256DeBytes(bytesEjemplo), LECTURAS_EJEMPLOS.ejemplos.find((item) => item.id === foto.id)?.sha256, `${foto.id}: es la foto de la lectura revisada`);
        // La guiada la prepara como cualquier subida (`prepararFotoReferencia`: JPEG 0,9) y el servidor la reconoce por huella.
        const preparada = await sharp(bytesEjemplo).rotate().jpeg({ quality: 90 }).toBuffer();
        const lectura = await lecturaDeEjemplo([{ id: "REF_01", mime: "image/jpeg", base64: preparada.toString("base64"), descripcion: "x" }], opciones);
        assert.ok(lectura, `${foto.id}: sin lectura revisada`);
        assert.equal(lectura.ejemplo.id, foto.id);
        assert.equal(lectura.coincidencia, "huella");
        assert.equal(lectura.pixeles, "galeria", "la ruta sigue con los píxeles del archivo de la galería, como la clásica");
      }
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  });

  // ── 2. «Arco orgánico» ─────────────────────────────────────────────────────────────────────────────────────────
  await caso("2: el botón «Arco orgánico» pide el arco completo (`arco`), no `arco_asimetrico`", () => {
    const boton = PIEZAS_INDIVIDUALES.find((pieza) => pieza.etiqueta === "Arco orgánico");
    assert.equal(boton?.estructura, "arco");
    assert.ok(!PIEZAS_INDIVIDUALES.some((pieza) => pieza.estructura === "arco_asimetrico"), "ningún botón da la pata en el aire");
    assert.match(leer("src/app/api/asistente-guiado/route.ts"), /"arco orgánico": "arco",/, "clientes que aún no mandan piezaPedida");
  });

  await caso("2: su etiqueta se lee como el texto «arco orgánico» → mezcla de tamaños en el plan", () => {
    const texto = "Propónme una pieza individual: Arco orgánico."; // lo que manda elegirPieza
    const delBoton = piezaOrganicaDelBoton(texto, "arco");
    const delTexto = estructuraDeTexto("Quiero un arco orgánico");
    assert.deepEqual(delBoton, { id: "arco", texto: "Arco orgánico", organica: true });
    assert.equal(delBoton?.id, delTexto?.id);
    assert.equal(delBoton?.organica, delTexto?.organica);
    // Los demás botones no cambian nada, y un botón que no coincide con su etiqueta tampoco.
    for (const pieza of PIEZAS_INDIVIDUALES.filter((item) => item.etiqueta !== "Arco orgánico")) {
      assert.equal(piezaOrganicaDelBoton(`Propónme una pieza individual: ${pieza.etiqueta}.`, pieza.estructura ?? undefined), null, pieza.etiqueta);
    }
    assert.equal(piezaOrganicaDelBoton(texto, "arco_asimetrico"), null);
    assert.equal(piezaOrganicaDelBoton("Quiero un arco orgánico", "arco"), null, "solo el texto exacto del botón");
    // hechosDelCliente sigue sin leer los textos de botones (usabilidad 97).
    assert.equal(hechosDelCliente([texto]).estructura, undefined);
    // Ruta: va a los hechos del turno (y de ahí al brief) y queda auditado.
    const ruta = leer("src/app/api/asistente-guiado/route.ts");
    assert.match(ruta, /const organicaDelBoton = piezaOrganicaDelBoton\(ultimoUsuario, piezaPedida\);/);
    assert.match(ruta, /const hechos = organicaDelBoton \? \{ \.\.\.hechosLeidos, estructura: organicaDelBoton \} : hechosLeidos;/);
    assert.match(ruta, /decidir\("regla:pieza_organica_boton"/);
    // Brief → contexto de la vista → instrucción del plan: el arco completo con mezcla de tamaños.
    const brief = briefConHechos({}, { estructura: delBoton! }, {});
    const cliente = contextoClienteGuiado(brief, [texto]);
    assert.deepEqual(cliente.organicas, ["arco"]);
    const propuesta = normalizarPropuestaComposicion({ frase: "x", colores: ["blanco", "dorado"], piezas: [{ estructura: "arco", cantidad: 1 }] });
    const instruccion = instruccionPlanGuiado(propuesta, { cliente });
    assert.match(instruccion, /estructura_oficial: arco;/);
    assert.match(instruccion, /Mezcla de tamaños: en Arco /);
    assert.doesNotMatch(instruccionSinCliente(propuesta), /Mezcla de tamaños/, "la mezcla la pone lo orgánico del botón, no el arco liso");
  });

  // ── 3. «Ajustar mi precio» a 390 px ───────────────────────────────────────────────────────────────────────────
  await caso("3: la fila del precio se envuelve y el botón «Ajustar mi precio» no se corta", () => {
    const html = renderToStaticMarkup(createElement(EncabezadoPrecio, {
      datos: null, enviadas: null, atenuar: false, leyenda: { texto: "Calculando…", tono: "normal", reintentar: false }, incluyeIva: true,
      avisoExcluidos: null, abierta: false, idPanel: "p", onAlternar: () => undefined, onReintentar: () => undefined,
    }));
    const fila = /<div class="([^"]*)"><span data-precio-total/.exec(html)?.[1] ?? "";
    assert.ok(fila.split(" ").includes("flex-wrap"), `la fila no se envuelve: ${fila}`);
    assert.ok(fila.split(" ").includes("gap-y-2"), fila);
    const boton = /<button type="button" aria-expanded="false" aria-controls="p" class="([^"]*)">Ajustar mi precio/.exec(html)?.[1] ?? "";
    for (const clase of ["whitespace-nowrap", "max-w-full", "shrink-0", "h-11"]) assert.ok(boton.split(" ").includes(clase), `${clase} en ${boton}`);
    assert.match(html, /data-precio-total="true" class="block min-w-0 /);
  });

  await caso("4: sin bandera por entorno (D-039): proxy, cabecera, conmutador y login iguales en local, vista previa, Vercel y VPS", () => {
    const sinBandera = [
      "src/proxy.ts",
      "src/components/ui/shell/CabeceraApp.tsx",
      "src/components/guiado/ConmutadorVista.tsx",
      "src/components/guiado/FotosEjemploGuiada.tsx",
    ];
    for (const archivo of sinBandera) assert.doesNotMatch(leer(archivo), /SOLO_GUIADA|solo-guiada|paginaBloqueada/, `${archivo}: sin bandera`);
    assert.doesNotMatch(leer("src/proxy.ts"), /redirect\(new URL\(RUTA_GUIADA/, "el proxy no manda la clásica ni el catálogo a /asistente");
    assert.doesNotMatch(leer("src/components/guiado/ConmutadorVista.tsx"), /return null/, "el conmutador se pinta siempre");
    const cabecera = leer("src/components/ui/shell/CabeceraApp.tsx");
    for (const id of ["catalogo", "vista-clasica", "vista-guiada"]) assert.ok(cabecera.includes(`id: "${id}"`), `la cabecera ofrece ${id}`);
    assert.match(cabecera, /\.\.\.\(esDev\r?\n/, "los enlaces internos salen solo con el modo dev");
    assert.equal(DESTINO_POR_DEFECTO, "/asistente", "tras el login sin origen se llega a la guiada");
    assert.match(leer("src/app/api/login/route.ts"), /let from: string = DESTINO_POR_DEFECTO;/);
    assert.doesNotMatch(leer("src/app/login/LoginForm.tsx"), /\|\| "\/"/, "el formulario no cae en la clásica");
  });

  console.log(`\n${casos} casos OK`);
}

function instruccionSinCliente(propuesta: ReturnType<typeof normalizarPropuestaComposicion>): string {
  return instruccionPlanGuiado(propuesta, { cliente: {} });
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
