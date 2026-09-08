# Mediciones de IA

## Línea base reproducible sin gasto

`npm run ia:bench` ejecuta por defecto un replay determinista de
`eval/ia/fixtures/chapter-3-v001.json`. No carga `.env.local`, no importa código
de aplicación, no abre conexiones de red y no consulta ninguna base de datos.

El informe muestra por turno:

- latencia de parseo, retrieval, TTFT y total;
- vueltas del loop;
- tokens de entrada, salida, pensamiento y caché;
- bytes de imagen enviados;
- coste estimado agrupado por modelo y moneda.

Las cuatro medianas del capítulo 3 aparecen como referencias históricas. El
fixture está calibrado para reproducirlas, pero esto **no** demuestra ±15% en
la API real. Los datos son sintéticos y las tarifas de `pricing-v001.json` son
valores de prueba, no precios publicados ni una factura.

Para salida procesable:

```powershell
npm run ia:bench -- --json
```

## Modo real: bloqueado por defecto

El arnés acepta un driver instrumentado que emita un único documento
`ia-bench.v1` por stdout. No incluye driver pagado: depende de telemetría real
de parseo, retrieval, streaming y uso del proveedor.

Activarlo exige simultáneamente:

1. `--mode=real`;
2. un ejecutable explícito con `--driver=...`;
3. `--ack-paid=I_ACCEPT_PAID_PROVIDER_CALLS`;
4. `--ack-remote-db=I_ACCEPT_REMOTE_DATABASE_ACCESS`;
5. `IA_BENCH_ENABLE_REAL=YES_I_ACCEPT_PAID_PROVIDER_AND_REMOTE_DB`.

Sin las cinco condiciones, aborta antes de ejecutar el driver. El driver se
lanza sin shell y su salida se valida en frontera. Un dataset real debe declarar
`procedencia.tipo=real` y `llamadasProveedorReal=true`.

Definiciones:

- `ttftMs`: tiempo desde inicio de llamada de chat hasta primer fragmento de texto.
- `totalMs`: tiempo completo del turno medido por driver.
- `tokensSalida`: salida entregada reportada.
- `tokensPensamiento`: razonamiento reportado; se suma a salida para coste.
- `tokensCacheados`: parte cacheada de `tokensEntrada`; usa tarifa cacheada, no se cobra dos veces.
- `bytesImagenEntrada`: bytes binarios previos a codificación base64, sumados por turno.

No se guardan prompts, conversaciones, imágenes, base64, secretos ni DSN.
