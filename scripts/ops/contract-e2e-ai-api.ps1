[CmdletBinding()]
param(
    [string]$BaseUrl = "http://127.0.0.1:8000",
    [string]$SecretEnvironmentVariable = "INTERNAL_HMAC_SECRET",
    [int]$TimeoutSeconds = 5,
    [switch]$SkipReady
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
    throw "CONTRACT_E2E_FAILED: $Message"
}

function Assert-Equal([object]$Actual, [object]$Expected, [string]$Label) {
    if ($Actual -ne $Expected) {
        Fail "$Label; esperado=$Expected actual=$Actual"
    }
}

function ConvertTo-Hex([byte[]]$Bytes) {
    return [Convert]::ToHexString($Bytes).ToLowerInvariant()
}

function Get-Sha256([byte[]]$Bytes) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        return ConvertTo-Hex ($sha.ComputeHash($Bytes))
    } finally {
        $sha.Dispose()
    }
}

function New-Signature(
    [string]$Secret,
    [string]$Method,
    [string]$Path,
    [long]$Timestamp,
    [Guid]$Nonce,
    [string[]]$Scopes,
    [byte[]]$Body
) {
    $scopeValue = (($Scopes | Sort-Object) -join ",")
    $canonical = "{0}.{1}.{2}.{3}.{4}.{5}" -f `
        $Timestamp, $Nonce, $Method.ToUpperInvariant(), $Path, (Get-Sha256 $Body), $scopeValue
    $hmac = [Security.Cryptography.HMACSHA256]::new([Text.Encoding]::UTF8.GetBytes($Secret))
    try {
        return ConvertTo-Hex ($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($canonical)))
    } finally {
        $hmac.Dispose()
    }
}

function Invoke-Api(
    [System.Net.Http.HttpClient]$Client,
    [string]$Method,
    [string]$Url,
    [byte[]]$Body,
    [hashtable]$Headers
) {
    $request = [System.Net.Http.HttpRequestMessage]::new(
        [System.Net.Http.HttpMethod]::new($Method),
        $Url
    )
    try {
        if ($null -ne $Body) {
            $request.Content = [System.Net.Http.ByteArrayContent]::new($Body)
            $request.Content.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::new("application/json")
        }
        foreach ($entry in $Headers.GetEnumerator()) {
            $null = $request.Headers.TryAddWithoutValidation($entry.Key, [string]$entry.Value)
        }
        $response = $Client.SendAsync($request).GetAwaiter().GetResult()
        $responseBody = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        return [pscustomobject]@{
            StatusCode = [int]$response.StatusCode
            Body = $responseBody
        }
    } finally {
        $request.Dispose()
    }
}

function New-Request([string]$Secret, [string]$Base, [long]$Timestamp, [Guid]$Nonce, [byte[]]$Body) {
    $path = "/internal/v1/echo"
    $scopes = @("ai.echo")
    $signature = New-Signature $Secret "POST" $path $Timestamp $Nonce $scopes $Body
    return @{
        Url = ($Base.TrimEnd("/") + $path)
        Body = $Body
        Headers = @{
            "x-internal-schema-version" = "operational.v1"
            "x-internal-timestamp" = [string]$Timestamp
            "x-internal-nonce" = [string]$Nonce
            "x-internal-scopes" = ($scopes -join ",")
            "x-internal-signature" = $signature
        }
    }
}

if ($TimeoutSeconds -lt 1 -or $TimeoutSeconds -gt 60) {
    Fail "TimeoutSeconds debe estar entre 1 y 60"
}
$secret = [Environment]::GetEnvironmentVariable($SecretEnvironmentVariable)
if ([string]::IsNullOrWhiteSpace($secret) -or $secret.Length -lt 32) {
    Fail "$SecretEnvironmentVariable ausente o menor de 32 bytes; no se genera secreto"
}

$client = [System.Net.Http.HttpClient]::new()
$client.Timeout = [TimeSpan]::FromSeconds($TimeoutSeconds)
try {
    $health = Invoke-Api $client "GET" ($BaseUrl.TrimEnd("/") + "/healthz") $null @{}
    Assert-Equal $health.StatusCode 200 "healthz"
    Write-Output "PASS healthz"

    if (-not $SkipReady) {
        $ready = Invoke-Api $client "GET" ($BaseUrl.TrimEnd("/") + "/readyz") $null @{}
        Assert-Equal $ready.StatusCode 200 "readyz"
        Write-Output "PASS readyz"
    }

    $payload = [ordered]@{
        context = [ordered]@{
            schema_version = "operational.v1"
            request_id = ([Guid]::NewGuid()).ToString()
            correlation_id = ([Guid]::NewGuid()).ToString()
            deadline_at = (Get-Date).ToUniversalTime().AddMinutes(5).ToString("o")
            deadline_ms = 5000
            body_sha256 = ("0" * 64)
            scopes = @("ai.echo")
            idempotency_key = ("e2e-" + [Guid]::NewGuid().ToString("N"))
        }
        payload = @{ message = "contract-e2e" }
    }
    $operationBody = [ordered]@{ message = "contract-e2e" }
    $operationBytes = [Text.Encoding]::UTF8.GetBytes(($operationBody | ConvertTo-Json -Depth 8 -Compress))
    $payload.context.body_sha256 = Get-Sha256 $operationBytes
    $body = [Text.Encoding]::UTF8.GetBytes(($payload | ConvertTo-Json -Depth 8 -Compress))
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $nonce = [Guid]::NewGuid()
    $valid = New-Request $secret $BaseUrl $now $nonce $body
    $success = Invoke-Api $client "POST" $valid.Url $valid.Body $valid.Headers
    Assert-Equal $success.StatusCode 200 "request autenticada"
    Write-Output "PASS authenticated request"

    $replay = Invoke-Api $client "POST" $valid.Url $valid.Body $valid.Headers
    Assert-Equal $replay.StatusCode 401 "nonce repetido"
    Write-Output "PASS repeated nonce rejected"

    $tampered = [Text.Encoding]::UTF8.GetBytes(($payload | ConvertTo-Json -Depth 8 -Compress).Replace("contract-e2e", "tampered"))
    $tamperedResponse = Invoke-Api $client "POST" $valid.Url $tampered $valid.Headers
    Assert-Equal $tamperedResponse.StatusCode 401 "body hash alterado"
    Write-Output "PASS body tampering rejected"

    $badNonce = [Guid]::NewGuid()
    $bad = New-Request $secret $BaseUrl $now $badNonce $body
    $bad.Headers["x-internal-signature"] = ("0" * 64)
    $badResponse = Invoke-Api $client "POST" $bad.Url $bad.Body $bad.Headers
    Assert-Equal $badResponse.StatusCode 401 "firma alterada"
    Write-Output "PASS invalid signature rejected"

    $stale = New-Request $secret $BaseUrl ($now - 301) ([Guid]::NewGuid()) $body
    $staleResponse = Invoke-Api $client "POST" $stale.Url $stale.Body $stale.Headers
    Assert-Equal $staleResponse.StatusCode 401 "firma vencida"
    Write-Output "PASS stale signature rejected"
} finally {
    $client.Dispose()
}

Write-Output "CONTRACT E2E PASS: frontera interna Python comprobada; no prueba Next, flags, store PostgreSQL, timeout físico ni cancelación física"
