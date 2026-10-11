/**
 * Frases que no se pueden cumplir del todo, o que solo se cumplen con una aproximación: la herramienta tiene que decirlo con un motivo
 * que sirva, dejar la escena intacta cuando rechaza y, aunque el modelo conteste «Listo», la respuesta final lleva el «No pude» o el aviso.
 */
import assert from "node:assert/strict";
import { codigosDe, llamar, nodoDe, unicoNuevo, type Caso } from "./motor";

export const CASOS_HONESTIDAD: Caso[] = [
  {
    area: "honestidad",
    frase: "columna de 8 metros",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("agregar_pieza", { tipo: "columna", alto_cm: 800, colores: ["dorado"] })]],
    rechazo: /fuera de rango: va de 60 a 500 cm/,
    comprobar: () => undefined,
  },
  {
    area: "honestidad",
    frase: "quita la luna",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("quitar_pieza", { id: "luna" })]],
    rechazo: /No hay ninguna pieza con id «luna».*arco.*columna-izq/,
    comprobar: () => undefined,
  },
  {
    area: "honestidad",
    frase: "columna de color unicornio",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("agregar_pieza", { tipo: "columna", colores: ["unicornio"] })]],
    rechazo: /No encontré el color «unicornio».*listar_colores/,
    comprobar: () => undefined,
  },
  {
    area: "honestidad",
    frase: "un número de foil de 120 pulgadas",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("agregar_pieza", { tipo: "metalizado", forma_metalizado: "numero", texto: "5", pulgadas: 120 })]],
    rechazo: /Los metalizados vienen en 16, 18, 27, 32, 34, 40 pulgadas/,
    comprobar: () => undefined,
  },
  {
    area: "honestidad",
    frase: "cambia el naranja por verde reflex (no hay naranja)",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("recolorear_escena", { reemplazar: [{ de: "naranja", a: "verde reflex" }] })]],
    rechazo: /Ninguna pieza usa «naranja»/,
    comprobar: () => undefined,
  },
  {
    area: "honestidad",
    frase: "quita los centros de mesa (no hay centros)",
    base: "salon-armado",
    vueltas: [[llamar("quitar_centros", {})]],
    rechazo: /No hay centros de mesa que quitar/,
    comprobar: () => undefined,
  },
  {
    area: "honestidad",
    frase: "quita la mesa de postres (no hay salón)",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("quitar_zona", { zona: "mesa_postres" })]],
    rechazo: /No hay la mesa de postres en el salón/,
    comprobar: () => undefined,
  },
  {
    area: "honestidad",
    frase: "ponle más R-24 a la columna (es una columna de cuartetos)",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("ajustar_tamanos", { id: "columna-izq", cambios: [{ formato: "R-24", accion: "mas" }] })]],
    rechazo: /ajustar_tamanos es para piezas orgánicas.*cambiar_pieza/,
    comprobar: () => undefined,
  },
  {
    area: "honestidad",
    frase: "haz la sala de 100 metros",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("cambiar_sala", { ancho_cm: 10000 })]],
    rechazo: /fuera de rango: va de 300 a 3000 cm/,
    comprobar: () => undefined,
  },
  {
    area: "honestidad",
    frase: "sube la guirnalda 20 cm (en la sala de 3,2 m no cabe)",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("mover_pieza", { id: "guirnalda", donde: { en: "pared", altura_cm: 260 } })]],
    rechazo: /no cabe bajo el techo de 320 cm/,
    comprobar: () => undefined,
  },
  {
    area: "honestidad",
    frase: "columna chocolate de globos R-18",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("agregar_pieza", { tipo: "columna", formato: "R-18", colores: ["chocolate"] })]],
    rechazo: /076 Fashion Chocolate no se fabrica en R-18.*074 Fashion Café/,
    comprobar: () => undefined,
  },
  {
    area: "honestidad",
    frase: "agrega 200 mesas",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("agregar_mesas", { cantidad: 200, tipo: "redonda" })]],
    fueraDeEsquema: true,
    rechazo: /Parámetros no válidos: cantidad/,
    comprobar: () => undefined,
  },
  {
    area: "honestidad",
    frase: "arma el salón con la herramienta mágica",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("armar_salon_magico", { invitados: 50 })]],
    fueraDeEsquema: true,
    rechazo: /No existe la herramienta «armar salon magico»/,
    comprobar: () => undefined,
  },
  {
    area: "honestidad",
    frase: "cambia el arco a chocolate (en R-24, R-18 y R-9 no se fabrica)",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("cambiar_pieza", { id: "arco", colores: ["chocolate"] })]],
    sumaSola: false,
    tocables: ["arco"],
    comprobar: (ctx) => {
      assert.deepEqual([...codigosDe(ctx.despues, "arco")].sort(), ["074", "076"], "chocolate donde se fabrica y café, el más parecido, donde no");
      assert.match(ctx.respuesta, /Aviso:.*Ningún color de la paleta se fabrica en R-24.*Fashion Café/, "el cambio de color por tamaño llega a la respuesta aunque el modelo diga «Listo»");
    },
  },
  {
    area: "honestidad",
    frase: "un corazón de foil verde",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("agregar_pieza", { tipo: "metalizado", forma_metalizado: "corazon", colores: ["verde"] })]],
    comprobar: (ctx) => {
      const foil = (unicoNuevo(ctx).pieza as { metalizado: { color: string } }).metalizado.color;
      assert.equal(foil, "verde_vibrante", "el único foil verde que hay");
    },
  },
  {
    area: "honestidad",
    frase: "un corazón de foil chocolate (el foil no viene en chocolate)",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("agregar_pieza", { tipo: "metalizado", forma_metalizado: "corazon", colores: ["chocolate"] })]],
    comprobar: (ctx) => {
      const foil = (unicoNuevo(ctx).pieza as { metalizado: { color: string } }).metalizado.color;
      assert.notEqual(foil, "azul_pastel", "un foil azul no se parece a un chocolate");
      assert.match(ctx.respuesta, /Aviso:.*El foil no viene en «chocolate».*foil más parecido/i, "el foil es una aproximación y la respuesta lo tiene que decir aunque el modelo diga «Listo»");
    },
  },
  {
    area: "honestidad",
    frase: "cuántos R-24 tiene el arco",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("contar_globos", { ids: ["arco"], formatos: ["r24"] })]],
    comprobar: (ctx) => {
      assert.equal(ctx.despues, ctx.antes, "contar no toca la escena");
      assert.match(ctx.llamadas[0]!.resumen, /arco: 4 \(R-24 4\)|4 en total/, "responde 4");
      assert.doesNotMatch(ctx.respuesta, /No pude|Ojo/);
    },
  },
  {
    area: "honestidad",
    frase: "no, la otra columna (el modelo pregunta cuál)",
    base: "arco_organico_columnas_guirnalda",
    vueltas: [[llamar("preguntar_usuario", { pregunta: "¿Cuál columna?", opciones: ["la izquierda", "la derecha"] })]],
    comprobar: (ctx) => {
      assert.equal(ctx.despues, ctx.antes, "preguntar no cambia nada");
      assert.equal(nodoDe(ctx.despues, "columna-izq"), nodoDe(ctx.antes, "columna-izq"));
      assert.equal(ctx.llamadas[0]!.consulta, true);
    },
  },
];
