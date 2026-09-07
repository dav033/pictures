[CmdletBinding()]
param(
    [string]$NextBaseUrl = "http://127.0.0.1:3100",
    [string]$PasswordEnvironmentVariable = "APP_PASSWORD",
    [int]$TimeoutSeconds = 10
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
    throw "NEXT_PYTHON_E2E_FAILED: $Message"
}

function Assert-Equal([object]$Actual, [object]$Expected, [string]$Label) {
    if ($Actual -ne $Expected) {
        Fail "$Label; esperado=$Expected actual=$Actual"
    }
}

if ($TimeoutSeconds -lt 1 -or $TimeoutSeconds -gt 60) {
    Fail "TimeoutSeconds debe estar entre 1 y 60"
}

Add-Type -AssemblyName System.Net.Http
$handler = [System.Net.Http.HttpClientHandler]::new()
$client = [System.Net.Http.HttpClient]::new($handler)
$client.Timeout = [TimeSpan]::FromSeconds($TimeoutSeconds)

function Invoke-Echo(
    [System.Net.Http.HttpClient]$HttpClient,
    [string]$Message,
    [string]$IdempotencyKey,
    [string]$DeadlineMs
) {
    $request = [System.Net.Http.HttpRequestMessage]::new(
        [System.Net.Http.HttpMethod]::Post,
        ($NextBaseUrl.TrimEnd("/") + "/api/internal/ai/echo")
    )
    try {
        $json = @{ message = $Message } | ConvertTo-Json -Compress
        $request.Content = [System.Net.Http.StringContent]::new(
            $json,
            [Text.Encoding]::UTF8,
            "application/json"
        )
        $request.Headers.Add("idempotency-key", $IdempotencyKey)
        if ($DeadlineMs) {
            $request.Headers.Add("x-deadline-ms", $DeadlineMs)
        }
        $response = $HttpClient.SendAsync($request).GetAwaiter().GetResult()
        return [pscustomobject]@{
            Status = [int]$response.StatusCode
            Body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            Replayed = $response.Headers.Contains("X-Idempotency-Result")
        }
    } finally {
        $request.Dispose()
    }
}

try {
    $password = [Environment]::GetEnvironmentVariable($PasswordEnvironmentVariable)
    if (-not [string]::IsNullOrWhiteSpace($password)) {
        $loginJson = @{ password = $password } | ConvertTo-Json -Compress
        $loginContent = [System.Net.Http.StringContent]::new(
            $loginJson,
            [Text.Encoding]::UTF8,
            "application/json"
        )
        $login = $client.PostAsync(
            ($NextBaseUrl.TrimEnd("/") + "/api/login"),
            $loginContent
        ).GetAwaiter().GetResult()
        Assert-Equal ([int]$login.StatusCode) 200 "login local"
    }

    $first = Invoke-Echo $client "contract-e2e" "next-python-e2e" $null
    Assert-Equal $first.Status 200 "primera llamada Python"
    if ($first.Body -notmatch '"backend":"python"') {
        Fail "la respuesta no confirma backend Python"
    }

    $replay = Invoke-Echo $client "contract-e2e" "next-python-e2e" $null
    Assert-Equal $replay.Status 200 "replay idempotente"
    if (-not $replay.Replayed) {
        Fail "falta header X-Idempotency-Result: replay"
    }

    $conflict = Invoke-Echo $client "cuerpo-distinto" "next-python-e2e" $null
    Assert-Equal $conflict.Status 409 "conflicto idempotente"
    if ($conflict.Body -notmatch '"code":"PYTHON_IDEMPOTENCY_CONFLICT"') {
        Fail "codigo de conflicto inesperado"
    }

    $timeout = Invoke-Echo $client "deadline" "next-python-timeout" "1"
    if ($timeout.Status -notin @(408, 504)) {
        Fail "timeout; esperado=408/504 actual=$($timeout.Status)"
    }

    Write-Output "NEXT-PYTHON CONTRACT E2E PASS: first=200 replay=200 conflict=409 timeout=$($timeout.Status)"
} finally {
    $client.Dispose()
    $handler.Dispose()
}
