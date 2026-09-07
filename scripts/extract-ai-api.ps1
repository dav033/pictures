[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Source = (Join-Path $PSScriptRoot "..\services\ai-api"),
    [string]$Destination,
    [switch]$Extract,
    [switch]$Authorized
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$sourcePath = [IO.Path]::GetFullPath($Source)
$siblingCandidate = Join-Path (Split-Path -Parent $repoRoot) "demo-decoracion-api"

function Fail([string]$Message) {
    throw "EXTRACTION_BLOCKED: $Message"
}

function Assert-Exists([string]$Path, [string]$Label) {
    if (-not (Test-Path -LiteralPath $Path)) {
        Fail "$Label no existe: $Path"
    }
}

function Is-PathInside([string]$Child, [string]$Parent) {
    $childFull = [IO.Path]::GetFullPath($Child).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $parentFull = [IO.Path]::GetFullPath($Parent).TrimEnd([IO.Path]::DirectorySeparatorChar)
    return $childFull.Equals($parentFull, [StringComparison]::OrdinalIgnoreCase) -or
        $childFull.StartsWith($parentFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
}

function Copy-Tree([string]$From, [string]$To) {
    $files = Get-ChildItem -LiteralPath $From -File -Recurse |
        Where-Object {
            $_.FullName -notmatch "[\\/](__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|\.venv|\.git|decoracion_ai_api\.egg-info)[\\/]" -and
            $_.Name -notmatch "^\.env(?:\..*)?$" -and
            $_.Extension -notin @(".pem", ".key", ".p12", ".pfx", ".db", ".sqlite", ".sqlite3")
        }

    foreach ($file in $files) {
        $relative = [IO.Path]::GetRelativePath($From, $file.FullName)
        $target = Join-Path $To $relative
        $targetDir = Split-Path -Parent $target
        if ($PSCmdlet.ShouldProcess($targetDir, "Crear directorio")) {
            New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
        }
        if ($PSCmdlet.ShouldProcess($target, "Copiar $relative")) {
            Copy-Item -LiteralPath $file.FullName -Destination $target
        }
    }

    return $files.Count
}

Assert-Exists $sourcePath "Fuente services/ai-api"
Assert-Exists (Join-Path $sourcePath "pyproject.toml") "pyproject.toml"
Assert-Exists (Join-Path $sourcePath "uv.lock") "uv.lock"
Assert-Exists (Join-Path $sourcePath "app\main.py") "app/main.py"
Assert-Exists (Join-Path $sourcePath "app\auth.py") "app/auth.py"
Assert-Exists (Join-Path $sourcePath "scripts\generate_models.py") "scripts/generate_models.py"
Assert-Exists (Join-Path $sourcePath "tests") "tests"
Assert-Exists (Join-Path $repoRoot "contracts\chat\v1") "contracts/chat/v1"
Assert-Exists (Join-Path $repoRoot "contracts\domain\v1") "contracts/domain/v1"

Write-Output "PREFLIGHT PASS: fuente=$sourcePath"
Write-Output "PREFLIGHT PASS: contratos=$repoRoot\contracts"
if (Test-Path -LiteralPath $siblingCandidate) {
    Write-Output "DESTINO CANDIDATO PRESENTE: $siblingCandidate"
} else {
    Write-Output "GATE EXTERNO: destino arquitectónico ausente; no se crea automáticamente: $siblingCandidate"
}
Write-Output "GATE EXTERNO: autorización de repositorio, secretos, despliegue y base remota no se infieren"

if (-not $Extract) {
    Write-Output "Modo preflight. Para extraer: -Destination <ruta autorizada> -Authorized -Extract"
    exit 0
}

if (-not $Authorized) {
    Fail "-Authorized es obligatorio; el script no inventa autorización del repo destino"
}
if ([string]::IsNullOrWhiteSpace($Destination)) {
    Fail "-Destination es obligatorio; no se usa el candidato hermano sin autorización explícita"
}

$destinationPath = [IO.Path]::GetFullPath($Destination)
if ($destinationPath.Equals($repoRoot, [StringComparison]::OrdinalIgnoreCase) -or
    $destinationPath.Equals($sourcePath, [StringComparison]::OrdinalIgnoreCase) -or
    (Is-PathInside $destinationPath $repoRoot)) {
    Fail "destino no puede ser workspace actual ni una ruta dentro de él: $destinationPath"
}
if (Test-Path -LiteralPath $destinationPath) {
    $existing = @(Get-ChildItem -LiteralPath $destinationPath -Force)
    if ($existing.Count -gt 0) {
        Fail "destino debe no existir o estar vacío; no se sobrescribe: $destinationPath"
    }
} elseif ($PSCmdlet.ShouldProcess($destinationPath, "Crear destino autorizado")) {
    New-Item -ItemType Directory -Path $destinationPath -Force | Out-Null
}

$targetService = Join-Path $destinationPath "services\ai-api"
$targetContracts = Join-Path $destinationPath "contracts"
$targetMigrations = Join-Path $destinationPath "migrations"
if ($PSCmdlet.ShouldProcess($targetService, "Crear layout services/ai-api")) {
    New-Item -ItemType Directory -Path $targetService -Force | Out-Null
}
if ($PSCmdlet.ShouldProcess($targetContracts, "Crear layout contracts")) {
    New-Item -ItemType Directory -Path $targetContracts -Force | Out-Null
}
if ($PSCmdlet.ShouldProcess($targetMigrations, "Crear layout migrations")) {
    New-Item -ItemType Directory -Path $targetMigrations -Force | Out-Null
}

$serviceFileCount = Copy-Tree $sourcePath $targetService
$contractFileCount = Copy-Tree (Join-Path $repoRoot "contracts") $targetContracts
$migrationSource = Join-Path $repoRoot "scripts\migrations\016_operational_idempotency.sql"
$migrationTarget = Join-Path $targetMigrations "016_operational_idempotency.sql"
$migrationFileCount = 0
if (Test-Path -LiteralPath $migrationSource) {
    if ($PSCmdlet.ShouldProcess($migrationTarget, "Copiar migración operacional")) {
        Copy-Item -LiteralPath $migrationSource -Destination $migrationTarget
    }
    $migrationFileCount = 1
}

$gitignorePath = Join-Path $destinationPath ".gitignore"
$gitignoreContent = @(
    ".venv/"
    "__pycache__/"
    ".pytest_cache/"
    ".mypy_cache/"
    ".ruff_cache/"
    ".env"
    ".env.*"
    "!.env.example"
    "*.db"
    "*.sqlite"
    "*.sqlite3"
    "*.pem"
    "*.key"
    "*.p12"
    "*.pfx"
    "*.egg-info/"
)
if ($PSCmdlet.ShouldProcess($gitignorePath, "Crear .gitignore del backend")) {
    $gitignoreContent | Set-Content -LiteralPath $gitignorePath -Encoding utf8NoBOM
}

$commit = "working-tree"
try {
    $resolvedCommit = & git -C $repoRoot rev-parse --verify HEAD 2>$null
    if ($LASTEXITCODE -eq 0 -and $resolvedCommit) {
        $commit = ($resolvedCommit | Select-Object -First 1).Trim()
    }
} catch {
    $commit = "working-tree"
}

$manifest = [ordered]@{
    schema = "ai-api-extraction.v1"
    source = "services/ai-api"
    contracts = "contracts"
    source_commit = $commit
    generated_at_utc = (Get-Date).ToUniversalTime().ToString("o")
    excluded = @(".git", ".venv", "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", "*.egg-info", ".env*", "*.pem", "*.key", "*.p12", "*.pfx", "*.db", "*.sqlite*")
    note = "Incluye solo el servicio, contratos y migración operacional; no incluye secretos ni autorización de despliegue. Revisar antes de publicar."
}
$manifestPath = Join-Path $destinationPath "extraction-manifest.json"
if ($PSCmdlet.ShouldProcess($manifestPath, "Escribir manifiesto sin secretos")) {
    $manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding utf8NoBOM
}

if ($WhatIfPreference) {
    Write-Output "EXTRACTION PLAN PASS: service_files=$serviceFileCount contract_files=$contractFileCount migration_files=$migrationFileCount"
} else {
    Write-Output "EXTRACTION PASS: service_files=$serviceFileCount contract_files=$contractFileCount migration_files=$migrationFileCount"
}
Write-Output "EXTRACTION DESTINATION: $destinationPath"
Write-Output "NEXT GATE: revisar manifiesto, fijar runtime, provisionar secreto por gestor autorizado y probar rollback antes de tráfico"
