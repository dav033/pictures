# Runbook — reentrenamiento del LoRA Sempertex v004 (a mano, en el navegador)

Valores exactos para cargar en la web de fal. El fundamento de cada decisión está en
`HANDOFF-LORA-COMPOSICION.md`.

---

## Antes de empezar

**1. Verificá el team.** Arriba a la izquierda en fal.ai tiene que decir **Customer Journey**.
Es el team donde se entrenó el v2 y donde está el saldo (US$21,88). Ya hubo dos incidentes de key
y saldo equivocados: si entrenás desde el team personal, el LoRA queda en otra cuenta y la app no
lo va a poder usar.

**2. El archivo a subir** — copiá esta ruta y pegala en el selector de archivos:

```
C:\Users\davidt\Downloads\demo-decoracion\data\staging\sempertex-general-v004-recaption-fal.zip
```

27,6 MB · 154 imágenes + 154 captions `.txt`. **No** subas el `v003`: ese es el dataset viejo, con
los captions que rompieron el v2.

---

## Paso 1 · Entrenar

Abrí **https://fal.ai/models/fal-ai/flux-2-trainer**

**Una sola corrida.** A US$0,0064 por paso (facturado real: el v2 costó US$25,60 por 4000 pasos),
las tres corridas serían US$19,20 de un saldo de US$21,88 y no quedaría margen para reaccionar.
1000 pasos es el default de fal y el centro de la escalera: deja abiertas las dos direcciones.

| campo | valor |
| --- | --- |
| `image_data_url` | el zip de arriba |
| **`steps`** | **1000** |
| `learning_rate` | **0.00005** |
| `default_caption` | **vacío** |
| `output_lora_format` | `fal` |

**Costo: ~US$6,40.** Un cuarto de lo que costó el v2 roto.

Según el resultado, la segunda corrida (si hace falta) es:

| lo que ves a escala 0,8 | qué hacer | costo |
| --- | --- | --- |
| compone mal (<5/6) | repetir con `steps=500` | US$3,20 |
| compone bien pero sin estilo | repetir con `steps=1500` | US$9,60 |
| pasa el criterio | nada, terminaste | — |

**Lo que NO hay que hacer** — el v2 se entrenó con `steps=4000` y `learning_rate=0.0002`, que son
4× los defaults de fal en ambos ejes. Es la causa del sobreentrenamiento. Si el formulario ya viene
con 1000 y 0.00005, **esos son los defaults correctos: no los toques salvo `steps`**.

`default_caption` va vacío a propósito: las 154 imágenes tienen su `.txt`, y si ponés algo ahí fal
lo usaría en silencio para cualquiera que faltara y contaminaría el entrenamiento.

**Al terminar, guardá la URL del `.safetensors`.** Es lo que vas a necesitar en el paso 2.

```
v004-1000  ->  https://...
```

Anotá también el **costo facturado real**. Que el v2 no tenga procedencia escrita es lo que obligó
a reconstruirla a mano; no repitamos eso.

Tarda decenas de minutos. Podés dejarlo y volver más tarde.

---

## Paso 2 · Probar el LoRA

Abrí **https://fal.ai/models/fal-ai/flux-2/lora**

Cargá estos valores. Son **exactamente** los de producción, para que el resultado sea comparable
con lo ya medido:

| campo | valor |
| --- | --- |
| `loras` → path | la URL del `.safetensors` recién entrenado |
| `loras` → **scale** | **0.8** ← el punto de todo |
| `image_size` | width **1536**, height **1024** |
| `guidance_scale` | **3.5** |
| `num_inference_steps` | **28** |
| `enable_prompt_expansion` | **off** |
| `seed` | uno de: `101` `202` `303` `404` `505` `606` |

**Prompt** (pegar tal cual, incluido el trigger al inicio):

```
eventdecor_style_v2, a grand organic balloon arch in pink and rose gold centered around the stage photo area, two balloon columns, matching one another, one standing on the left and one on the right, flanking the main arch, with a low coordinated balloon centerpiece placed on the main table beneath the main arch. wide photorealistic event photograph, natural depth, believable floor contact and supports.
```

Repetí con los **6 seeds**. Son 6 imágenes, ~US$0,20.

> **Probá a escala 0,8, no a 0,3.** A 0,3 el LoRA está mayormente apagado y cualquier checkpoint
> parece bueno: el v2 da 6/6 a 0,3 y 1/6 a 0,8. Evaluar a 0,3 es hacer trampa.

---

## Paso 3 · Contar

De las 6 imágenes, contá cuántas cumplen **las tres** condiciones:

1. el arco es un arco 3D que cierra — **no** un portal rectangular, **no** un blob
2. hay **dos columnas separadas**, distinguibles de las patas del arco
3. la mesa existe y la escena entra en el cuadro con contexto de sala

| referencia, a escala 0,8 | |
| --- | --- |
| sin LoRA (techo del modelo) | 6/6 |
| v2 actual | **1/6** |
| **v004 para aprobar** | **≥5/6** |

Y además tiene que verse una diferencia de estilo contra el modelo base: globos más grandes y más
cobrizos. Comparalo con `reports/lora-debug/web/crop-seed202.png`.

> **Regla dura:** un checkpoint que solo funcione a 0,3 es un checkpoint **fallado**, por lindas que
> se vean sus imágenes. Es exactamente el criterio que el v2 no habría pasado, y por eso llegó a
> producción.

Si más adelante entrenás una segunda y pasan las dos, quedate con la de **menos pasos**: menos
sobreentrenamiento.

---

## Paso 4a · Si pasa

En `.env.local`:

```
SEMPERTEX_LORA_URL=<la URL nueva>
```

Y en `src/lib/ia/sempertex-lora.ts`, función `loraScale()`, cambiar el default de `0.3` a `0.8`
(hay dos apariciones) y actualizar el comentario con la tasa nueva. Después:

```powershell
npx tsc --noEmit
npm run ia:test-lora-compiler
npm run ia:test-plan-lora-e2e
npm run plan:test-contratos
npm run ia:test
```

## Paso 4b · Si no pasa

**No promuevas nada.** Dejá el v2 a escala 0,3 como control de daños y elegí:

- **(a)** Segunda corrida moviendo `steps` según lo que viste: 500 si compone mal (US$3,20), 1500
  si compone bien pero sin estilo (US$9,60). Si ninguna de las dos direcciones sirve, recién ahí
  mover `learning_rate` a `0.0001`. Un eje por vez.
- **(b)** Atacar la causa real: la bilateralidad solo subió de 3/154 a 11/154 porque **las fotos no
  contienen composiciones bilaterales**, y ningún recaptionado inventa lo que no está en los
  píxeles. Hay que **fotografiar escenas nuevas** con arco central y columnas a los lados.

---

## Atajo, si en algún momento preferís no hacerlo a mano

Todo lo de arriba está automatizado y deja registro de los payloads y del gasto real:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npx tsx scripts/entrenar-lora-v004.ts --dry-run     # revisar sin gastar
npx tsx scripts/entrenar-lora-v004.ts --confirmar   # la corrida de 1000 pasos
npx tsx scripts/eval-lora-nuevo.ts --lora "<url>" --etiqueta v004-1000
npx tsx scripts/exp-contacto.ts --dir reports/lora-debug/eval-v004-1000 --patron scale08 --cols 3
```

El flag `--use-system-ca` es obligatorio en esta máquina: hay un proxy que intercepta TLS y sin él
Node falla contra fal con `UNABLE_TO_VERIFY_LEAF_SIGNATURE`.
