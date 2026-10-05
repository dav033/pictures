# Informe · inconsistencias del flujo y propuesta de solución

**Escrito el 2026-10-05** a partir de cuatro investigaciones en paralelo (color de la foto, posiciones de lo
orgánico, conteo por color y consistencia del flujo entero), todas sin proveedores pagos y sin tocar los
servidores. Cada afirmación lleva de dónde sale; las marcadas **probado** se reprodujeron llamando a las
funciones reales con entradas pequeñas, y las marcadas **verificado** las comprobé yo además con un comando.
Las de código leído sin ejecutar van como **probable**.

Estado del árbol al escribir: `main` en `1b7c29b` con cuatro archivos ya modificados antes de empezar
(`PLAN-calidad-imagen.md`, `SEGUIMIENTO.md`, `tests/test_conteo_foto.py`, `tests/test_patron_de_la_foto.py`).
Lo que se cambió en esta sesión está en §5 y **no está commiteado**.

---

## 0. Lo urgente, antes de cualquier push

**Producción, el entorno local y `main` son hoy tres productos distintos** (verificado con `gh run list`).

| Revisión | Quality checks | Despliegue |
|---|---|---|
| `c0ebd23` (2026-10-05 01:56) | verde | **desplegado** — es lo que corre en el VPS |
| `605dd96` (merge de `origin/main`) | rojo | omitido |
| `1b7c29b` (HEAD, «wip: punto de control») | rojo | omitido |

`HEAD` enciende **por defecto** 16 banderas que en producción están apagadas (`PATRONES_COLOR_V1`,
`CONTEO_REFERENCIA_V1`, `MEASURED_COLOR_DOMINANCE_V1`, `ANALISIS_COLOR_SEMPERTEX_V1`, `ARMADO_ARCO_COLUMNA_V1`,
`ESTIMAR_CONTEO_V1`, `BOUQUETS_/GUIRNALDAS_ARMADO_V1`, `LECTURA_UNICA_REFERENCIA_ENABLED`, `GUIA_ESCENA_V1`,
`VENUE_AWARE_PLACEMENT_V1`, …) y cambia el modo de imagen por defecto (`base` con el catálogo entero en vez de
`training_1` con el catálogo del LoRA). Como `main` está rojo, nada de eso ha llegado a producción. **El primer
`main` verde lo vuelca todo de golpe**: cambian precios, productos comprados (`aplicarReferenciasMedidas`
cambia productos), el análisis de la foto (v17 en vez de v16) y el motor de imagen. Eso contradice el
encendido por pasos de `PLAN-calidad-imagen.md` (F5) y su aviso de comunicarlo antes al equipo comercial.

**Decidido el 2026-10-05 (S0):** se despliega con todo encendido **salvo `ARMADO_ARCO_COLUMNA_V1`**, que pasa a
apagada por defecto en el código (`46986c6`; en local se enciende en `.env.local`), porque cambiaba la
cotización de los planes nuevos (§6). Comprobarlo después del despliegue con la línea `banderas_efectivas` del
arranque, que es la única verdad sobre producción porque sus entornos no están en el repo. Si el servidor
fijara la bandera a `true` en `/etc/demo-decoracion/demo.env`, mandaría sobre el código.

---

## 1. El flujo, etapa por etapa

1. **Foto** → `src/app/api/references/analyze/route.ts` → Amaterasu (`amaterasu/analizar-referencias-v2.ts`;
   v17 en una llamada por `app/lecturas_foto.py`, o v16 + cuatro lecturas Python) → dominancia en píxeles
   (`dominancia-color.ts`), referencias Sempertex (`referencias-medidas.ts`), piezas espejo.
2. **Chat** → Omoikane en TypeScript (`omoikane/prompt-sistema.ts`, `herramientas/registro-herramientas.ts`);
   la búsqueda de catálogo va a Python (`/catalog/search`).
3. **Confirmar** → unas diez pasadas TypeScript reescriben el plan (`registro-herramientas.ts` ~889-956) →
   `resolverPlan` → Python `/plan/resolve` (`plan.py`, `patron_color.py`, `patron_de_la_foto.py`,
   `armado_estructura.py`, motores) → token firmado.
4. **Tarjeta y editores** → `TarjetaPlanDecoracion.tsx`, `components/plan/*`; la edición por chat
   (`ajustar-plan-chat.ts`) y la del modal van por `aplicar-edicion.ts` → `/api/plan-editar` → `plan_edicion*.py`.
5. **Imagen** → `/api/generate` → `uzume/build-image-prompt.ts` (Gemini) o el compilador LoRA (fal), más la
   guía de escena de Python.
6. **Precio** → `DialogoCotizacion`, `TarjetaCotizacion`, `CotizacionProfesional` → Python.
7. **Configuración y despliegue** → `feature-flags.ts`, `instrumentation.ts`, `lifespan` del ai-api;
   `checks.yml` → `deploy.yml` → `compose.vps.yml`.

---

## 2. Inconsistencias, de mayor a menor impacto

| # | Qué | Dónde | Evidencia |
|---|---|---|---|
| I1 | Producción ≠ local ≠ `main` (ver §0) | `feature-flags.ts`, `.env.example`, servidor | verificado |
| I2 | `main` rojo porque cambiaron números que son de Python y nadie decidió si están bien | `test_plan.py:839` (64 → 88), vector `22-matriz-mezclas-densidades`, densidad, remate; arcos 118 → 58 en los vectores 11, 15, 18, 19, 25 y 26 | probado |
| I3 | Los vectores dorados ya no vigilan nada: `test_plan_regresion.py` no lee el bloque `expected` (el oráculo congelado), solo `expected_python`, que se regeneró desde la implementación | `tests/test_plan_regresion.py:16-20` | probado |
| I4 | El revert `ee5db0f` (2026-10-02) deshizo trabajo que no era suyo: `994175d` había arrastrado la pasada de color del 30-sep, y al revertirlo volvieron el rechazo `COLORES_REFERENCIA_OMITIDOS` y la poda de color inventado, y se perdieron el `.rotate()` EXIF y `test_paridad_color.py`. La ADR-0037 («se avisa, no se impone») sigue diciendo lo contrario que el código | `registro-herramientas.ts:907,1123`; mensaje de `994175d` | verificado |
| I5 | La regla del color de la foto tiene tres dueños: ADR-0037 (avisar), el rechazo y la poda que volvieron (imponer), y el cambio de productos a la referencia Sempertex medida (imponer más fuerte, en TypeScript) | `registro-herramientas.ts:894`; `referencias-medidas.ts` | verificado |
| I6 | Un mismo color tiene tres «cerca»: ΔE 30 al clasificar píxeles, 45 para sustituir en el catálogo y 25 escrito a mano para la pista de patrón. Justo los colores que el catálogo sustituye (burdeos→rojo 40,9; champagne→dorado 40,7; coral→naranja 32,5) hacen que Python tire la lectura del patrón entera | `patron_color.py:51` | probado |
| I7 | **No existe un número por color**: para la misma pieza la participación declarada, la rejilla del patrón (`patrones_color`) y la compra dan tres respuestas (arco 70/20/10 → participación reescrita 50/25/25, rejilla 44/22/22, compra 30/29/29) | `plan.py` `_assign_patterns` ~1246, `_add_silhouette` ~4019 | verificado |
| I8 | Las piezas que arma el motor no respetan el reparto declarado (guirnalda orgánica 70/20/10 → 48/29/22 %; arco orgánico 47/28/25 %; columna orgánica 47/29/24 %) y nada avisa | `organico/motor.py` ~923, ~952 | verificado |
| I9 | El precio de lo orgánico depende de la semilla: la misma guirnalda de 3 m coloca entre 65 y 101 globos; el botón «Probar otra disposición» cambia lo que se compra (arco: 287–309) | `organico/motor.py:253`; `ControlesArcoOrganico.tsx:267-276` | verificado |
| I10 | Lo que la foto lee de la posición no llega al motor: tramos, zonas y espejo se colapsan en un barrido izquierda→derecha; el desnivel de los extremos se pierde (regresión del arreglo del 28-sep); la guirnalda de piso o de mesa se arma y describe como de pared | `patron_de_la_foto.py:157`; `registro-herramientas.ts:701-716`; `armado_estructura.py:1010` | probado |
| I11 | El texto de la imagen no dice dónde va cada color ni cada tamaño, y el semiarco derecho describe el lado pesado en la punta libre | `armado_guirnalda_organica_prompt.py:170-226`; `armado_estructura.py` | probado |
| I12 | Cuatro «colores de tu foto» distintos: las fichas Sempertex crudas, `coloresFotoCliente` (medida cruda, con la pared), la lista por elemento del agente y la paleta cruda del prompt | `color-sempertex.ts`, `colores-referencia.ts`, `prompt-sistema.ts:337` | probado |
| I13 | El agente recibe tres fuentes de proporción y dos listas de color contradictorias para el mismo elemento | `prompt-sistema.ts:128-130, 286-303` | probado |
| I14 | Editar y confirmar no producen la misma lista de materiales: confirmar pasa por ~10 pasadas TypeScript, editar solo por `aplicar-edicion.ts`; las restricciones del cliente no se revisan tras editar | `resolver-backend.ts:107` | probado en código |
| I15 | El chat ofrece cambios que el servidor rechaza (con armado del motor encendido, `_sin_armado_de_motor` rechaza reparto, mezcla, densidad y medidas) y la tarjeta muestra «Pide la propuesta de nuevo» en vez del motivo | `plan_edicion.py:1357`; `traducir-error-servidor.ts:205` | probado |
| I16 | «Deshacer» deja el precio editado y `editadoTrasAprobar` nunca se limpia | `TarjetaPlanDecoracion.tsx:689-692`; `page.tsx:1610` | probado |
| I17 | El análisis v17 está encendido por defecto, contra `AGENTS.md` («v16 congelado byte a byte»); los ejemplos de la galería solo existen para v16, así que cada clic en un ejemplo es un análisis pagado | `analyze/route.ts:52`; `analizar-referencias-v2.ts:610` | probado |
| I18 | Tres reglas distintas para leer banderas (`LECTURA_UNICA=0` sigue encendida; `CHAT_PYTHON_ENABLED=1` sigue apagada); banderas muertas en `.env.local` (`PYTHON_BACKEND_*`, `PLAN_DECORACION_ENABLED`, `RAG_FRANJAS_ENABLED`); `ia:test-banderas` no corre en CI | `feature-flags.ts` | probado |
| I19 | ~23 contratos de transporte escritos a mano en los dos lados; `PistaPatron`, `PistaArmado` y `PistaTamanos` (`extra="forbid"`) sin prueba que los ate al esquema (así nació el 422 de `zonas` del 30-sep); el corte de confianza 0,5 copiado diez veces | `plan.py:415-519`; `python-adapter.ts` | probado |
| I20 | `plan:test` es una cadena `&&`: el primer fallo esconde todos los siguientes (hoy se para en `ia:test-armado-bouquet-prompt` y no dice nada del resto) | `package.json` | verificado |
| I21 | Textos de error que mienten: `SERVICIO_OCUPADO` dice «en unos minutos» para una cola de milisegundos; el chat convierte cualquier error de Python en `RAG_UNAVAILABLE` | `ui-error-v1.ts:164` | probado |
| I22 | Documentación vieja: SEGUIMIENTO §3.B y §3.C ya están hechos y siguen como pendientes; las ADR 0030, 0031, 0032, 0038 y 0039 dicen «apagada»; ninguna ADR recoge el «todo encendido por defecto» del 04-oct; los números 0033, 0034 y 0035 están repetidos | `docs/architecture/decisions/` | probado |

---

## 3. Por frente: qué está mal y qué se arregla

### 3.1 El color de la foto y el agente que arma la propuesta

- **El fondo se cuela como color de la foto** (probado). Un neutro medido que el analizador no nombró (pared
  blanca, gris de estudio, fondo negro) entra primero en `coloresDominantesReferencia`, ocupa uno de los tres
  cupos y echa a un color real: etiquetas `[pearl pink, chrome gold, lilac]` + pared blanca medida →
  `[blanco, rosado, dorado]`, sin lila. Peor: la regla 3 de `aplicarReferenciasMedidas` cambia entonces el
  producto lila por uno blanco, y lo apunta como `acabado_referencia`, que nunca llega al cliente.
- **El gris desaparece** cuando hay medida (con etiquetas se sustituye a plateado y se avisa; con medida se
  pierde sin aviso).
- **Una lectura «un solo color» de confianza 0,2** borra la paleta entera.
- **Los colores que no caben en el tope de tres** reaparecen como aviso en la primera pieza, no en la suya.
- **El prompt del agente se contradice** (I13) y le enseña la paleta cruda con los colores del salón.
- **La pista de patrón es todo o nada** a ΔE 25 (I6).

### 3.2 Las posiciones de lo orgánico (guirnaldas, arcos y semiarcos, columnas)

Lo que la foto lee de la posición casi nunca llega al motor, el motor se inventa la suya y el texto de la
imagen no describe ninguna (I10, I11). Además el reparto declarado se aplana (I8) y el precio depende de la
semilla (I9). Leído y no usado: globos por racimo, forma, puntos de anclaje, toppers, color de relleno, pieza
anfitriona. Ajustes que nadie puede fijar: dónde van los globos grandes, la variación de tamaño, un arco hacia
arriba, más de cuatro caídas.

### 3.3 El conteo por color

I7, I8 e I9, y además: un color declarado puede quedarse **con cero globos** sin aviso (centro de mesa 75/20/5
→ 6/2/0); la reserva de merma del 8 % se reparte entre colores (un kit 100 blanco + 30 dorado compra exactamente
100 blancos sin reserva); el preset en espiral obliga a cada color a llevar al menos un 25 %; un empate 29/29
se rompe por orden alfabético y la imagen dice «mostly blanco» de un arco que se llama «Arco lila»; y
TypeScript recalcula números que son de Python (`RepartoColores.tsx:240`, `BalanceTamanos.tsx:58`,
`mezcla-color-escena.ts:311-331`), contra `AGENTS.md`.

---

## 4. Propuesta de solución

### Principios

1. Todo lo que cambia **qué se compra o qué se cobra** vive en Python. TypeScript dibuja, valida formas y enruta.
2. **Un número por color y por pieza**, publicado por Python y fuera del `plan_hash`; la interfaz, la hoja de
   armado y el prompt de imagen lo leen, nadie lo recalcula.
3. **La foto decide qué colores hay; la medida decide en qué orden y cuánto; el plan decide cuántos globos de
   cada uno; el motor decide dónde van.**
4. Una bandera la lee **solo el proceso que actúa** sobre ella, con **una** regla de lectura; los valores por
   entorno son datos versionados.
5. `main` siempre verde. Lo que cambia precios entra apagado y se enciende por entorno, paso a paso.
6. Revertir un commit revierte o reemplaza también su ADR. La documentación no repite el estado de las
   banderas: lo enlaza.

### Fuente única de banderas

Un manifiesto versionado (`contracts/operational/banderas.v1.json`): por bandera, el proceso dueño, el valor
por defecto, los valores para `local`, `ci` y `produccion`, la clase de efecto (precio, `plan_hash`, coste de
proveedor, imagen, diagnóstico), su ADR y su condición de retirada. `featureEnabled` (TS) y una función
`bandera()` en Python lo leen; un valor que no sea `true/false/1/0/on/off` es un error al arrancar;
`.env.example` se genera desde él; una prueba de CI exige que toda bandera leída esté declarada y viceversa; y
`deploy.yml` falla si los valores efectivos de producción (la línea `banderas_efectivas`, que además llevaría
el hash del manifiesto y el SHA) no coinciden con el manifiesto.

### Cortes, en orden (cada uno se verifica solo)

| Corte | Qué | Dueño |
|---|---|---|
| **S0** | Fijar producción a su comportamiento actual (valores explícitos en el servidor) antes de poner `main` en verde | operación |
| **S1** | `main` verde con oráculos firmados por una persona: decidir 64 vs 88, vector 22, densidad, remate y el arco 118 → 58; editar `expected` a mano y solo después regenerar `expected_python`; que `test_plan_regresion.py` compare también contra `expected`; `ia:test-banderas` en CI; que `plan:test` informe de todos los fallos, no del primero | Python + CI |
| **S2** | Manifiesto de banderas y lector único; retirar `PLAN_BUDGET_GATE_V2` y las variables muertas | TS + Python |
| **S3** | Versionar el script de despliegue al VPS, borrar el de EC2, añadir `services/ai-api/.env.example` | operación |
| **S4** | Política de color en **una** ADR nueva que reemplace a la 0037; mover la sustitución por la referencia medida a Python con **una** distancia exportada; la misma prueba por confirmar y por editar | Python |
| **S5** | Paridad de edición: las tres vías de edición pasan por la misma normalización Python; código y texto propios para «pieza armada por el motor»; el chat solo ofrece lo que se puede hacer; «Deshacer» restaura el precio | Python + TS |
| **S6** | Contratos de transporte exportados desde Zod y generados en los dos lados; fijar `Pista*` al esquema | contratos |
| **S7** | v16 en producción hasta que una evaluación con tope de gasto decida v17; galería regenerada para la variante de producción | evaluación |
| **S8** | Textos de error, borrado de código muerto, corrección de la documentación | TS + docs |

Los arreglos de los tres primeros frentes (§5) son independientes de S0–S8 salvo S1: cambian conteos, así que
sus números necesitan el mismo visto bueno.

---

## 5. Lo que se cambió en esta sesión

Todo en la rama local **`fix/color-organico-conteo`** (sin push; `main` despliega), un commit por arreglo, y en
el clasificador en la rama **`feat/cuotas-color-organico`**. Decisiones del usuario del 2026-10-05: las
etiquetas deciden qué colores hay; el plan impone los colores de la foto avisando; los números del 04-oct se
revisan uno a uno; producción se despliega con todo encendido.

| Commit | Qué |
|---|---|
| `2c0dfaf` | Vuelven el `.rotate()` EXIF de la medida de color y `test_paridad_color.py`, que se llevó el revert (I4) |
| `03ea73d` (+ clasificador `d8466f3`) | Cuotas exactas por color en el motor orgánico, opcionales y **todavía apagadas**: con 70/20/10 una guirnalda pasa de 43/26/20 a 62/18/9; 164 vectores nuevos Node↔Python idénticos y los existentes sin cambios |
| `516ad18` | Las etiquetas deciden los colores y la medida solo ordena (§3.1): el fondo no ocupa cupo, el gris medido se sustituye por plateado avisando, `color_unico` pide confianza ≥ 0,5, el aviso va a su pieza, una sola lista de colores en el prompt del agente, y el cambio de producto que cambia el color se avisa |
| `4307c1f` | Una lectura «un solo color con motas» ya no pierde el color de las motas (foto 08: el dorado) |
| `a032010` | Un número por color (§3.3): avisos `reparto_distinto` / `color_sin_globos` / `patron_sin_aplicar` / `pista_patron_incompleta`, mínimo un globo por color declarado, sin rejilla de preset en piezas del motor, pista de patrón con el radio del catálogo (burdeos→rojo) y empates por orden declarado |
| `fb425b0` | El prompt de imagen: empates por orden del plan y un 50/50 no pide «dominante» |

**Comprobado con las 10 fotos de la galería** (etiquetas reales guardadas + medida local, gratis):

| Foto | Colores de la pieza antes | Después |
|---|---|---|
| 02 guirnalda rosa y dorada | beige, crema, blanco | beige, **rosado, dorado** |
| 07 marco vino y plata | **negro**, burdeos, plateado | burdeos, plateado, **blanco** |
| 08 columnas rosa y dorado | **plateado**, rosado, dorado | rosado, dorado |
| 01 columna rosa y plata | **blanco**, rosado, plateado | rosado, plateado, azul |

**Corrida pagada de solo análisis** (v17, 10 fotos, US$0,095 con el uso informado; tope US$1): la lectura de
la foto casi nunca devuelve zonas, eje, simetría ni los puntos del recorrido de una guirnalda; el techo de
globos de la foto 10 sale como «guirnalda». Mejorar las posiciones a fondo pasa también por mejorar esa lectura
(S4 de la investigación de lo orgánico: campos nuevos, versión nueva del prompt, evaluación pagada).

Después, en la misma rama:

| Commit | Qué |
|---|---|
| `b2a3f48` | Las posiciones de lo orgánico (§3.2): tramos, zonas y espejo leídos pasan al motor; mezcla por modo; globos por racimo; altura según el apoyo (piso 0,45 m, mesa 0,75 m provisional); desnivel de los extremos; espejo del semiarco derecho; el texto de la imagen dice dónde va cada color y tamaño. Sin lectura, nada cambia (probado en 9 piezas) |
| `e9a9a5b`, `7d082fa` | Las pruebas nuevas corren en `plan:test`; los avisos del reparto viajan en `notas_reparto` y el prompt dice que se explican y no se corrigen (no gastan vueltas del modelo) |
| `aadd545` | **Cuotas encendidas**: el plan decide cuántos globos de cada color y el motor dónde (guirnalda 70/20/10 → 62/18/9). Límite conocido: las cuotas no reparten por tamaño (siguiente paso, por el clasificador) |
| `46986c6` | `ARMADO_ARCO_COLUMNA_V1` **apagada por defecto** (decisión del dueño): en producción la receta del motor cambiaba la cotización de los planes nuevos; en local se enciende en `.env.local` |
| `101dc73`, `60cf430` | ADR-0039 §3 y D9: sin lectura del remate, la columna va sin corona. ADR-0041 (nueva): el color de la foto se impone y cada cambio se avisa; reemplaza a la 0037 |

**Todavía en curso:** revertir el conteo por receta del motor de las piezas **sin armado** (decisión del dueño,
§6), con sus vectores dorados y la guía de escena.

**Pendiente de decidir, nuevo:** los colores de muebles e iluminación siguen avisándose en la primera pieza
(decisión del 15-sep con la foto 07; choca con la regla de escenografía de `AGENTS.md`); «light blue» se
compra como `azul` porque el catálogo tiene un solo azul (#1f4fbf).

---

## 6. Los números del 04-oct (revisados con el dueño el 2026-10-05)

Todo sale de `6fc3e95`: dos piezas que llegan **sin armado** dejaron de contarse con la fórmula y pasaron a la
receta del motor. «Antes» es producción (`c0ebd23`), medido ejecutándolo.

| Caso | Antes → ahora | Por qué | Decisión |
|---|---|---|---|
| R1 · arco clásico sin armado | 2,5 × 2,2 m: 118 → **58**; 3 × 2,4 m: 132 → 88; colores 60/40 → 50/50; ignora los tamaños exigidos | Por debajo de 2,6 m el motor cabe 3 globos por capa (salta a 77 con 10 cm más) | **Revertir** a la fórmula |
| R2 · guirnalda orgánica sin armado | 2,5 m: 38/48/60 → **46/76/204**; vector 22 con 54 globos de 5" sin catálogo; confirmar con conteo de foto tarda 2–4 min (límite 75 s) | El volumen «lleno» del motor da ~80 globos/m | **Revertir** a la fórmula |
| R3 · columna sin lectura del remate | Sin el globo de 24"; los globos cobrados no cambian (32 → 32) | Nunca se cobraba | **Aceptar** (ADR-0039 §3 y D9 corregidas) |
| Bandera `ARMADO_ARCO_COLUMNA_V1` | Con ella, un plan nuevo: arco orgánico 119 → 263, columna orgánica 35 → 80, arco clásico 118 → 58 | La confirmación escribe la receta en cada pieza | **Apagada por defecto** hasta corregir el motor |

Pendiente para reabrir R1/R2 y la bandera: corregir en el clasificador el arco angosto (la banda de 3 globos
por capa bajo 2,6 m) y la guirnalda lujosa, y que el conteo de la foto no ejecute el motor cientos de veces.

## 7. Decisiones

**Tomadas por el dueño el 2026-10-05:** rama local con un commit por arreglo (sin push); hasta US$1 de análisis
pagado (se gastaron US$0,095); las etiquetas deciden los colores y la medida ordena; el color de la foto se
impone con avisos (ADR-0041); producción con todo encendido **salvo** `ARMADO_ARCO_COLUMNA_V1`, apagada hasta
corregir el motor; los números del 04-oct según §6 (R1 y R2 se revierten, R3 se acepta).

**Abiertas:**

1. **Encendido en producción**: el orden y cómo se avisa a comercial. Recordatorio de §0: el primer `main` verde
   despliega todo lo demás encendido a la vez.
2. **La proporción de la foto**: ¿restricción o aviso? (por defecto: aviso; hoy no se compara, I5/§3.1).
3. **Cuotas por tamaño**: las cuotas de color no reparten por tamaño (los globos grandes pueden salir todos de un
   color). Siguiente paso por la ruta del clasificador.
4. **El precio de lo orgánico depende de la semilla** (la misma guirnalda de 3 m coloca entre 65 y 101 globos).
5. **Lo orgánico sin lectura**: ¿simétrico y recto por defecto? ¿Altura de una guirnalda sobre mesa (hoy 0,75 m
   provisional)? ¿Una guirnalda que envuelve el fondo se arma como semiarco?
6. **Colores de muebles e iluminación** que se avisan en la primera pieza (decisión del 15-sep) frente a la regla
   de escenografía de `AGENTS.md`; y si el azul claro necesita su propio color de catálogo.
7. **Reserva de merma por color o agrupada** (cambia precios).
8. **v16 o v17 en producción**, y el tope de gasto de la evaluación que lo decida y de la que mida la lectura de
   tramos, zonas, desnivel y puntos de la guirnalda (la corrida de hoy mostró que v17 casi nunca los devuelve).

## 8. Pruebas con las fotos de `Downloads/test` (2026-10-05)

Cinco fotos por el flujo real sin generar imágenes (análisis v17, turno del agente, plan de Python, guía de escena),
cuatro rondas y una de confirmación. Gasto estimado US$1,36 de los 5 autorizados. Las cinco cierran plan en la
ronda final. Informe con imágenes: https://claude.ai/artifact/RQneSgG7ovBxgo8pvcdHGq (privado).

**Resuelto (un commit por arreglo, sin ejecutar suites; ruff/mypy y tsc/eslint sí):**

| Commit | Qué |
|---|---|
| `bccc07f` | La corona no vuelve orgánica una columna clásica; la guía pinta el tono del producto comprado (Azul Rey 041, no Azul 040). |
| `dc739e7` | Un color que solo trae el escenario (letrero, flores, luces) no es color de la decoración. |
| `b0799f7`, `37fbc20` | Color, acabado, forma, categoría u ocasión que solo dice el brief (lo escribe el modelo) no filtran la búsqueda. |
| `4a8ed82` | Una "columna" con lectura de guirnalda confiable apoyada en algo es un semiarco. |
| `7dd9dde` | `COBERTURA_REFERENCIA_INCOMPLETA` dice qué motivo vale para cada elemento. |
| `25bfd30`, `580e526`, `81e2192` | Globos lisos antes que impresos: cobertura de color, desempate léxico por título y pista `colores_en_catalogo`. |
| `6940053` | El error del arco orgánico entra en `_INVALIDOS`: un armado viejo va a la receta, no a un 500. |
| `a8bbcb4` | La lectura de tamaños es la única dueña de la mezcla; el conteo de la foto no la vuelve a mover. |
| `5786a46` | La guía usa el acabado de la línea comprada cuando el título no nombra un tono de la lámina. |

**Abierto (necesita decisión, sin tocar):**

1. La corona se dibuja y no se cobra (D9). Recomendado: cobrarla cuando la foto la lee.
2. La participación de las piezas que cuenta el motor queda como la escribió el agente (80/20 declarado, 50/50
   comprado; se avisa con `reparto_distinto`). Recomendado: reescribirla con el conteo del motor (cambia `plan_hash`).
3. "cluster" se traduce a kit/bouquet (foto 5: 16 globos de 12" y consejo de helio). Taxonomía: decide una persona.
4. Burdeos se resuelve a café: el catálogo clasifica Merlot/Vinotinto/Rojo Imperial como "rojo" y, con ΔE76, café
   queda más cerca. Re-derivar los colores del catálogo con los alias de la taxonomía o pasar a ΔE2000.
5. `catalog_embeddings` tiene 0 filas en la base local: la búsqueda es solo léxica.
6. El bloque de colores exactos del prompt de imagen sigue usando la familia; necesita el código Sempertex de cada
   línea desde Python (contrato).
7. La medida en píxeles cuenta el fondo cuando la caja de la pieza lo cubre (foto 3: 80/20 frente a ~50/50).
