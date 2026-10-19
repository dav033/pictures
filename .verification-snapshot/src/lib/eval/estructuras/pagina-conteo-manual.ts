import { FAMILIAS_V2 } from "./familia-v1-v2";

/**
 * `contar.html`: la página local con la que una persona cuenta a mano las fotos
 * de la evaluación del conteo (ADR-0031, E2). Un solo archivo, sin red, sin CDN
 * y sin servidor: se abre con doble clic. Solo muestra «Foto n de N» y un
 * prefijo del sha256, nunca el nombre del archivo (un nombre como
 * `arco_60_globos.jpg` sesgaría la cuenta).
 *
 * La lógica que decide qué fila es válida y cómo se escribe el CSV es JavaScript
 * sin DOM (`LOGICA_PAGINA`): las pruebas la cargan en un contexto aislado y la
 * comparan con `leerVerdadConteo`, así que la página no puede aceptar una fila
 * que el evaluador rechaza. El texto de las cadenas va con `String.raw` para
 * conservar las barras de las expresiones regulares; no usa comillas invertidas
 * ni `${` ni `</`.
 */

export type FotoPagina = { sha256: string; src: string };

/** Lógica pura de la página. `crearLogica(familias)` devuelve las funciones; no toca el DOM ni el almacenamiento. */
export const LOGICA_PAGINA = String.raw`
function crearLogica(FAMILIAS) {
  var CABECERA = "sha256,globos,exacto,familia";
  function texto(valor) { return valor === null || valor === undefined ? "" : String(valor); }
  function vacia() { return { globos: "", exacto: "", familia: "", nota: "" }; }
  // Lo que viene del almacenamiento del navegador no es de fiar: se vuelve a una forma conocida.
  function normalizar(entrada) {
    var o = entrada && typeof entrada === "object" ? entrada : {};
    var familia = texto(o.familia);
    return {
      globos: texto(o.globos).slice(0, 20),
      exacto: o.exacto === "si" || o.exacto === "no" ? o.exacto : "",
      familia: familia === "nose" || FAMILIAS.indexOf(familia) >= 0 ? familia : "",
      nota: texto(o.nota).slice(0, 2000)
    };
  }
  // Mismas reglas que leerVerdadConteo: globos solo con dígitos (un blanco, "1e1" o "0x10" no son una cuenta) y exacto sí/no.
  function faltantes(fila) {
    var falta = [];
    if (!/^\d{1,6}$/.test(texto(fila.globos).trim())) falta.push("globos");
    if (fila.exacto !== "si" && fila.exacto !== "no") falta.push("exacto");
    return falta;
  }
  function esCompleta(fila) { return faltantes(fila).length === 0; }
  // «No sé» y «sin marcar» salen igual: la familia es opcional en la verdad.
  function familiaCsv(valor) { return valor && valor !== "nose" ? valor : ""; }
  function filaCsv(fila) {
    return [fila.sha256, String(Number(texto(fila.globos).trim())), fila.exacto, familiaCsv(fila.familia)].join(",");
  }
  function resumen(filas) {
    var pendientes = [];
    for (var i = 0; i < filas.length; i += 1) if (!esCompleta(filas[i])) pendientes.push(i + 1);
    return { completas: filas.length - pendientes.length, pendientes: pendientes };
  }
  // Solo filas completas, en el orden de la suite. Una fila incompleta no se escribe: leerVerdadConteo la rechazaría entera.
  function construirCsv(filas) {
    var completas = filas.filter(esCompleta);
    return {
      csv: [CABECERA].concat(completas.map(filaCsv)).join("\n") + "\n",
      completas: completas.length,
      incompletas: filas.length - completas.length
    };
  }
  function entreComillas(valor) { return '"' + texto(valor).replace(/"/g, '""') + '"'; }
  function csvNotas(filas) {
    var conNota = filas.filter(function (fila) { return texto(fila.nota).trim() !== ""; });
    return ["sha256,nota"].concat(conNota.map(function (fila) { return fila.sha256 + "," + entreComillas(fila.nota.trim()); })).join("\n") + "\n";
  }
  function nombreArchivo(base, contador) {
    var limpio = texto(contador).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 30);
    return limpio ? base + "-" + limpio + ".csv" : base + ".csv";
  }
  return { CABECERA: CABECERA, vacia: vacia, normalizar: normalizar, faltantes: faltantes, esCompleta: esCompleta, resumen: resumen, construirCsv: construirCsv, csvNotas: csvNotas, nombreArchivo: nombreArchivo };
}
`;

const CSS = String.raw`
:root { color-scheme: light dark; --fondo: #f5f5f2; --superficie: #ffffff; --texto: #1b1b1b; --suave: #50525a; --borde: #bdbdb6; --acento: #0b5cad; --acento-texto: #ffffff; --ok: #1a7f37; --aviso: #8a5a00; --error: #b3261e; }
@media (prefers-color-scheme: dark) { :root { --fondo: #16171a; --superficie: #202226; --texto: #ececec; --suave: #a9abb0; --borde: #4a4d55; --acento: #6cb2ff; --acento-texto: #07182b; --ok: #56d364; --aviso: #e3b341; --error: #ff8a80; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--fondo); color: var(--texto); font: 16px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
:focus-visible { outline: 3px solid var(--acento); outline-offset: 2px; }
.saltar { position: absolute; left: -999px; top: 0; background: var(--acento); color: var(--acento-texto); padding: 8px 12px; }
.saltar:focus { left: 8px; top: 8px; z-index: 10; }
header { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 24px; padding: 12px 16px; border-bottom: 1px solid var(--borde); background: var(--superficie); }
h1 { font-size: 1.15rem; margin: 0; }
#progreso { margin: 0; font-weight: 600; }
.avance { display: flex; align-items: center; gap: 8px; color: var(--suave); }
progress { width: 140px; height: 12px; }
.campo-contador { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.campo-contador input { width: 9rem; }
main { display: grid; gap: 16px; padding: 16px; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 900px) { main { grid-template-columns: minmax(0, 2fr) minmax(300px, 1fr); align-items: start; } }
.barra-zoom { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; align-items: center; }
#visor { position: relative; overflow: hidden; height: 62vh; min-height: 280px; background: #000; border: 1px solid var(--borde); border-radius: 6px; touch-action: none; cursor: grab; }
#visor.arrastrando { cursor: grabbing; }
#foto { position: absolute; left: 0; top: 0; max-width: none; transform-origin: 0 0; user-select: none; -webkit-user-drag: none; }
@media (min-width: 900px) { #visor { height: min(76vh, 820px); } }
.ayuda-visor { color: var(--suave); font-size: 0.875rem; margin: 6px 0 0; }
#panel { background: var(--superficie); border: 1px solid var(--borde); border-radius: 6px; padding: 16px; display: grid; gap: 14px; }
label, legend { font-weight: 600; display: block; margin-bottom: 4px; }
fieldset { border: 1px solid var(--borde); border-radius: 6px; margin: 0; padding: 8px 12px 10px; }
.opciones { display: flex; gap: 20px; }
.opciones label { font-weight: 400; display: flex; align-items: center; gap: 6px; margin: 0; min-height: 2.25rem; }
input[type="text"], select, textarea { width: 100%; font: inherit; color: inherit; background: var(--fondo); border: 1px solid var(--borde); border-radius: 6px; padding: 8px 10px; min-height: 2.5rem; }
input[type="radio"] { width: 1.15rem; height: 1.15rem; }
input[aria-invalid="true"] { border-color: var(--error); border-width: 2px; }
textarea { min-height: 4.5rem; resize: vertical; }
.pista { color: var(--suave); font-size: 0.875rem; margin: 4px 0 0; }
.error { color: var(--error); font-size: 0.875rem; margin: 4px 0 0; min-height: 1.2em; }
.fila-botones { display: flex; flex-wrap: wrap; gap: 8px; }
button { font: inherit; min-height: 2.5rem; padding: 6px 14px; border-radius: 6px; border: 1px solid var(--borde); background: var(--superficie); color: var(--texto); cursor: pointer; }
button:hover:not(:disabled) { border-color: var(--acento); }
button:disabled { opacity: 0.5; cursor: not-allowed; }
button.principal { background: var(--acento); color: var(--acento-texto); border-color: var(--acento); font-weight: 600; }
#mapa { display: flex; flex-wrap: wrap; gap: 4px; }
#mapa button { min-width: 2.5rem; padding: 4px 6px; }
#mapa button[data-estado="completa"] { border-color: var(--ok); border-width: 2px; }
#mapa button[data-estado="parcial"] { border-style: dashed; border-color: var(--aviso); border-width: 2px; }
#mapa button[aria-current="true"] { background: var(--acento); color: var(--acento-texto); }
#estado-foto { margin: 0; font-weight: 600; }
#estado-foto[data-estado="completa"] { color: var(--ok); }
#estado-foto[data-estado="falta"] { color: var(--aviso); }
#estado { margin: 0; min-height: 2.6em; }
#estado.malo { color: var(--error); font-weight: 600; }
details { color: var(--suave); font-size: 0.9rem; }
kbd { border: 1px solid var(--borde); border-radius: 4px; padding: 0 5px; font: inherit; font-size: 0.85em; }
`;

const UI_PAGINA = String.raw`
(function () {
  "use strict";
  var DATOS = JSON.parse(document.getElementById("datos").textContent);
  var L = crearLogica(DATOS.familias);
  var fotos = DATOS.fotos;
  var N = fotos.length;
  var CLAVE = "conteo-manual:" + DATOS.clave;
  var almacenamientoOk = true;
  var estado = {};
  var contador = "";
  var idx = 0;

  function $(id) { return document.getElementById(id); }
  function leerAlmacen(clave) { try { return window.localStorage.getItem(clave); } catch (e) { almacenamientoOk = false; return null; } }
  function escribirAlmacen(clave, valor) { try { window.localStorage.setItem(clave, valor); } catch (e) { almacenamientoOk = false; } }
  function claveEstado() { return CLAVE + ":" + contador; }

  function avisar(texto, malo) {
    var nodo = $("estado");
    nodo.textContent = texto;
    nodo.className = malo ? "malo" : "";
  }

  function cargar() {
    estado = {};
    var texto = leerAlmacen(claveEstado());
    var guardado = null;
    try { guardado = texto ? JSON.parse(texto) : null; } catch (e) { guardado = null; }
    if (!guardado || typeof guardado !== "object") return;
    fotos.forEach(function (foto) { if (guardado[foto.sha256]) estado[foto.sha256] = L.normalizar(guardado[foto.sha256]); });
  }
  function guardar() {
    escribirAlmacen(claveEstado(), JSON.stringify(estado));
    if (!almacenamientoOk) avisar("Este navegador no deja guardar el avance: descarga el CSV con frecuencia.", true);
  }

  function datosDe(i) {
    var e = estado[fotos[i].sha256] || L.vacia();
    return { sha256: fotos[i].sha256, globos: e.globos, exacto: e.exacto, familia: e.familia, nota: e.nota };
  }
  function todasLasFilas() { return fotos.map(function (_, i) { return datosDe(i); }); }

  // --- Formulario ---------------------------------------------------------------
  function leerFormulario() {
    var marcado = document.querySelector('input[name="exacto"]:checked');
    return L.normalizar({ globos: $("globos").value.trim(), exacto: marcado ? marcado.value : "", familia: $("familia").value, nota: $("nota").value });
  }
  function guardarActual() {
    var e = leerFormulario();
    // El campo de globos conserva lo escrito aunque no sea válido, para que se vea y se corrija.
    e.globos = $("globos").value.trim().slice(0, 20);
    estado[fotos[idx].sha256] = e;
    guardar();
  }
  function pintarValidez() {
    var globos = $("globos").value.trim();
    var malo = globos !== "" && !/^\d{1,6}$/.test(globos);
    $("globos").setAttribute("aria-invalid", malo ? "true" : "false");
    $("error-globos").textContent = malo ? "Escribe solo dígitos: un entero de 0 en adelante." : "";
    var falta = L.faltantes(datosDe(idx));
    var nodo = $("estado-foto");
    nodo.dataset.estado = falta.length === 0 ? "completa" : "falta";
    nodo.textContent = falta.length === 0 ? "Esta foto está completa." : "Falta: " + falta.join(" y ") + ".";
  }
  function refrescar() {
    var filas = todasLasFilas();
    var r = L.resumen(filas);
    $("progreso").textContent = "Foto " + (idx + 1) + " de " + N;
    $("completas").textContent = "Completas: " + r.completas + " de " + N;
    $("barra").value = r.completas;
    var botones = $("mapa").children;
    for (var i = 0; i < botones.length; i += 1) {
      var f = filas[i];
      var completa = L.esCompleta(f);
      var algo = f.globos !== "" || f.exacto !== "";
      var tipo = completa ? "completa" : algo ? "parcial" : "vacia";
      botones[i].dataset.estado = tipo;
      botones[i].setAttribute("aria-label", "Foto " + (i + 1) + ", " + (completa ? "completa" : algo ? "incompleta" : "sin contar"));
      if (i === idx) botones[i].setAttribute("aria-current", "true"); else botones[i].removeAttribute("aria-current");
    }
    $("anterior").disabled = idx === 0;
    $("siguiente").disabled = idx === N - 1;
    $("pendiente").disabled = r.pendientes.length === 0;
    pintarValidez();
  }

  function mostrar(i, enfocar) {
    idx = Math.max(0, Math.min(N - 1, i));
    var e = estado[fotos[idx].sha256] || L.vacia();
    var img = $("foto");
    img.alt = "Foto " + (idx + 1) + " de " + N;
    img.src = fotos[idx].src;
    if (img.complete && img.naturalWidth) ajustar();
    $("sha").textContent = fotos[idx].sha256.slice(0, 12);
    $("globos").value = e.globos;
    document.querySelectorAll('input[name="exacto"]').forEach(function (r) { r.checked = r.value === e.exacto; });
    $("familia").value = e.familia;
    $("nota").value = e.nota;
    refrescar();
    if (enfocar) $("globos").focus();
  }
  function ir(i) { guardarActual(); mostrar(i, true); }
  function primeraPendiente(desde) {
    for (var paso = 0; paso < N; paso += 1) {
      var i = (desde + paso) % N;
      if (!L.esCompleta(datosDe(i))) return i;
    }
    return -1;
  }
  function irAPendiente() {
    guardarActual();
    var i = primeraPendiente(idx + 1);
    if (i < 0) { avisar("Todas las fotos están completas. Descarga verdad.csv."); return; }
    mostrar(i, true);
  }

  // --- Zoom y desplazamiento ----------------------------------------------------
  var z = { base: 1, k: 1, x: 0, y: 0 };
  var punteros = {};
  var distanciaPrevia = 0;
  function aplicar() { $("foto").style.transform = "translate(" + z.x + "px," + z.y + "px) scale(" + z.base * z.k + ")"; }
  function ajustar() {
    var img = $("foto");
    var caja = $("visor").getBoundingClientRect();
    if (!img.naturalWidth) return;
    z.base = Math.min(caja.width / img.naturalWidth, caja.height / img.naturalHeight);
    z.k = 1;
    z.x = (caja.width - img.naturalWidth * z.base) / 2;
    z.y = (caja.height - img.naturalHeight * z.base) / 2;
    aplicar();
  }
  function zoomEn(factor, cx, cy) {
    var nuevo = Math.max(1, Math.min(16, z.k * factor));
    if (nuevo === 1) { ajustar(); return; }
    var f = nuevo / z.k;
    z.x = cx - (cx - z.x) * f;
    z.y = cy - (cy - z.y) * f;
    z.k = nuevo;
    aplicar();
  }
  function zoomCentro(factor) {
    var caja = $("visor").getBoundingClientRect();
    zoomEn(factor, caja.width / 2, caja.height / 2);
  }
  function mover(dx, dy) { z.x += dx; z.y += dy; aplicar(); }

  function iniciarVisor() {
    var visor = $("visor");
    $("foto").addEventListener("load", ajustar);
    window.addEventListener("resize", ajustar);
    visor.addEventListener("wheel", function (e) {
      e.preventDefault();
      var caja = visor.getBoundingClientRect();
      zoomEn(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX - caja.left, e.clientY - caja.top);
    }, { passive: false });
    visor.addEventListener("dblclick", function (e) {
      var caja = visor.getBoundingClientRect();
      if (z.k > 1) ajustar(); else zoomEn(3, e.clientX - caja.left, e.clientY - caja.top);
    });
    visor.addEventListener("pointerdown", function (e) {
      visor.setPointerCapture(e.pointerId);
      punteros[e.pointerId] = { x: e.clientX, y: e.clientY };
      distanciaPrevia = 0;
      visor.classList.add("arrastrando");
    });
    visor.addEventListener("pointermove", function (e) {
      var p = punteros[e.pointerId];
      if (!p) return;
      var ids = Object.keys(punteros);
      if (ids.length === 1) {
        mover(e.clientX - p.x, e.clientY - p.y);
        p.x = e.clientX;
        p.y = e.clientY;
        return;
      }
      p.x = e.clientX;
      p.y = e.clientY;
      if (ids.length === 2) {
        var a = punteros[ids[0]];
        var b = punteros[ids[1]];
        var d = Math.hypot(a.x - b.x, a.y - b.y);
        var caja = visor.getBoundingClientRect();
        if (distanciaPrevia > 0) zoomEn(d / distanciaPrevia, (a.x + b.x) / 2 - caja.left, (a.y + b.y) / 2 - caja.top);
        distanciaPrevia = d;
      }
    });
    function soltar(e) {
      delete punteros[e.pointerId];
      distanciaPrevia = 0;
      if (Object.keys(punteros).length === 0) visor.classList.remove("arrastrando");
    }
    visor.addEventListener("pointerup", soltar);
    visor.addEventListener("pointercancel", soltar);
    $("acercar").addEventListener("click", function () { zoomCentro(1.4); });
    $("alejar").addEventListener("click", function () { zoomCentro(1 / 1.4); });
    $("ajustar").addEventListener("click", ajustar);
  }

  // --- Descargas ----------------------------------------------------------------
  function bajar(nombre, contenido) {
    var url = URL.createObjectURL(new Blob([contenido], { type: "text/csv;charset=utf-8" }));
    var enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = nombre;
    document.body.appendChild(enlace);
    enlace.click();
    document.body.removeChild(enlace);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }
  function descargarVerdad() {
    guardarActual();
    var r = L.construirCsv(todasLasFilas());
    var nombre = L.nombreArchivo("verdad", contador);
    if (r.completas === 0) { avisar("Ninguna foto está completa (faltan globos y exacto): no hay nada que descargar.", true); refrescar(); return; }
    bajar(nombre, r.csv);
    var pendientes = L.resumen(todasLasFilas()).pendientes;
    if (r.incompletas > 0) {
      avisar("Se descargó " + nombre + " con " + r.completas + " fila(s). NO incluye " + r.incompletas + " foto(s) incompletas (" + pendientes.join(", ") + "): quedarían fuera de la evaluación. Complétalas y descarga de nuevo.", true);
    } else {
      avisar("Se descargó " + nombre + " con las " + N + " fotos. Muévelo a la carpeta privada fuera del repositorio (nunca se versiona).");
    }
  }
  function descargarNotas() {
    guardarActual();
    var texto = L.csvNotas(todasLasFilas());
    if (texto === "sha256,nota\n") { avisar("No hay notas escritas."); return; }
    bajar(L.nombreArchivo("notas", contador), String.fromCharCode(0xfeff) + texto);
    avisar("Se descargaron las notas (sha256,nota). No forman parte de la verdad.");
  }

  // --- Arranque -----------------------------------------------------------------
  function construirFamilias() {
    var select = $("familia");
    function opcion(valor, texto) { var o = document.createElement("option"); o.value = valor; o.textContent = texto; select.appendChild(o); }
    opcion("", "Sin marcar");
    DATOS.familias.forEach(function (f) { opcion(f, f.replace(/_/g, " ")); });
    opcion("nose", "No sé");
  }
  function construirMapa() {
    var mapa = $("mapa");
    fotos.forEach(function (_, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = String(i + 1);
      b.addEventListener("click", function () { ir(i); });
      mapa.appendChild(b);
    });
  }
  function empezar() {
    var previo = leerAlmacen(CLAVE + ":contador");
    contador = previo ? previo : "";
    $("contador").value = contador;
    cargar();
    var i = primeraPendiente(0);
    mostrar(i < 0 ? 0 : i, false);
    if (!almacenamientoOk) avisar("Este navegador no deja guardar el avance: descarga el CSV con frecuencia.", true);
  }

  construirFamilias();
  construirMapa();
  iniciarVisor();
  $("max").textContent = String(N);
  ["input", "change"].forEach(function (tipo) {
    $("formulario").addEventListener(tipo, function () { guardarActual(); refrescar(); });
  });
  $("formulario").addEventListener("submit", function (e) { e.preventDefault(); });
  $("anterior").addEventListener("click", function () { ir(idx - 1); });
  $("siguiente").addEventListener("click", function () { ir(idx + 1); });
  $("pendiente").addEventListener("click", irAPendiente);
  $("descargar-verdad").addEventListener("click", descargarVerdad);
  $("descargar-notas").addEventListener("click", descargarNotas);
  $("contador").addEventListener("change", function () {
    guardarActual();
    contador = $("contador").value.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 30);
    $("contador").value = contador;
    escribirAlmacen(CLAVE + ":contador", contador);
    cargar();
    var i = primeraPendiente(0);
    mostrar(i < 0 ? 0 : i, false);
    avisar(contador ? "Avance de «" + contador + "» cargado." : "Avance sin nombre cargado.");
  });

  document.addEventListener("keydown", function (e) {
    if (e.ctrlKey && e.key === "Enter") { e.preventDefault(); ir(idx + 1); return; }
    if (e.key === "PageDown") { e.preventDefault(); ir(idx + 1); return; }
    if (e.key === "PageUp") { e.preventDefault(); ir(idx - 1); return; }
    var etiqueta = e.target && e.target.tagName;
    if (etiqueta === "INPUT" || etiqueta === "TEXTAREA" || etiqueta === "SELECT" || e.altKey || e.ctrlKey || e.metaKey) return;
    var paso = 60;
    if (e.shiftKey && e.key === "ArrowLeft") { e.preventDefault(); mover(paso, 0); }
    else if (e.shiftKey && e.key === "ArrowRight") { e.preventDefault(); mover(-paso, 0); }
    else if (e.shiftKey && e.key === "ArrowUp") { e.preventDefault(); mover(0, paso); }
    else if (e.shiftKey && e.key === "ArrowDown") { e.preventDefault(); mover(0, -paso); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); ir(idx - 1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); ir(idx + 1); }
    else if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomCentro(1.4); }
    else if (e.key === "-") { e.preventDefault(); zoomCentro(1 / 1.4); }
    else if (e.key === "0") { e.preventDefault(); ajustar(); }
  });

  empezar();
})();
`;

const CUERPO = `
<a class="saltar" href="#globos">Ir al formulario de conteo</a>
<header>
  <h1>Conteo manual de globos</h1>
  <p id="progreso" aria-live="polite"></p>
  <div class="avance"><progress id="barra" max="1" value="0" aria-labelledby="completas"></progress><span id="completas"></span></div>
  <div class="campo-contador">
    <label for="contador">Contador (opcional)</label>
    <input id="contador" type="text" maxlength="30" autocomplete="off" aria-describedby="ayuda-contador">
  </div>
</header>
<main>
  <section aria-label="Foto">
    <div class="barra-zoom" role="group" aria-label="Zoom de la foto">
      <button type="button" id="acercar">Acercar (+)</button>
      <button type="button" id="alejar">Alejar (-)</button>
      <button type="button" id="ajustar">Ajustar (0)</button>
    </div>
    <div id="visor" tabindex="0" role="group" aria-label="Foto ampliable: rueda del ratón para acercar, arrastrar para mover">
      <img id="foto" alt="">
    </div>
    <p class="ayuda-visor">Rueda o pellizco para acercar, arrastra para mover, doble clic para acercar o ajustar. Identificador de la foto: <code id="sha"></code></p>
  </section>
  <section id="panel" aria-label="Conteo de esta foto">
    <form id="formulario" novalidate>
      <div>
        <label for="globos">Globos (total de las estructuras de globos de la foto)</label>
        <input id="globos" type="text" inputmode="numeric" maxlength="6" autocomplete="off" aria-describedby="ayuda-globos error-globos" aria-invalid="false">
        <p class="pista" id="ayuda-globos">Un entero de 0 en adelante. Si hay varias estructuras, suma todas.</p>
        <p class="error" id="error-globos" role="alert"></p>
      </div>
      <fieldset>
        <legend>¿Exacto?</legend>
        <div class="opciones">
          <label><input type="radio" name="exacto" value="si"> Sí</label>
          <label><input type="radio" name="exacto" value="no"> No</label>
        </div>
        <p class="pista">Sí solo si los contaste uno a uno y no hay oclusión relevante.</p>
      </fieldset>
      <div>
        <label for="familia">Familia de la estructura principal (opcional)</label>
        <select id="familia"></select>
      </div>
      <div>
        <label for="nota">Notas (opcional, no van en verdad.csv)</label>
        <textarea id="nota" maxlength="2000"></textarea>
      </div>
    </form>
    <p id="estado-foto" aria-live="polite"></p>
    <div class="fila-botones">
      <button type="button" id="anterior">Anterior</button>
      <button type="button" id="siguiente">Siguiente</button>
      <button type="button" id="pendiente">Siguiente sin completar</button>
    </div>
    <div id="mapa" role="group" aria-label="Ir a una foto"></div>
    <div class="fila-botones">
      <button type="button" id="descargar-verdad" class="principal">Descargar verdad.csv</button>
      <button type="button" id="descargar-notas">Descargar notas</button>
    </div>
    <p id="estado" role="status" aria-live="polite"></p>
    <p class="pista" id="ayuda-contador">Dos personas en el mismo navegador: cada una escribe su nombre en «Contador» antes de empezar, y sus avances no se mezclan. El avance se guarda solo en este navegador (<span id="max"></span> fotos).</p>
    <details>
      <summary>Atajos de teclado</summary>
      <ul>
        <li><kbd>Av Pág</kbd> / <kbd>Re Pág</kbd> o <kbd>Ctrl</kbd>+<kbd>Intro</kbd>: foto siguiente o anterior (también escribiendo).</li>
        <li><kbd>←</kbd> <kbd>→</kbd>: foto anterior o siguiente, fuera de los campos.</li>
        <li><kbd>+</kbd> <kbd>-</kbd> <kbd>0</kbd>: acercar, alejar, ajustar. <kbd>Mayús</kbd>+flechas: mover la foto.</li>
      </ul>
    </details>
  </section>
</main>`;

/** Serializa para un `<script type="application/json">`: ni `<` (cierre de etiqueta) ni los separadores de línea de JS. */
export function jsonParaHtml(valor: unknown): string {
  const separadores = new RegExp(`[${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]`, "g");
  const escape = (codigo: number) => `${String.fromCharCode(92)}u${codigo.toString(16).padStart(4, "0")}`;
  return JSON.stringify(valor).replace(/</g, escape(0x3c)).replace(separadores, (c) => escape(c.charCodeAt(0)));
}

export function construirPagina(entrada: { suiteId: string; clave: string; fotos: readonly FotoPagina[] }): string {
  if (entrada.fotos.length === 0) throw new Error("la página necesita al menos una foto");
  const datos = { version: 1, suite_id: entrada.suiteId, clave: entrada.clave, familias: [...FAMILIAS_V2], fotos: entrada.fotos };
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Conteo manual de globos</title>
<style>${CSS}</style>
</head>
<body>${CUERPO}
<script type="application/json" id="datos">${jsonParaHtml(datos)}</script>
<script>${LOGICA_PAGINA}</script>
<script>${UI_PAGINA}</script>
</body>
</html>
`;
}
