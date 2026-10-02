# Conteo manual de globos: procedimiento

Para qué sirve: `npm run eval:conteo` mide la lectura de conteo de la foto (ADR-0031) contra
una **verdad humana**, y hoy esa verdad no existe. Este procedimiento la produce: unas 30
fotos contadas a mano, de forma fiable y barata, **fuera del repositorio**. Sin ella no se
puede calibrar nada (SEGUIMIENTO-conteo.md §4, punto 3).

Qué se cuenta: el **total de globos de las estructuras de globos de la foto**, la misma
cantidad que mide `eval:conteo` (`globos` en `sha256,globos,exacto,familia`).

## 1. Elegir las fotos

Unas 30, de las que el negocio recibe de verdad. Con permiso para evaluarlas con un proveedor
externo: eso lo declara una persona (paso 3), la herramienta no lo supone.

- **Familias** (`FAMILIAS_V2`): arco, semiarco, columna, guirnalda, pared, centro_mesa, techo,
  figura, bouquet y aro. Al menos 2 de cada una y 3 de las más comunes (arco, guirnalda,
  columna).
- **Tamaños**: 5 a 8 fotos de **15 globos o menos**, contables uno a uno (alimentan la meta de
  ±1); unas 10 de 16 a 60; y **varias densas** (más de 60) donde solo se puede estimar (la meta
  de error relativo).
- **Casos difíciles**: 3 o 4 con globos ocultos o tapados, 2 o 3 con varias estructuras, 2 con
  foil o números.
- Evita varias fotos de la misma fiesta: cuentan como una sola evidencia.

Tienes dos formas de usar la herramienta. Si ya elegiste a mano las 30, ponlas en una carpeta y
usa `--max 30`: se usan todas. Si tienes más, la herramienta elige con un muestreo
**estratificado y reproducible** (misma carpeta y misma `--semilla`, misma elección):

- No hay metadato barato de la estructura (el reconocedor es de pago y no se llama aquí), así
  que estratifica por lo que hay: la **carpeta de primer nivel** si las fotos vienen en 2 o más
  carpetas (por ejemplo una por familia o por tamaño), y dentro de cada una por **orientación**
  y **tercil de tamaño de archivo**. Reparte una foto por estrato y ronda, no en proporción.
- Tamaño de archivo y orientación son pistas débiles, no una verdad. La herramienta **no
  inventa la familia**: la marca la persona al contar. El orden en que salen las fotos ya está
  mezclado y la página nunca muestra el nombre del archivo (un nombre como `arco_60.jpg`
  sesgaría la cuenta).
- Descarta duplicados exactos por sha256. Los casi iguales (recortes, recompresiones) no.

## 2. Reglas de conteo

1. **Un globo es un globo individual**, de látex o de foil. Una figura de foil o un número
   cuenta como 1 (así lo lee el modelo).
2. **Solo cuentan las estructuras de globos** (arco, guirnalda, columna, pared, bouquet...).
   No cuentan: globos sueltos en el piso o en las manos, globos de adorno fuera de la
   estructura, globos impresos en un fondo o telón, reflejos.
3. **Varias estructuras en la foto: se suman todas** en un solo número.
4. **Un globo cuenta si ves al menos la mitad** o su lugar es inequívoco. Una estructura cortada
   por el borde de la foto cuenta con lo que falta estimado.
5. **Globos ocultos** (la mitad trasera de un arco, los tapados por una persona o un mueble):
   se **estiman y se suman** al total, por patrón (racimos por globos por racimo, o globos de
   un tramo por los tramos). Es el total de la estructura, no solo lo visible.
6. En zonas densas cuenta **un racimo, multiplica y marca `exacto = no`**.
7. **`exacto = sí` solo si** contaste cada globo uno a uno **y** no hay oclusión relevante:
   ningún globo oculto, ni parte trasera, ni borde de foto. Si estimaste algo, es `no`. Una foto
   de más de 15 globos puede ser `exacto = sí`, pero entra en la meta de error relativo, no en la
   de ±1.
8. En la duda, escribe la cifra más probable, marca `no` y anótalo en **Notas**. No dejes una
   foto sin contar: sin cuenta no hay fila. Una foto sin globos de estructura no sirve: quítala.
9. **Familia**: la de la estructura con más globos; «No sé» si dudas. Es opcional, pero sin ella
   la medición por familia usa la que predijo el reconocedor.

## 3. Flujo de comandos

`<privado>` es una carpeta tuya **fuera del repositorio** (el script rechaza rutas dentro de él).

```bash
# 1. Preparar. Vista previa por defecto: muestra qué elegiría y no escribe nada.
npx tsx scripts/eval/estructuras/preparar-conteo-manual.ts \
  --fotos <privado>/fotos --salida <privado>/conteo --max 30 --semilla v1
# Con el resultado que quieres, agrega --escribir (y --permiso-proveedor si puedes
# enviar esas fotos a un proveedor externo para evaluar; sin esa bandera la suite
# se escribe sin permiso y eval:conteo la rechaza, también en vista previa).
```

Escribe en `<privado>/conteo`: `suite.json` (para `eval:conteo`), `indice.csv`
(`sha256,archivo`: qué foto es cuál), `verdad.csv` (**plantilla en blanco**: `eval:conteo` la
rechaza hasta que se rellene) y `contar.html`. No pisa archivos existentes sin `--sobrescribir`
(el `verdad.csv` podría tener trabajo humano). Si se interrumpe, repite con `--sobrescribir`;
la misma carpeta y semilla dan los mismos archivos. `--imagenes auto` incrusta las fotos en el
HTML si suman hasta 20 MiB (se abre en cualquier equipo, sin depender de rutas); si no, las
enlaza por `file://` (la página debe abrirse en el equipo donde están las fotos).

```text
2. Contar: abre <privado>/conteo/contar.html con doble clic (sin servidor ni red).
   Cuenta cada foto (globos, exacto, familia, notas). Se guarda solo en el navegador.
   Al terminar pulsa «Descargar verdad.csv» y mueve el archivo a <privado>/conteo,
   reemplazando la plantilla. Solo descarga filas completas y avisa de las que faltan.
```

Atajos: Av Pág y Re Pág (o Ctrl+Intro) cambian de foto aunque estés escribiendo; flechas, fuera
de los campos; `+`, `-`, `0` y Mayús+flechas para acercar, alejar, ajustar y mover la foto.

```bash
# 3. Vista previa de la evaluación: valida suite y verdad y estima el costo. Sin proveedor.
npm run eval:conteo -- --suite <privado>/conteo/suite.json --run-id conteo-v1 \
  --raiz-imagenes <privado>/fotos --verdad <privado>/conteo/verdad.csv \
  --max-usd <tope> --salida <privado>/corridas/conteo-v1

# 4. Corrida real. SOLO cuando una persona haya decidido el gasto y el tope.
npm run eval:conteo -- --suite <privado>/conteo/suite.json --run-id conteo-v1 \
  --raiz-imagenes <privado>/fotos --verdad <privado>/conteo/verdad.csv \
  --salida <privado>/corridas/conteo-v1 --ejecutar --max-usd <tope> --crudos <privado>/crudos
```

**El gasto en proveedor lo decide una persona.** El paso 3 solo estima: la cota es estimada y
sale con la etiqueta de «tokens sin medir» hasta que haya mediciones. El tope de `--max-usd` se
declara antes y la corrida se detiene en él. No lances el paso 4 desde un agente ni un
automatismo. Si se corta, repite el mismo comando con el mismo `--run-id`: reanuda sin repetir
lo hecho.

`--salida` de `eval:conteo` vale `eval/results/conteo/<run-id>` **dentro del repo y sin
ignorar** si no lo pasas: indícalo siempre y no versiones nada de ahí.

## 4. Doble conteo

En **al menos 10 fotos** (que incluyan chicas y densas) cuenta una segunda persona, **sin ver ni
hablar** de la primera. Cada una usa su propio navegador o escribe su nombre en «Contador»
antes de empezar (los avances no se mezclan) y descarga `verdad-<nombre>.csv`.

Acuerdo entre las dos cuentas `a` y `b` de cada foto:

```text
discrepancia = 0                        si a = 0 y b = 0
discrepancia = |a - b| / max(a, b)      en otro caso
```

En una hoja de cálculo: `=SI(MAX(B2;C2)=0;0;ABS(B2-C2)/MAX(B2;C2))`. Reporta la **mediana** de
las discrepancias y el **porcentaje de fotos con discrepancia ≤ 10 %** (en las de hasta 15
globos, el de las que difieren como máximo en 1). Interpretación: si la mediana humana es mayor
que unos pocos puntos, la meta del 25 % no es medible con esa verdad. Toda foto con discrepancia
mayor de 20 % se recuenta entre las dos, y el consenso es la verdad (anótalo; `exacto = sí` solo
si ambas lo marcaron y las cuentas coinciden). En SEGUIMIENTO-conteo.md va solo el resumen
(n, mediana, porcentaje), nunca las filas.

## 5. Dónde guardar

Todo en `<privado>`, **fuera del repositorio y nunca versionado**: `fotos/`, `conteo/`
(`suite.json`, `indice.csv`, `verdad.csv`, `contar.html`, los `verdad-<nombre>.csv`),
`corridas/` y `crudos/`. Ni imágenes, ni rutas absolutas de tu equipo, ni datos del cliente
entran al repo. `indice.csv` y `contar.html` (si lleva las fotos) contienen datos del cliente.
Haz copia de seguridad de `verdad.csv` y del índice: la verdad vale por su `sha256`, y sin el
índice nadie sabe qué foto es cuál.

## 6. Uso posterior (trabajo futuro, no implementado)

Hoy `eval:conteo` compara solo la lectura de la foto con esta verdad: error relativo mediano
por familia (meta ≤ 25 % en densas) y fotos de hasta 15 globos contadas una a una a ±1. El
siguiente paso es comparar contra la misma verdad, foto por foto (por `sha256`), tres totales:
el de la **fórmula** de `plan.py`, el del **motor** y el de la **lectura de la foto**. Hoy
fórmula y motor dan totales distintos y ninguno se ha medido contra algo; esta verdad es el
árbitro común. Ese tercer paso no existe todavía y se decide aparte.
