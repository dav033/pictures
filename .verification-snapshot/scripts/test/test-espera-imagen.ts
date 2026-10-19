/**
 * «Ver cómo quedaría» en la guiada, tras producción 2026-10-07 (guiada-20261007-071126-x7w4dx: /api/generate respondió
 * 200 con un PNG de 2,8 MB en base64, el móvil cortó la respuesta y la vista dijo «No pude dibujarla esta vez»).
 * Sin red, sin proveedores y sin coste:
 *   1. la espera (`EsperaImagen`): lienzo con los colores y piezas del plan, frases que cambian sin tiempos ni
 *      porcentajes, un solo anuncio discreto; y la tarjeta del plan con la espera y con el mensaje final;
 *   2. la imagen liviana (`aligerarImagenGenerada`): un PNG de prueba sale en JPEG mucho más chico, misma
 *      resolución y sin diferencia visible (PSNR); si no se puede, la imagen sigue tal cual;
 *   3. la recuperación ante cortes (`pedirImagenConRecuperacion`) con un `fetch` doble: primero se pregunta, nunca se
 *      paga dos veces lo que el servidor ya hizo, un solo reintento silencioso, y nada de reintentos ante un rechazo;
 *   4. el almacén de la imagen recuperable (`imagen-recuperable.ts`) con un Postgres doble.
 *
 * Run: npx tsx scripts/test/test-espera-imagen.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import { EsperaImagen, FRASES_INICIO_ESPERA, FRASES_RONDA_ESPERA, fraseEsperaImagen } from "@/components/guiado/EsperaImagen";
import { TarjetaPlan } from "@/components/guiado/TarjetaPlan";
import { PlanGuiadoSchema } from "@/lib/ia/contracts/asistente-guiado-v1";
import { aligerarImagenGenerada, BYTES_JPEG_YA_LIVIANO } from "@/lib/generacion/imagen-liviana";
import {
  CABECERA_SOLICITUD_IMAGEN,
  ErrorImagen,
  ImagenGeneradaSchema,
  MAX_CONSULTAS_SIN_RED,
  pedirImagenConRecuperacion,
  RUTA_RECUPERAR_IMAGEN,
  type DependenciasImagen,
  type ImagenObtenida,
} from "@/lib/generacion/pedir-imagen";
import {
  EN_CURSO_CADUCA_MS,
  guardarImagenLista,
  leerImagenRecuperable,
  marcarImagenEnCurso,
  marcarImagenFallida,
  solicitudImagenDe,
  type ConsultorPg,
} from "@/lib/generacion/imagen-recuperable";

const resultados: string[] = [];
const ok = (nombre: string) => { resultados.push(nombre); console.log(`[PASS] ${nombre}`); };
const texto = (html: string) => html.replace(/<[^>]+>/g, " ").replaceAll("&quot;", "\"").replaceAll("&#x27;", "'").replace(/\s+/g, " ").trim();
const sinAccion = () => undefined;

async function main(): Promise<void> {
  // ── 1. La espera ───────────────────────────────────────────────────────────────────────────────────────────────────
  {
    const html = renderToStaticMarkup(createElement(EsperaImagen, {
      colores: ["#D4AF37", "#ffffff", "no-es-hex", "#D4AF37"],
      piezas: [
        { id: "EST_01", nombre: "Columna izquierda", dibujo: createElement("svg", { "data-pieza": "EST_01" }) },
        { id: "EST_02", nombre: "Columna derecha", dibujo: createElement("svg", { "data-pieza": "EST_02" }) },
        { id: "EST_03", nombre: "Bouquet", dibujo: createElement("svg", { "data-pieza": "EST_03" }) },
        { id: "EST_04", nombre: "Guirnalda", dibujo: createElement("svg", { "data-pieza": "EST_04" }) },
      ],
    }));
    // Un único estado para el lector de pantalla; el lienzo (con sus frases que rotan) va oculto.
    assert.equal(html.match(/role="status"/g)?.length, 1, "un solo role=status");
    assert.match(html, /role="status" aria-live="polite"/);
    assert.match(html, /<span class="sr-only">Dibujando cómo quedaría tu decoración\.<\/span>/);
    assert.match(html, /data-testid="espera-imagen" aria-hidden="true"/);
    assert.ok(!/aria-busy="true"/.test(html), "aria-busy en una región viva callaría el anuncio");
    // Los colores del plan pintan globos y lienzo; lo que no es #rrggbb no entra.
    assert.ok(html.includes("#D4AF37") && html.includes("#ffffff"), "globos con los colores del plan");
    assert.ok(!html.includes("no-es-hex"));
    // Las piezas del plan (su dibujo del motor), hasta tres.
    for (const id of ["EST_01", "EST_02", "EST_03"]) assert.ok(html.includes(`data-pieza="${id}"`), `pieza ${id}`);
    assert.ok(!html.includes('data-pieza="EST_04"'), "como mucho tres piezas");
    // Mismo hueco que la imagen (4:3), cabe a 390 px (ancho completo, sin anchos fijos).
    assert.match(html, /aspect-\[4\/3\] w-full/);
    assert.ok(!/(?:^|\s)w-\[\d{3,}px\]|min-w-\[\d{3,}px\]/.test(html), "sin anchos fijos que desborden a 390 px");
    // La frase visible y lo que se lee: sin tiempos prometidos ni porcentajes.
    const visible = texto(html);
    assert.ok(visible.includes("Preparando el lienzo"), visible);
    assert.ok(visible.includes("Puedes seguir mirando tu plan mientras tanto."));
    assert.ok(!/\d\s*%|\d+\s*(?:s|seg|segundos|min|minutos)\b/i.test(visible), `sin tiempos ni porcentajes: ${visible}`);
    // Tema claro y oscuro: solo tokens del tema (sin grises ni blancos de Tailwind fijos en el marco y la frase).
    assert.ok(!/\b(?:bg|text|ring)-(?:white|black|gray|slate|zinc|neutral)-?\d*/.test(html), "solo tokens del tema");
    // Sin colores válidos: los de respaldo del tema.
    const respaldo = renderToStaticMarkup(createElement(EsperaImagen, { colores: [] }));
    assert.ok(respaldo.includes("var(--acento)"), "respaldo con el acento del tema");
    assert.ok(!respaldo.includes("data-pieza"));
    ok("1a espera: lienzo con colores y piezas del plan, un anuncio discreto, sin tiempos ni porcentajes");
  }
  {
    assert.equal(fraseEsperaImagen(0), "Preparando el lienzo");
    assert.equal(fraseEsperaImagen(2), "Colocando los globos");
    assert.equal(fraseEsperaImagen(4), "Probando la luz del salón");
    const vuelta = FRASES_INICIO_ESPERA.length;
    assert.equal(fraseEsperaImagen(vuelta), "Últimos detalles");
    assert.equal(fraseEsperaImagen(vuelta + FRASES_RONDA_ESPERA.length), "Últimos detalles", "la ronda final se repite");
    assert.equal(fraseEsperaImagen(-3), "Preparando el lienzo");
    for (let paso = 0; paso < 40; paso += 1) {
      const frase = fraseEsperaImagen(paso);
      assert.ok(frase.length > 0 && frase.length <= 28, `frase corta: ${frase}`);
      assert.ok(!/\d/.test(frase), `sin cifras: ${frase}`);
    }
    ok("1b frases: historia de inicio y ronda final que no promete cuánto falta");
  }
  {
    const plan = PlanGuiadoSchema.parse(JSON.parse(readFileSync("scripts/test/fixtures/plan-guiado-columnas-repetidas.json", "utf8")));
    const props = { plan, usoCosteo: null, compraAbierta: false, vigente: true, ocupado: false, hechas: [], contextoCompra: {}, onAccion: sinAccion, onCosteo: sinAccion, onProveedores: sinAccion, onDistribuidor: sinAccion, onPlanAjustado: sinAccion };
    const cargando = renderToStaticMarkup(createElement(TarjetaPlan, { ...props, estadoImagen: "cargando" }));
    assert.ok(cargando.includes('data-testid="espera-imagen"'), "la tarjeta muestra la espera nueva");
    assert.ok(texto(cargando).includes("Dibujando…"), "el botón dice que está dibujando");
    assert.ok(!texto(cargando).includes("unos segundos"), "ya no promete «unos segundos»");
    const error = texto(renderToStaticMarkup(createElement(TarjetaPlan, { ...props, estadoImagen: "error" })));
    assert.ok(error.includes("La imagen no alcanzó a llegar"), error);
    assert.ok(error.includes("Reintentar imagen"), "el mensaje final lleva a «Reintentar imagen»");
    assert.ok(!error.includes("No pude dibujarla"), "nunca más «No pude dibujarla»");
    ok("1c tarjeta: espera nueva al dibujar y mensaje final en palabras de cliente con «Reintentar imagen»");
  }

  // ── 2. La imagen liviana ───────────────────────────────────────────────────────────────────────────────────────────
  {
    const ancho = 1536;
    const alto = 1024;
    // Un «salón» de prueba: degradado, globos de color con brillo y grano de foto (lo que más le cuesta al JPEG).
    const crudo = Buffer.alloc(ancho * alto * 3);
    const globos = [
      { x: 400, y: 420, r: 150, c: [212, 175, 55] }, { x: 760, y: 360, r: 170, c: [236, 120, 160] },
      { x: 1120, y: 430, r: 150, c: [245, 245, 245] }, { x: 560, y: 700, r: 120, c: [90, 160, 220] },
    ];
    let semilla = 7;
    const azar = () => { semilla = (semilla * 1103515245 + 12345) & 0x7fffffff; return semilla / 0x7fffffff; };
    for (let y = 0; y < alto; y += 1) {
      for (let x = 0; x < ancho; x += 1) {
        let color = [70 + (y / alto) * 90, 60 + (x / ancho) * 60, 80 + (y / alto) * 40];
        for (const globo of globos) {
          const d = Math.hypot(x - globo.x, y - globo.y);
          if (d < globo.r) {
            const brillo = Math.max(0, 1 - Math.hypot(x - (globo.x - globo.r * 0.35), y - (globo.y - globo.r * 0.4)) / (globo.r * 0.6));
            color = globo.c.map((canal) => canal * (0.75 + 0.25 * (1 - d / globo.r)) + brillo * 70);
          }
        }
        const i = (y * ancho + x) * 3;
        for (let canal = 0; canal < 3; canal += 1) crudo[i + canal] = Math.max(0, Math.min(255, Math.round(color[canal]! + (azar() - 0.5) * 6)));
      }
    }
    const png = await sharp(crudo, { raw: { width: ancho, height: alto, channels: 3 } }).png().toBuffer();
    const aligerada = await aligerarImagenGenerada({ mime: "image/png", base64: png.toString("base64") });
    assert.equal(aligerada.resultado, "comprimida");
    assert.equal(aligerada.mime, "image/jpeg");
    assert.equal(aligerada.ancho, ancho);
    assert.equal(aligerada.alto, alto);
    assert.equal(aligerada.bytes.toString("base64"), aligerada.base64);
    assert.ok(aligerada.bytesDespues < aligerada.bytesAntes / 3, `al menos 3× más liviana: ${aligerada.bytesAntes} → ${aligerada.bytesDespues}`);
    const meta = await sharp(aligerada.bytes).metadata();
    assert.equal(meta.format, "jpeg");
    assert.equal(meta.width, ancho);
    // Sin diferencia visible: PSNR alto contra el original.
    const decodificada = await sharp(aligerada.bytes).removeAlpha().raw().toBuffer();
    let error = 0;
    for (let i = 0; i < crudo.length; i += 1) error += (crudo[i]! - decodificada[i]!) ** 2;
    const psnr = 10 * Math.log10((255 * 255) / (error / crudo.length));
    assert.ok(psnr > 38, `PSNR ${psnr.toFixed(1)} dB`);
    // Cabe en el contrato de las dos vistas (y del guardado de la guiada).
    assert.ok(ImagenGeneradaSchema.safeParse({ imagen: `data:${aligerada.mime};base64,${aligerada.base64}` }).success);
    assert.match(`data:${aligerada.mime};base64,`, /^data:image\/(png|jpeg|webp);base64,/, "/api/guiada-imagen acepta jpeg");
    console.log(`       PNG de prueba ${Math.round(aligerada.bytesAntes / 1024)} KB → JPEG ${Math.round(aligerada.bytesDespues / 1024)} KB, PSNR ${psnr.toFixed(1)} dB`);

    // Un JPEG ya liviano no se recomprime; algo que no es imagen sale tal cual (nunca rompe la generación).
    const jpegChico = await sharp(crudo, { raw: { width: ancho, height: alto, channels: 3 } }).resize(320).jpeg({ quality: 80 }).toBuffer();
    assert.ok(jpegChico.length < BYTES_JPEG_YA_LIVIANO);
    const igual = await aligerarImagenGenerada({ mime: "image/jpeg", base64: jpegChico.toString("base64") });
    assert.equal(igual.resultado, "ya_liviana");
    assert.equal(igual.base64, jpegChico.toString("base64"));
    const roto = await aligerarImagenGenerada({ mime: "image/png", base64: Buffer.from("no soy un png").toString("base64") });
    assert.equal(roto.resultado, "fallo");
    assert.equal(roto.mime, "image/png");
    assert.equal(roto.base64, Buffer.from("no soy un png").toString("base64"));
    ok("2 imagen liviana: PNG → JPEG ≥3× más chico, misma resolución, PSNR > 38 dB; si no se puede, va como llegó");
  }

  // ── 3. Recuperación ante cortes (fetch doble) ─────────────────────────────────────────────────────────────────────
  type Respuesta = Response | Error | "colgar";
  type Llamada = { url: string; metodo: string; cabecera: string | null; cuerpo: string | null };
  const IMAGEN = "data:image/jpeg;base64,/9j/AAAA";
  const PLAN_HASH = "c1afac184cbe8e206b4b7bb0a94e38e72a91cece938643f1861c4266440aaf3d";
  const CUERPO = { plan: { plan_hash: PLAN_HASH }, productIds: [], ragVariantIds: ["V-PLATA-12"], brief: { colores: ["plateado"] }, creatividad: 2 };
  const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
  /** Respuesta 200 cuyo cuerpo se corta al leerlo (lo que vio Firefox Android). */
  const cuerpoCortado = () => {
    const respuesta = new Response("{}", { status: 200 });
    Object.defineProperty(respuesta, "json", { value: () => Promise.reject(new TypeError("NetworkError when attempting to fetch resource.")) });
    return respuesta;
  };
  function escenario(generar: Respuesta[], consultar: Respuesta[]) {
    const llamadas: Llamada[] = [];
    const esperas: number[] = [];
    let ids = 0;
    let reloj = 0;
    const dependencias: DependenciasImagen = {
      fetch: (url, init) => {
        const cabeceras = new Headers(init?.headers);
        llamadas.push({ url, metodo: init?.method ?? "GET", cabecera: cabeceras.get(CABECERA_SOLICITUD_IMAGEN), cuerpo: typeof init?.body === "string" ? init.body : null });
        const cola = url === "/api/generate" ? generar : consultar;
        const siguiente = cola.shift();
        if (!siguiente) return Promise.reject(new Error(`llamada inesperada a ${url}`));
        if (siguiente === "colgar") {
          return new Promise((_resolver, rechazar) => init?.signal?.addEventListener("abort", () => rechazar(new DOMException("aborted", "AbortError")), { once: true }));
        }
        return siguiente instanceof Error ? Promise.reject(siguiente) : Promise.resolve(siguiente);
      },
      nuevoId: () => `00000000-0000-4000-8000-00000000000${(ids += 1)}`,
      esperar: async (ms) => { esperas.push(ms); reloj += ms; },
      ahora: () => reloj,
    };
    const eventos: string[] = [];
    const pedir = (extra: { senal?: AbortSignal; limiteIntentoMs?: number } = {}) => pedirImagenConRecuperacion({
      cuerpo: CUERPO,
      planHash: PLAN_HASH,
      senal: extra.senal ?? new AbortController().signal,
      limiteIntentoMs: extra.limiteIntentoMs ?? 90_000,
      alEvento: (evento) => eventos.push(evento),
      dependencias,
    });
    const generaciones = () => llamadas.filter((llamada) => llamada.url === "/api/generate").length;
    const consultas = () => llamadas.filter((llamada) => llamada.url.startsWith(RUTA_RECUPERAR_IMAGEN)).length;
    return { pedir, llamadas, esperas, eventos, generaciones, consultas };
  }
  const red = () => new TypeError("NetworkError when attempting to fetch resource.");
  const fallaCon = async (promesa: Promise<ImagenObtenida>): Promise<ErrorImagen> => {
    try {
      await promesa;
    } catch (error) {
      assert.ok(error instanceof ErrorImagen, `ErrorImagen, no ${String(error)}`);
      return error;
    }
    throw new Error("se esperaba un error");
  };

  {
    const e = escenario([json({ imagen: IMAGEN, avisoNoCotizado: "La mesa no se cotiza." })], []);
    const salida = await e.pedir();
    assert.deepEqual({ via: salida.via, imagen: salida.imagen, aviso: salida.avisoNoCotizado }, { via: "directa", imagen: IMAGEN, aviso: "La mesa no se cotiza." });
    assert.equal(e.llamadas[0]!.cabecera, "00000000-0000-4000-8000-000000000001", "cada intento lleva su id");
    assert.equal(e.llamadas[0]!.cuerpo, JSON.stringify(CUERPO), "el cuerpo de cuerpoGeneracion viaja tal cual (paridad con la clásica)");
    assert.equal(e.consultas(), 0);
    ok("3a sin cortes: una sola petición, cuerpo intacto, id en x-solicitud-imagen y nada de consultas");
  }
  {
    // El caso de producción: el servidor la hizo, la respuesta se cortó en el móvil.
    const e = escenario([red()], [json({ estado: "lista", imagen: IMAGEN })]);
    const salida = await e.pedir();
    assert.equal(salida.via, "recuperada");
    assert.equal(e.generaciones(), 1, "no se paga otra imagen");
    assert.equal(e.llamadas[1]!.url, `${RUTA_RECUPERAR_IMAGEN}?solicitud=00000000-0000-4000-8000-000000000001&plan=${PLAN_HASH}`);
    assert.deepEqual(e.eventos, ["imagen.corte", "imagen.recuperada"]);
    const cortado = escenario([cuerpoCortado()], [json({ estado: "lista", imagen: IMAGEN })]);
    assert.equal((await cortado.pedir()).via, "recuperada", "cuerpo cortado a media lectura");
    assert.equal(cortado.generaciones(), 1);
    ok("3b NetworkError (al pedir o al leer el cuerpo): se recupera la imagen ya hecha sin pagar otra");
  }
  {
    const e = escenario([red()], [json({ estado: "en_curso" }), red(), json({ estado: "en_curso" }), json({ estado: "lista", imagen: IMAGEN })]);
    const salida = await e.pedir();
    assert.equal(salida.via, "recuperada");
    assert.equal(e.consultas(), 4);
    assert.equal(e.generaciones(), 1);
    assert.deepEqual(e.esperas, [2_500, 2_500, 2_500]);
    ok("3c en curso o sin red al consultar: espera y vuelve a preguntar hasta que está lista");
  }
  {
    const e = escenario([red(), json({ imagen: IMAGEN })], [json({ estado: "no_encontrada" }), json({ estado: "no_encontrada" })]);
    const salida = await e.pedir();
    assert.equal(salida.via, "reintento");
    assert.equal(e.generaciones(), 2);
    assert.equal(e.llamadas.at(-1)!.cabecera, "00000000-0000-4000-8000-000000000002", "el reintento lleva otro id");
    assert.equal(e.llamadas.at(-1)!.cuerpo, JSON.stringify(CUERPO), "y el mismo cuerpo");
    assert.ok(e.eventos.includes("imagen.reintento_silencioso"));
    ok("3d nunca llegó al servidor (no encontrada dos veces): un reintento silencioso con otro id");
  }
  {
    const e = escenario([red(), red()], [json({ estado: "fallida" }), json({ estado: "fallida" })]);
    const error = await fallaCon(e.pedir());
    assert.equal(error.clase, "red");
    assert.equal(e.generaciones(), 2, "un solo reintento");
    ok("3e todo falla: dos intentos como mucho y el error llega a la vista");
  }
  {
    const e = escenario([json({ error: "APROBACION_REQUERIDA" }, 409)], []);
    const error = await fallaCon(e.pedir());
    assert.equal(error.clase, "rechazo");
    assert.equal(error.status, 409);
    assert.equal(e.consultas(), 0);
    assert.equal(e.generaciones(), 1);
    const invalida = escenario([json({ imagen: "https://otra-cosa" })], []);
    assert.equal((await fallaCon(invalida.pedir())).clase, "respuesta_invalida");
    assert.equal(invalida.generaciones(), 1);
    ok("3f un rechazo (4xx) o una respuesta sin imagen no se consulta ni se reintenta");
  }
  {
    const e = escenario([json({ error: "fal" }, 503), json({ imagen: IMAGEN })], [json({ estado: "no_encontrada" }), json({ estado: "no_encontrada" })]);
    assert.equal((await e.pedir()).via, "reintento");
    const recuperada = escenario([json({ error: "gateway" }, 504)], [json({ estado: "lista", imagen: IMAGEN })]);
    assert.equal((await recuperada.pedir()).via, "recuperada", "un 504 tras una imagen ya hecha se recupera");
    ok("3g 5xx: se pregunta antes de reintentar (un 504 puede llegar con la imagen ya hecha)");
  }
  {
    const e = escenario(["colgar"], [json({ estado: "fallida" })]);
    const error = await fallaCon(e.pedir({ limiteIntentoMs: 20 }));
    assert.equal(error.clase, "tiempo");
    assert.equal(e.generaciones(), 1, "un tiempo agotado no se reintenta solo");
    assert.equal(e.consultas(), 1, "pero sí se pregunta");
    const tarde = escenario(["colgar"], [json({ estado: "lista", imagen: IMAGEN })]);
    assert.equal((await tarde.pedir({ limiteIntentoMs: 20 })).via, "recuperada", "la que terminó justo al vencer se recupera");
    ok("3h tiempo agotado: se pregunta una vez; sin imagen, el error (sin otra espera larga)");
  }
  {
    const control = new AbortController();
    const e = escenario(["colgar"], []);
    const promesa = e.pedir({ senal: control.signal });
    control.abort("usuario");
    assert.equal((await fallaCon(promesa)).clase, "cancelada");
    assert.equal(e.consultas(), 0);
    ok("3i cancelar desde fuera (empezar de nuevo) corta todo, sin consultas ni reintentos");
  }
  {
    const sinRed = Array.from({ length: MAX_CONSULTAS_SIN_RED }, () => red());
    const e = escenario([red(), json({ imagen: IMAGEN })], sinRed);
    assert.equal((await e.pedir()).via, "reintento");
    assert.equal(e.consultas(), MAX_CONSULTAS_SIN_RED);
    const sinAlmacen = escenario([red(), json({ imagen: IMAGEN })], [json({ estado: "no_disponible" }, 503)]);
    assert.equal((await sinAlmacen.pedir()).via, "reintento");
    assert.equal(sinAlmacen.consultas(), 1, "sin almacén no se insiste");
    ok("3j consultas sin red o sin almacén: se rinde pronto y hace el único reintento");
  }

  // ── 4. El almacén (Postgres doble) ────────────────────────────────────────────────────────────────────────────────
  {
    assert.equal(solicitudImagenDe(new Headers({ [CABECERA_SOLICITUD_IMAGEN]: "0A1B2C3D-0000-4000-8000-000000000001" })), "0a1b2c3d-0000-4000-8000-000000000001");
    assert.equal(solicitudImagenDe(new Headers({ [CABECERA_SOLICITUD_IMAGEN]: "no-es-uuid" })), null);
    assert.equal(solicitudImagenDe(new Headers()), null);

    const consultas: Array<{ texto: string; valores: unknown[] }> = [];
    let filas: unknown[] = [];
    let fallarDdl = true;
    const db: ConsultorPg = {
      query: async (texto, valores = []) => {
        consultas.push({ texto, valores });
        if (texto.includes("CREATE TABLE") && fallarDdl) { fallarDdl = false; throw new Error("sin permiso"); }
        return { rows: texto.trim().startsWith("SELECT") ? filas : [] };
      },
    };
    const id = "0a1b2c3d-0000-4000-8000-000000000001";
    const primera = await marcarImagenEnCurso(db, { solicitudId: id, planHash: PLAN_HASH });
    assert.equal(primera.ok, false, "un fallo de la base se devuelve, no se lanza");
    assert.equal((await marcarImagenEnCurso(db, { solicitudId: id, planHash: PLAN_HASH })).ok, true, "la tabla se vuelve a intentar crear");
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    assert.equal((await guardarImagenLista(db, { solicitudId: id, planHash: PLAN_HASH, mime: "image/jpeg", bytes, avisoNoCotizado: "La mesa no se cotiza." })).ok, true);
    assert.equal((await marcarImagenFallida(db, { solicitudId: id })).ok, true);
    const ddl = consultas.filter((consulta) => consulta.texto.includes("CREATE TABLE")).length;
    assert.equal(ddl, 2, "la tabla se crea una vez por pool (más el intento fallido)");
    const insercion = consultas.find((consulta) => consulta.texto.startsWith("INSERT") && consulta.texto.includes("'lista'"))!;
    assert.deepEqual(insercion.valores, [id, PLAN_HASH, "image/jpeg", bytes, "La mesa no se cotiza."]);
    assert.ok(/WHERE imagen_generada_recuperable\.plan_hash = EXCLUDED\.plan_hash/.test(insercion.texto), "solo la misma solicitud del mismo plan escribe");
    assert.ok(consultas.some((consulta) => consulta.texto.startsWith("DELETE FROM imagen_generada_recuperable WHERE expira <= now()")), "limpia las caducadas");
    assert.ok(/estado = 'en_curso'/.test(consultas.find((consulta) => consulta.texto.startsWith("UPDATE"))!.texto), "fallida solo pisa una en curso");

    filas = [];
    assert.deepEqual(await leerImagenRecuperable(db, { solicitudId: id, planHash: PLAN_HASH }), { estado: "no_encontrada" });
    filas = [{ estado: "en_curso", mime: null, datos: null, aviso_no_cotizado: null, edad_ms: 4_000 }];
    assert.deepEqual(await leerImagenRecuperable(db, { solicitudId: id, planHash: PLAN_HASH }), { estado: "en_curso" });
    filas = [{ estado: "en_curso", mime: null, datos: null, aviso_no_cotizado: null, edad_ms: String(EN_CURSO_CADUCA_MS + 1) }];
    assert.deepEqual(await leerImagenRecuperable(db, { solicitudId: id, planHash: PLAN_HASH }), { estado: "fallida" }, "una en curso que nunca terminó");
    filas = [{ estado: "lista", mime: "image/jpeg", datos: bytes, aviso_no_cotizado: "La mesa no se cotiza.", edad_ms: 10 }];
    assert.deepEqual(await leerImagenRecuperable(db, { solicitudId: id, planHash: PLAN_HASH }), { estado: "lista", imagen: `data:image/jpeg;base64,${bytes.toString("base64")}`, avisoNoCotizado: "La mesa no se cotiza." });
    filas = [{ estado: "lista", mime: "text/html", datos: bytes, aviso_no_cotizado: null, edad_ms: 10 }];
    assert.deepEqual(await leerImagenRecuperable(db, { solicitudId: id, planHash: PLAN_HASH }), { estado: "fallida" }, "solo imágenes");
    const lectura = consultas.filter((consulta) => consulta.texto.trim().startsWith("SELECT")).at(-1)!;
    assert.ok(/plan_hash = \$2 AND expira > now\(\)/.test(lectura.texto), "se lee por solicitud Y plan, y no caducada");
    ok("4 almacén: cabecera validada, tabla creada una vez, escribe la misma solicitud del mismo plan, en curso caduca");
  }

  // ── 5. La migración y el código crean la misma tabla ─────────────────────────────────────────────────────────────
  {
    const migracion = readFileSync("scripts/migrations/027_imagen_generada_recuperable.sql", "utf8");
    const { DDL_IMAGEN_RECUPERABLE } = await import("@/lib/generacion/imagen-recuperable");
    const normalizar = (sql: string) => sql.split("\n").filter((linea) => !linea.trim().startsWith("--")).join(" ").replace(/\s+/g, " ").trim();
    assert.equal(normalizar(migracion), normalizar(DDL_IMAGEN_RECUPERABLE));
    assert.match(migracion, /^-- rollback:/m);
    ok("5 migración 027 = DDL del código (con nota de rollback)");
  }

  console.log(`\n${resultados.length} pruebas pasaron.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
