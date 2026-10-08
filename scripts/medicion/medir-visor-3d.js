/*
 * Medición del editor 3D (/3d, pestaña Escena), para pegar en la consola de Chrome (o correr con Claude in Chrome)
 * con el servidor de desarrollo: usa `window.__visor3d`, que solo existe en desarrollo (ver
 * src/components/tres-d/medicion-visor.ts).
 *
 * Uso: abrir http://localhost:3010/3d → Escena (o Biblioteca → una idea → «Abrir en Escena»), pegar este archivo y
 * luego `__medir3d.resumen(await __medir3d.todo())`. Devuelve:
 * - `cuadro`: lo dibujado por cuadro (llamadas, triángulos…) y los ms de un cuadro forzado (render sincrónico N veces +
 *   gl.finish), sin y con la sombra rehecha;
 * - `reposo` y `giro`: cuántos cuadros dibuja el visor quieto y al girar la cámara (con inercia) hasta pararse;
 * - `acciones`: por acción (elegir, flechas, Q/E, Esc, color y su deshacer), el trabajo en el hilo principal hasta
 *   quedar libre (ms), las tareas largas y lo que anotó el visor (mostrarModulo, armarEscena…).
 * Las acciones se deshacen al terminar (Ctrl+Z y «Deshacer» de la paleta): la escena queda como estaba.
 *
 * Chrome no corre requestAnimationFrame en una pestaña de fondo y retrasa los setTimeout: este script espera con
 * MessageChannel y hace de reloj de cuadros (`cuadroPendiente`), así mide igual con la pestaña oculta.
 */
(() => {
  const ceder = () => new Promise((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });
  const esperar = async (ms) => { const t = performance.now(); while (performance.now() - t < ms) await ceder(); };
  const visor = () => window.__visor3d;
  const principal = () => visor()?.principal() ?? null;
  const lienzo = () => principal()?.lienzo ?? null;

  /** Reloj de cuadros: cada ~16 ms dibuja el cuadro que el visor haya pedido (lo que haría requestAnimationFrame). */
  let reloj = null;
  function encenderReloj() {
    if (reloj) return;
    reloj = { vivo: true };
    const r = reloj;
    (async () => { while (r.vivo) { await esperar(16); principal()?.cuadroPendiente?.(true); } })();
  }
  function apagarReloj() { if (reloj) reloj.vivo = false; reloj = null; }

  /** Un punto de la pantalla por pieza con algo de ella debajo (barre el lienzo en una rejilla). */
  function piezasEnPantalla() {
    const v = principal();
    const c = lienzo();
    if (!v || !c) return new Map();
    v.medirRender(1, false);
    const r = c.getBoundingClientRect();
    const salida = new Map();
    for (let y = r.top + 20; y < r.bottom - 20; y += 24) for (let x = r.left + 20; x < r.right - 20; x += 24) {
      const toque = v.piezaEn(x, y);
      if (toque && !salida.has(toque.nodo)) salida.set(toque.nodo, { x, y });
    }
    return salida;
  }

  // pointerId 1 es el ratón (con otro id, setPointerCapture falla y OrbitControls queda a medias).
  function puntero(tipo, x, y, botones = tipo === "pointerdown" || tipo === "pointermove" ? 1 : 0) {
    lienzo().dispatchEvent(new PointerEvent(tipo, { clientX: x, clientY: y, button: 0, buttons: botones, pointerId: 1, pointerType: "mouse", bubbles: true, cancelable: true }));
  }
  function tecla(key, extra = {}) {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra }));
  }

  /** Corre `accion` y mide: hasta que el hilo queda libre, tareas largas y lo que anotó el visor. */
  async function medir(nombre, accion) {
    const largas = [];
    let obs = null;
    try { obs = new PerformanceObserver((l) => largas.push(...l.getEntries().map((e) => Math.round(e.duration)))); obs.observe({ type: "longtask" }); } catch { /* sin longtask */ }
    principal().medirRender(1, false);
    const c0 = visor().cuadros();
    const t0 = performance.now();
    await accion();
    const sincronico = performance.now() - t0;
    await ceder();
    await ceder();
    const hastaLibre = performance.now() - t0;
    await esperar(400);
    obs?.disconnect();
    const anotado = visor().tiempos().filter((x) => x.t >= t0).map((x) => `${x.que} ${x.ms}`);
    return { nombre, sincronicoMs: Math.round(sincronico * 10) / 10, hastaLibreMs: Math.round(hastaLibre * 10) / 10, tareasLargas: largas, anotado, cuadros: visor().cuadros() - c0 };
  }

  /** Cuántos cuadros dibuja el visor en `ms` sin que nadie lo toque. */
  async function reposo(ms = 1500) {
    const c0 = visor().cuadros();
    await esperar(ms);
    return { ms, cuadros: visor().cuadros() - c0 };
  }

  /** Gira la cámara arrastrando sobre el lienzo y cuenta los cuadros hasta que la inercia se para. */
  async function girar() {
    const r = lienzo().getBoundingClientRect();
    const x0 = r.left + 40, y0 = r.bottom - 40;
    const c0 = visor().cuadros();
    const t0 = performance.now();
    puntero("pointerdown", x0, y0);
    for (let i = 1; i <= 10; i++) { puntero("pointermove", x0 + i * 8, y0); await esperar(16); }
    puntero("pointerup", x0 + 80, y0);
    let ultimo = visor().cuadros(), quieto = performance.now();
    while (performance.now() - quieto < 500 && performance.now() - t0 < 15000) {
      await esperar(50);
      if (visor().cuadros() !== ultimo) { ultimo = visor().cuadros(); quieto = performance.now(); }
    }
    return { cuadros: visor().cuadros() - c0, msHastaParar: Math.round(quieto - t0) };
  }

  async function todo() {
    const v = visor();
    if (!v?.principal()) return "No hay visor: ¿servidor de desarrollo y /3d abierto?";
    encenderReloj();
    try {
      await esperar(500);
      const salida = {};
      salida.cuadro = v.medirRender(30, false);
      salida.cuadroConSombra = v.medirRender(10, true);
      salida.reposo = await reposo();
      salida.giro = await girar();
      salida.reposoTrasGirar = await reposo();
      const piezas = [...piezasEnPantalla().entries()];
      salida.piezas = piezas.map(([id]) => id);
      if (piezas.length < 2) return { ...salida, aviso: "Menos de dos piezas a la vista." };
      const [a, b] = piezas;
      const acciones = [];
      // Elegir: alternar entre dos piezas (clic sin moverse).
      for (const [, p] of [a, b, a, b]) acciones.push(await medir("elegir", () => { puntero("pointerdown", p.x, p.y); puntero("pointerup", p.x, p.y); }));
      // Mover con flechas la elegida, girarla con Q/E (y deshacerlo todo).
      for (const k of ["ArrowRight", "ArrowLeft", "ArrowRight", "ArrowLeft"]) acciones.push(await medir("flecha", () => tecla(k)));
      acciones.push(await medir("girarQ", () => tecla("q")));
      acciones.push(await medir("girarE", () => tecla("e")));
      for (let i = 0; i < 6; i++) { tecla("z", { ctrlKey: true }); await esperar(150); }
      acciones.push(await medir("soltar (Esc)", () => tecla("Escape")));
      // Cambiar un color con la paleta (y deshacerlo con su botón).
      const paleta = document.querySelector('section[aria-label="Colores de la escena"]');
      const usado = paleta?.querySelector("button[aria-pressed]");
      if (usado) {
        usado.click();
        await esperar(300);
        const candidatos = [...paleta.querySelectorAll("button[aria-label]")].filter((x) => !x.getAttribute("aria-label").includes("no viene"));
        const otro = candidatos.find((x) => !x.className.includes("ring-acento")) ?? null;
        if (otro) {
          acciones.push(await medir("color", () => otro.click()));
          const deshacer = [...paleta.querySelectorAll("button")].find((x) => x.textContent?.includes("Deshacer"));
          if (deshacer) acciones.push(await medir("deshacer color", () => deshacer.click()));
        }
        paleta.querySelector('button[aria-pressed="true"]')?.click();
      }
      salida.acciones = acciones;
      salida.reposoFinal = await reposo();
      return salida;
    } finally {
      apagarReloj();
    }
  }

  /** Resumen corto (una línea por acción). */
  function resumen(r) {
    if (typeof r !== "object") return r;
    return {
      cuadro: { ms: r.cuadro?.msPorCuadro, msConSombra: r.cuadroConSombra?.msPorCuadro, ...r.cuadro?.info },
      reposo: r.reposo?.cuadros, giro: r.giro, reposoTrasGirar: r.reposoTrasGirar?.cuadros, reposoFinal: r.reposoFinal?.cuadros,
      acciones: (r.acciones ?? []).map((a) => `${a.nombre}: ${a.hastaLibreMs} ms [${a.anotado.join(", ")}]${a.tareasLargas.length ? ` largas ${a.tareasLargas.join("/")}` : ""}`),
    };
  }

  window.__medir3d = { todo, resumen, medir, reposo, girar, piezasEnPantalla, puntero, tecla, esperar, encenderReloj, apagarReloj };
  return "listo: __medir3d.resumen(await __medir3d.todo())";
})();
