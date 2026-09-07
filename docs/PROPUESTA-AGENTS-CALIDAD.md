# Propuesta de reglas de arquitectura y calidad

Estado: propuesta; no modifica las instrucciones activas ni configura CI.
Fecha: 2026-09-07.

## Diagnóstico del repositorio

- El único AGENTS.md encontrado dentro del proyecto, excluyendo dependencias y salidas, contiene el bloque generado de Next.js. El archivo personal C:/Users/davidt/.codex/AGENTS.md establece comunicación y uso de RTK. CLAUDE.md remite al AGENTS.md del proyecto.
- eslint.config.mjs usa las configuraciones de Next.js y TypeScript, sin restricciones propias de dependencias entre capas.
- tsconfig.json ya activa strict; excluye packages. Ambos paquetes tienen compilación propia, que debe verificarse explícitamente en CI.
- .github/workflows/deploy.yml ejecuta despliegue SSH al recibir cambios en main. No declara jobs previos de lint, tipos o pruebas. No se inspeccionaron el comando remoto efectivo ni las protecciones de rama: no se afirma que carezcan de controles externos.
- src/app/api/generate/route.ts tiene 1.171 líneas y combina transporte, acceso a datos, resolución de planes, materiales y generación. src/app/page.tsx tiene 2.254 líneas. Son señales de concentración de responsabilidades, no pruebas de defectos por tamaño.
- Chat y generación tipan el JSON entrante como Body sin validar integralmente ese objeto al entrar. Hay validaciones de subestructuras; faltaría un contrato completo del límite HTTP.
- Los archivos de vocabularios/datos alcanzan miles de líneas. Deben distinguirse de lógica ejecutable; no dividirlos artificialmente para cumplir límites.
- src/lib/auth/request.ts permite acceso cuando APP_PASSWORD no existe. Debe definirse explícitamente el comportamiento de producción; este helper aislado no demuestra exposición de todas las rutas.
- Hay cambios locales en curso. Esta revisión no los modifica ni atribuye sus problemas a cambios particulares.

## Distribución de instrucciones

Mantener AGENTS.md raíz corto: invariantes, comandos de calidad y referencias. Conservar íntegro el bloque generado de Next.js. Las preferencias personales permanecen en el archivo personal; las reglas del proyecto deben ser portables.

Crear instrucciones por alcance solo cuando tengan reglas distintas:

| Archivo propuesto | Responsabilidad |
| --- | --- |
| AGENTS.md | Invariantes generales, arquitectura, verificación y entrega |
| src/app/api/AGENTS.md | Contratos HTTP, autenticación, streaming y adaptación de errores |
| src/components/AGENTS.md | Componentes, estado, accesibilidad y rendimiento de interfaz |
| src/lib/AGENTS.md | Dominio, casos de uso y separación de infraestructura |
| packages/AGENTS.md | API pública, independencia y compilación de paquetes |
| services/AGENTS.md | Servicio Python, contratos, workers y persistencia |
| scripts/AGENTS.md | Ejecución reproducible, idempotencia y operaciones de datos |

Las reglas específicas de componentes también deben cubrir src/app/page.tsx mediante la regla raíz o una referencia en src/app/AGENTS.md. No copiar el mismo texto en múltiples archivos. No colocar instrucciones en código generado ni node_modules.

## Texto propuesto para añadir al AGENTS.md raíz

### Invariantes de ingeniería

- Priorizar corrección, seguridad, claridad y rendimiento medido. Toda optimización conserva contratos y demuestra una mejora relevante.
- Leer los módulos afectados y sus consumidores antes de cambiar contratos. Preservar cambios ajenos y limitar el alcance del diff.
- Separar transporte, casos de uso, dominio e infraestructura. Las dependencias del dominio no apuntan a HTTP, React, SDK de proveedores, variables de entorno ni bases de datos.
- Los handlers validan entradas, verifican acceso, invocan un caso de uso y traducen su resultado. No contienen SQL, cálculo comercial ni construcción extensa de prompts.
- Cada regla comercial tiene un propietario. Durante la migración Python, usar puentes explícitos y temporales en lugar de mantener dos versiones de la misma regla.
- Introducir interfaces en límites externos o donde exista necesidad concreta de sustitución. No crear repositorios, fábricas, clases base o microservicios por anticipación.
- Validar datos externos en runtime: HTTP, proveedor IA, webhook, archivo y resultado de herramienta. Usar unknown hasta validar. Un cast no sustituye validación.
- Prohibir nuevos any, ts-ignore y desactivaciones amplias del linter. Una excepción debe tener motivo concreto, alcance mínimo y condición de retirada. Usar ts-expect-error con explicación cuando sea necesario.
- No ocultar errores con catch vacío, resultados ficticios o valores por defecto que aparenten éxito. El fallback debe ser una conducta de producto definida, observable y probada.
- Toda operación externa tiene límites de tiempo y concurrencia. Reintentar solo fallos recuperables y operaciones idempotentes o reconciliables. No duplicar cargos o efectos tras un resultado incierto.
- Verificar autorización sobre cada recurso. Configuración de autenticación ausente debe impedir arranque en producción cuando sea requerida. Los modos de desarrollo permisivos deben ser explícitos.
- No registrar secretos, imágenes completas ni conversaciones completas por defecto. Usar identificadores de correlación y metadatos mínimos.
- Versionar contratos compartidos y cambios de esquema. Definir compatibilidad y reversión antes de retirar una versión.
- Separar código fuente, datos generados, fixtures y artefactos. No depender de archivos locales ignorados para que una instalación limpia funcione.
- Añadir pruebas de comportamiento a reglas, correcciones y contratos afectados. No escribir pruebas que solo reproduzcan la implementación.
- No modificar expectativas o desactivar verificaciones para encubrir regresiones. Explicar cambios intencionales de comportamiento.
- No declarar una entrega verificada sin indicar los comandos ejecutados y resultados. Distinguir fallos nuevos, deuda previa y verificaciones bloqueadas.

### Tamaño y complejidad

- Una unidad tiene una responsabilidad describible. Extraer por motivo de cambio y límites de dominio, no por cantidad de líneas.
- Como alertas iniciales de revisión, usar 400 líneas de lógica por archivo, 80 por función y complejidad ciclomática superior a 10. Son umbrales propuestos, ajustables con la línea base; no límites universales ni bloqueos inmediatos.
- Excluir datos generados de estas alertas. Las excepciones documentan por qué la división empeoraría claridad o coherencia.
- Impedir crecimiento de deuda en módulos intervenidos. No exigir una reestructuración completa como condición para una corrección pequeña.

### Verificación y definición de terminado

- Una corrección incluye reproducción o prueba de regresión cuando el comportamiento pueda verificarse automáticamente.
- Ejecutar lint, comprobación de tipos, compilación de paquetes y pruebas pertinentes. Para cambios que afectan integración o despliegue, incluir build de la aplicación.
- Las pruebas rápidas obligatorias no dependen de claves reales ni proveedores pagados. Integraciones con PostgreSQL usan una base desechable y fixtures.
- Pruebas de IA separan invariantes deterministas de evaluaciones probabilísticas. Versionar datasets, prompts y modelos utilizados; no comparar texto libre por igualdad literal.
- Un cambio de rendimiento presenta escenario reproducible y medición anterior/posterior. Fijar presupuestos a partir de necesidades y línea base, no de números inventados.
- Cambios arquitectónicos registran brevemente problema, decisión, alternativas relevantes, consecuencias y reversión en docs/architecture/decisions/.
- La entrega explica comportamiento resultante, validación y limitaciones. Una tarea pendiente no equivale a un control implementado.

## Reglas específicas que deben acompañar al documento raíz

### API y contratos

- Esquema completo de entrada; errores 4xx previsibles para JSON inválido y validación fallida.
- Validar tamaño, tipo de contenido, archivos y destinos remotos cuando corresponda.
- Separar autenticación de autorización; verificar identidad entre Next.js y Python.
- Contratos de streaming con evento terminal, error y desconexión definidos.
- No filtrar stack traces ni detalles internos al cliente.

### Dominio y paquetes

- Funciones de cálculo independientes de reloj, red y almacenamiento; inyectar esas dependencias donde se necesiten.
- Dinero con representación y redondeo explícitos; unidades físicas definidas en contratos.
- Exportaciones públicas deliberadas; prohibir imports a internos de otro paquete.
- Prohibir que packages importe desde src de la aplicación. Compilar y probar cada workspace.
- Definir interfaces de datos donde la persistencia cruza el dominio; evitar una capa genérica de repositorios sin beneficio.

### Python e IA

- Dependencias bloqueadas, versión de Python explícita y una herramienta por función de calidad.
- Establecer lint/formato, tipos y pruebas en el servicio antes de migrar flujos críticos; seleccionar herramientas concretas al crear el servicio.
- FastAPI adapta HTTP; no contiene el motor del agente ni reglas comerciales dentro del endpoint.
- Una sesión de base de datos por unidad de trabajo; transacciones acotadas, sin mantenerlas abiertas esperando al modelo.
- No bloquear el event loop con cómputo pesado o clientes síncronos. Workers para tareas prolongadas, con estado durable e idempotencia.
- Registro permitido de herramientas, validación de argumentos, límites de pasos y costo; salidas del modelo son datos no confiables.
- Precio y disponibilidad provienen de catálogo; el modelo no es autoridad para aprobar operaciones ni modificar permisos.
- Identificar cada ejecución por request_id/trace_id, proveedor, modelo y versión de prompt; consumo real cuando esté disponible, estimaciones marcadas como tales.

### Interfaz

- Componentes orientados a responsabilidades del usuario; separar coordinación de estado y presentación cuando simplifique el flujo.
- No duplicar estado derivable. Separar estado remoto de estado efímero de interfaz.
- Modelar carga, vacío, error, éxito y operaciones concurrentes; evitar combinaciones imposibles de booleanos.
- Accesibilidad: elementos semánticos, teclado, foco visible y etiquetas. Reutilizar componentes existentes antes de crear variantes.
- Optimizar renders, memoización y tamaño del bundle solo con medición o un problema comprobable. Verificar que código de servidor y secretos no lleguen al cliente.

### Scripts y datos

- Scripts que alteran datos deben validar destino y argumentos, ofrecer previsualización cuando sea viable y ser reejecutables o explicar cómo recuperar una ejecución parcial.
- No ejecutar efectos al importar módulos compartidos. Separar entrada CLI de lógica reutilizable.
- Temporales y reportes derivados fuera del código fuente; datos versionados con procedencia y proceso de regeneración cuando aplique.
- No eliminar archivos por nombre o antigüedad sin comprobar referencias y propósito.

## Cómo convertir las reglas en controles reales

| Control | Implementación propuesta | Adopción |
| --- | --- | --- |
| Tipos | Comprobación de app y compilación de ambos workspaces; evaluar noUncheckedIndexedAccess por módulos | Primero línea base; resolver incompatibilidades sin casts masivos |
| Dependencias | ESLint no-restricted-imports con patrones por capa; ampliar para imports dinámicos y ciclos si se necesita | Bloquear infracciones nuevas |
| Contratos | Pruebas HTTP y de eventos; esquema compartido con cliente generado para Python | Antes de migrar consumidores |
| Calidad | Workflow de PR con lint, tipos, pruebas locales y build pertinente | Resolver fallos iniciales; hacer checks requeridos en la plataforma |
| Despliegue | Job dependiente de calidad para el mismo commit; verificar qué revisión despliega el script remoto | Antes de automatizar la transición |
| Datos | Pruebas con PostgreSQL desechable y migraciones verificadas | Antes de cambios de persistencia |
| Rendimiento | Escenarios representativos: latencia, consultas, memoria y costo IA | Umbrales después de medir |
| Excepciones | Registro con regla, alcance, motivo, responsable y condición/fecha de retirada | Sin excepciones globales silenciosas |

Un AGENTS.md orienta al agente; no sustituye CI ni protección de ramas. Los comandos nuevos se documentan como obligatorios solo después de crearlos y comprobarlos.

## Orden recomendado de saneamiento

1. Medir y ejecutar checks existentes. Clasificar deuda por riesgo; asegurar controles antes del despliegue.
2. Validar íntegramente chat y generación. Verificar comportamiento de autenticación en producción y autorización por recurso.
3. Extraer el caso de uso de generación con pruebas de caracterización. Conservar reglas comerciales, errores y contrato público.
4. Descomponer la página principal por flujos y propiedad del estado. Evitar dividirla en componentes que sigan compartiendo todas las dependencias.
5. Establecer límites de imports y responsabilidades de paquetes. Separar datos generados y lógica ejecutable.
6. Incorporar Python mediante una primera funcionalidad completa y compatible; ampliar únicamente con equivalencia demostrada.

No se ejecutaron suites ni benchmarks en esta revisión de instrucciones. Las cifras de tamaño describen el árbol local durante la revisión y pueden cambiar.

## Referencias técnicas

- TypeScript strict: https://www.typescriptlang.org/tsconfig/strict
- TypeScript noUncheckedIndexedAccess: https://www.typescriptlang.org/tsconfig/noUncheckedIndexedAccess.html
- ESLint no-restricted-imports y sus limitaciones: https://eslint.org/docs/latest/rules/no-restricted-imports
