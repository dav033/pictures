<#
.SYNOPSIS
  Caption decoration training photos using Claude Code (vision) + the local RAG catalog,
  so colors/sizes in the caption are grounded in real Sempertex products instead of guessed.

.DESCRIPTION
  For each image in -Folder, this script asks a headless Claude Code subprocess to:
    1. Read the image and identify structure type + visible balloon colors.
    2. Flag photos that mix several balloon sizes in the same frame (relevant to the
       "proporcion relativa" training goal from docs/data/PLAN-ENTRENAMIENTO-SEMPERTEX-v002.md §2.7).
    3. Confirm each color against the real catalog via the app's own RAG search endpoint
       (/api/plan-editar, modo "buscar") using curl, instead of inventing color names.
    4. Write an English caption in the same style as data/captions/dataset-v001.jsonl.

  Images are processed in batches (default 6) to amortize Claude's fixed per-call overhead.
  By default, only the FIRST batch runs, so you can see the real cost before committing to
  the whole folder -- pass -All to process everything in one go.

.PREREQUISITES
  - `npm run dev` running locally on http://localhost:3000 (reads/writes against your real
    Postgres catalog and .env.local keys).
  - The Claude Code CLI (`claude`) on PATH.
  - Your own settings must allow `--permission-mode bypassPermissions` for the `claude`
    invocation this script makes as a subprocess (this script runs it directly, not through
    an interactive Claude Code session, so the harness's auto-mode classifier does not apply
    here -- but if you run this FROM an interactive Claude Code session's Bash tool, that
    session's classifier may still block it; run this script from a normal terminal instead).

.PARAMETER Folder
  Directory containing the images for one theme (e.g. BASE, halloween, boda...).

.PARAMETER Theme
  Theme label to store alongside each caption (e.g. "BASE", "halloween").

.PARAMETER BatchSize
  How many images to send to Claude per invocation. Default 6.

.PARAMETER All
  Process every batch. Without this flag, only the first batch runs (so you can check the
  real cost first).

.PARAMETER TriggerToken
  Trigger word to prefix each caption with. Defaults to the existing "eventdecor_style_v1"
  (the v001 trial LoRA's trigger) -- confirm with the team whether the v002 base LoRA should
  reuse this or get its own before training for real.

.PARAMETER OutFile
  JSONL file captions get appended to.

.EXAMPLE
  .\scripts\caption-with-claude.ps1 -Folder "C:\Users\davidt\Downloads\SEMPERTEX-TRAINING (2)\SEMPERTEX-TRAINING\BASE" -Theme BASE
  # Runs one batch, prints the real cost, stops.

.EXAMPLE
  .\scripts\caption-with-claude.ps1 -Folder "...\BASE" -Theme BASE -All -BatchSize 8
  # Processes the whole folder.
#>
param(
  [Parameter(Mandatory = $true)][string]$Folder,
  [Parameter(Mandatory = $true)][string]$Theme,
  [int]$BatchSize = 6,
  [switch]$All,
  [string]$TriggerToken = "eventdecor_style_v1",
  [string]$RepoRoot = "C:\Users\davidt\Downloads\demo-decoracion",
  [string]$OutFile = "",
  [string]$ServerUrl = "http://localhost:3000"
)

$ErrorActionPreference = "Stop"

# Correctly escapes one argument per the Windows CRT command-line quoting rules,
# so it survives being embedded in ProcessStartInfo.Arguments (a single string)
# even when it contains double quotes/newlines/backslashes -- needed because
# ProcessStartInfo.ArgumentList (which avoids this entirely) does not exist on
# Windows PowerShell 5.1 / .NET Framework, only on PowerShell 7+ / .NET Core.
function ConvertTo-WindowsArg([string]$Arg) {
  if ($Arg -eq "") { return '""' }
  if ($Arg -notmatch '[\s"]') { return $Arg }
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append('"')
  $backslashes = 0
  foreach ($ch in $Arg.ToCharArray()) {
    if ($ch -eq '\') {
      $backslashes++
    } elseif ($ch -eq '"') {
      [void]$sb.Append('\' * (($backslashes * 2) + 1))
      [void]$sb.Append('"')
      $backslashes = 0
    } else {
      if ($backslashes -gt 0) { [void]$sb.Append('\' * $backslashes); $backslashes = 0 }
      [void]$sb.Append($ch)
    }
  }
  if ($backslashes -gt 0) { [void]$sb.Append('\' * ($backslashes * 2)) }
  [void]$sb.Append('"')
  return $sb.ToString()
}

if ([string]::IsNullOrWhiteSpace($OutFile)) {
  $OutFile = Join-Path $RepoRoot "data\captions\dataset-v002-claude.jsonl"
}

if (-not (Test-Path $Folder)) {
  Write-Error "Folder not found: $Folder"
  exit 1
}

# --- 1. Log into the local dev server and get a cookie jar curl (inside the Claude
#        subprocess) can reuse for RAG lookups. ---
$envLocalPath = Join-Path $RepoRoot ".env.local"
if (-not (Test-Path $envLocalPath)) {
  Write-Error "Missing $envLocalPath -- can't read APP_PASSWORD."
  exit 1
}
$pwLine = Get-Content $envLocalPath | Where-Object { $_ -match '^APP_PASSWORD=' } | Select-Object -First 1
if (-not $pwLine) {
  Write-Error "APP_PASSWORD not set in .env.local."
  exit 1
}
$pw = ($pwLine -split '=', 2)[1]
$cookieJar = Join-Path $env:TEMP "caption-with-claude-cookies.txt"
if (Test-Path $cookieJar) { Remove-Item $cookieJar -Force }

$loginJson = (@{ password = $pw } | ConvertTo-Json -Compress)
& curl.exe -s -c $cookieJar -X POST "$ServerUrl/api/login" -H "Content-Type: application/json" -d $loginJson | Out-Null
if (-not (Test-Path $cookieJar)) {
  Write-Error "Login failed -- is 'npm run dev' running on $ServerUrl ?"
  exit 1
}
Write-Output "Logged in, cookie jar: $cookieJar"

# --- 2. List images (skip .source.json sidecars) ---
$images = Get-ChildItem -Path $Folder -File | Where-Object { $_.Extension -match '^\.(jpg|jpeg|png|webp)$' }
if ($images.Count -eq 0) {
  Write-Error "No images found in $Folder"
  exit 1
}
Write-Output "Found $($images.Count) images in $Folder"

# --- 3. JSON Schema for structured output ---
$schemaObj = @{
  type       = "object"
  properties = @{
    resultados = @{
      type  = "array"
      items = @{
        type       = "object"
        properties = @{
          id                                = @{ type = "string" }
          tipo_estructura                   = @{ type = "string" }
          acabado_detectado                 = @{ type = "string" }
          paleta_mix_match                  = @{ type = "string" }
          colores_detectados                = @{ type = "array"; items = @{ type = "string" } }
          proporcion_relativa_presente      = @{ type = "boolean" }
          proporcion_relativa_descripcion   = @{ type = "string" }
          colores_confirmados               = @{
            type  = "array"
            items = @{
              type       = "object"
              properties = @{
                color           = @{ type = "string" }
                titulo_producto = @{ type = "string" }
                codigo_tamano   = @{ type = "string" }
                aproximado      = @{ type = "boolean" }
              }
              required   = @("color", "titulo_producto", "aproximado")
            }
          }
          caption                           = @{ type = "string" }
        }
        required   = @("id", "tipo_estructura", "colores_detectados", "caption")
      }
    }
  }
  required   = @("resultados")
}
$schema = $schemaObj | ConvertTo-Json -Depth 10 -Compress

# --- 4. Batch + process ---
$batches = New-Object System.Collections.Generic.List[object]
for ($i = 0; $i -lt $images.Count; $i += $BatchSize) {
  $end = [Math]::Min($i + $BatchSize - 1, $images.Count - 1)
  $batches.Add(@($images[$i..$end]))
}

$totalCost = 0.0
$processed = 0

foreach ($batch in $batches) {
  $imageList = ($batch | ForEach-Object { "- id=`"$($_.BaseName)`" path=`"$($_.FullName)`"" }) -join "`n"

  $prompt = @"
Vas a describir $($batch.Count) fotos reales de decoraciones con globos Sempertex para un dataset de entrenamiento de un LoRA de estilo. Para cada imagen listada abajo:

1. Usa la herramienta Read para abrir la imagen en su ruta exacta.
2. Identifica: tipo de estructura (arco, semiarco, guirnalda, columna, pared, bouquet, centro_mesa, otro) y la lista de colores de globo visibles.
3. Identifica el acabado si se distingue claramente en la foto (Fashion=mate solido, Reflex=cristal transparente brillante, Silk=satinado, Deluxe, Metalizado=cromado espejo). Si no se puede distinguir con confianza, usa "no determinable" -- no adivines.
4. Compara la paleta de colores contra estas 6 paletas Mix & Match reales de Sempertex; si la foto combina tonos que calzan claramente con una de ellas, pon su nombre exacto en paleta_mix_match, si no, deja el campo vacio (no fuerces un match):
   - Ombre chocolate: Fashion Mocha, Fashion Latte, Fashion Chocolate, Fashion Coffee
   - Ombre lila: Satin Lilac, Pastel Matte Lilac, Silk Light Amethyst, Pastel Dusk Lavender
   - Rosa romantico: Bright Hearts, Silk Pink Blossom, Pastel Matte Melon, Fashion Pink, Pastel Matte Pink
   - Nude y burdeos: Silk Oyster White, Pastel Matte Nude, Reflex Crystal Red, Pastel Matte Melon, Fashion Merlot
   - Dorado y salvia: Silk Gold Dust, Pastel Dusk Lavender, Fashion White Sand, Silk Oyster White, Pastel Dusk Blue
   - Aguamarina y lila: Fashion Aquamarine, Fashion Periwinkle Blue, Fashion Pink, Fashion Lilac, Pastel Matte Lilac
5. Si la foto muestra VARIOS TAMAÑOS de globo mezclados en el mismo cuadro (ej. guirnalda organica con globos grandes y chicos juntos), marca proporcion_relativa_presente=true y describe la comparacion (ej. "globo pequeno al frente, globo grande detras, aproximadamente el doble de diametro") en vez de listar tamanos por separado. Si no aplica, marca false y deja la descripcion vacia.
6. Por cada color detectado, confirma contra el catalogo real corriendo con la herramienta Bash:
   curl -s -b "$cookieJar" -X POST $ServerUrl/api/plan-editar -H "Content-Type: application/json" -d "{`"modo`":`"buscar`",`"consulta`":`"globo <color> redondo`"}"
   - Si hay match exacto de ese color, usa el color y codigo_tamano de variantes[0] y pon aproximado=false.
   - Si NO hay match exacto, prueba una segunda consulta mas amplia (solo el nombre del color, sin "redondo", o un tono vecino) para encontrar el color REAL mas cercano que exista en el catalogo. Si encuentras uno, incluyelo con aproximado=true.
   - Solo omite el color de colores_confirmados si ninguna consulta razonable devuelve algo remotamente parecido -- no inventes nombres de producto que no vinieron de una respuesta real del RAG.
7. Escribe un caption en ingles, estilo: "$TriggerToken, commercial event-decoration photograph of ...". El caption describe todo excepto el trigger token: composicion, colores confirmados, acabado, iluminacion, estructura. Los colores con aproximado=true deben mencionarse explicitamente como aproximacion (ej. "a shade closest to Sempertex's Fashion Aquamarine, though not an exact catalog match"), nunca como si fueran el color exacto confirmado. Si proporcion_relativa_presente es true, incluye la comparacion de tamanos en el caption. Si paleta_mix_match tiene valor, mencionala por su nombre.

Imagenes de este lote:
$imageList

Responde unicamente con JSON valido segun el schema dado, un objeto por imagen usando su "id" tal cual se listo arriba, en el mismo orden.
"@

  Write-Output "--- Batch ($($batch.Count) img): $($batch.Name -join ', ') ---"

  $claudeArgs = @(
    "-p", $prompt,
    "--model", "sonnet",
    "--output-format", "json",
    "--json-schema", $schema,
    "--allowedTools", "Read", "Bash(curl *)",
    "--permission-mode", "bypassPermissions",
    "--no-session-persistence"
  )

  # Invoke via System.Diagnostics.Process with a manually-escaped Arguments string
  # (not "& claude @claudeArgs", and not ProcessStartInfo.ArgumentList, which does
  # not exist on Windows PowerShell 5.1 / .NET Framework) so the embedded double
  # quotes inside $prompt/$schema survive intact and --json-schema still gets valid JSON.
  $claudeExe = (Get-Command claude -CommandType Application -ErrorAction Stop).Source
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $claudeExe
  $psi.Arguments = ($claudeArgs | ForEach-Object { ConvertTo-WindowsArg $_ }) -join ' '
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true

  $proc = [System.Diagnostics.Process]::Start($psi)
  $stdout = $proc.StandardOutput.ReadToEnd()
  $stderr = $proc.StandardError.ReadToEnd()
  $proc.WaitForExit()
  $raw = if ($stdout) { $stdout } else { $stderr }

  try {
    $envelope = $raw | ConvertFrom-Json
  } catch {
    Write-Warning "Could not parse claude output as JSON. Raw output:"
    Write-Output $raw
    if ($stderr) { Write-Output "--- stderr ---"; Write-Output $stderr }
    continue
  }

  if ($envelope.is_error) {
    Write-Warning "Batch failed: $($envelope.result)"
    continue
  }

  $cost = [double]$envelope.total_cost_usd
  $totalCost += $cost

  $parsed = $envelope.result | ConvertFrom-Json
  foreach ($item in $parsed.resultados) {
    $match = $batch | Where-Object { $_.BaseName -eq $item.id } | Select-Object -First 1
    $entry = [ordered]@{
      id                               = $item.id
      file                             = if ($match) { $match.Name } else { $null }
      theme                            = $Theme
      trigger_token                    = $TriggerToken
      tipo_estructura                  = $item.tipo_estructura
      acabado_detectado                = $item.acabado_detectado
      paleta_mix_match                 = $item.paleta_mix_match
      colores_detectados               = $item.colores_detectados
      proporcion_relativa_presente     = $item.proporcion_relativa_presente
      proporcion_relativa_descripcion  = $item.proporcion_relativa_descripcion
      colores_confirmados              = $item.colores_confirmados
      caption                          = $item.caption
      caption_status                   = "draft_visual_review"
      source                           = "claude-code-vision+rag"
    }
    ($entry | ConvertTo-Json -Depth 10 -Compress) | Add-Content -Path $OutFile -Encoding utf8
  }

  $processed += $batch.Count
  Write-Output ("Procesadas: {0}/{1} | Costo este lote: `${2} | Costo acumulado: `${3}" -f $processed, $images.Count, [Math]::Round($cost, 4), [Math]::Round($totalCost, 4))

  if (-not $All) {
    Write-Output ""
    Write-Output "Modo prueba: solo corri el primer lote. Corre de nuevo con -All para procesar el resto."
    break
  }
}

Write-Output ""
Write-Output ("Listo. Imagenes procesadas: {0}/{1}. Costo total: `${2}. Guardado en: {3}" -f $processed, $images.Count, [Math]::Round($totalCost, 4), $OutFile)
