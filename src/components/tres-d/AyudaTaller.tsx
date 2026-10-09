/** La ayuda del taller: qué hace cada cosa y los atajos de teclado. */
export function Ayuda() {
  const atajos: ReadonlyArray<[string, string]> = [
    ["Clic en una pieza", "Elegirla (clic en el vacío la suelta)"], ["Arrastrar la pieza elegida", "Moverla (imán de 5 cm; Alt lo quita). Con «Girar» o «Subir o bajar» de la barra del visor, girarla o subirla"],
    ["Clic derecho / mantener el dedo / Menú o Shift+F10", "Menú de la pieza: Editar sola, Duplicar, Colgar decoración, Colores, Guardar, Eliminar"],
    ["Enter", "Abrir la pieza elegida en el editor solitario"], ["Flechas", "Mover 5 cm (Shift: 25 cm); lo colgado pasa de ancla"], ["Q / E", "Girar 15° (Shift: 45°)"],
    ["RePág / AvPág", "Subir y bajar (pared, techo); suelta: al frente y al fondo"], ["Supr", "Quitar la pieza (o la copia elegida de un reparto)"], ["Ctrl+D", "Duplicar"],
    ["Ctrl+Z / Ctrl+Y", "Deshacer / rehacer (también lo que hizo la IA: cada turno es un paso)"], ["Esc", "Soltar la pieza, cerrar un panel o un menú, cancelar un arrastre"],
    ["Arrastrar el vacío", "Girar la cámara (rueda o pellizco: acercar)"], ["F2 o doble clic en «Piezas»", "Cambiar el nombre de una pieza"],
  ];
  return (
    <div className="flex flex-col gap-4 p-4 text-sm">
      <p className="text-taller-texto-2">Añade estructuras, decoraciones, utilería o ideas desde <b>Añadir</b> (arrástralas al visor: se marca en verde dónde pueden ir). Elige una pieza para ver sus medidas, colores y lugar en el inspector; <b>Editar sola</b> la abre con todos sus parámetros. La pestaña <b>IA</b> del panel derecho arma y cambia la escena con lo que le pidas: cada respuesta muestra qué cambió y se puede deshacer por turno. La <b>lista de compra</b> trae los globos y los productos exactos de la tienda. La escena y la conversación se guardan solas en este navegador.</p>
      <dl className="grid grid-cols-[minmax(0,14rem)_minmax(0,1fr)] gap-x-4 gap-y-2">
        {atajos.map(([k, v]) => <div key={k} className="contents"><dt className="font-mono text-xs text-taller-acento">{k}</dt><dd className="text-taller-texto-2">{v}</dd></div>)}
      </dl>
      <p className="text-xs text-taller-suave">Medidas nominales del catálogo Sempertex; el color es el del globo inflado. La cuadrícula del piso es de 10 cm.</p>
    </div>
  );
}
