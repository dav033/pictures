[CmdletBinding()]
param(
    [string]$NextBaseUrl = "http://127.0.0.1:3100",
    [string]$ExpectedBackend = "next",
    [string]$PasswordEnvironmentVariable = "APP_PASSWORD"
)

$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
    throw "NEXT_FLAG_CONTRACT_FAILED: $Message"
}

$password = [Environment]::GetEnvironmentVariable($PasswordEnvironmentVariable)
$cookies = [Net.CookieContainer]::new()
$handler = [Net.Http.HttpClientHandler]::new()
$handler.CookieContainer = $cookies
$handler.UseCookies = $true
$client = [Net.Http.HttpClient]::new($handler)
$client.Timeout = [TimeSpan]::FromSeconds(15)

try {
    if ([string]::IsNullOrWhiteSpace($password)) {
        Fail "falta la variable de contraseña local"
    }

    $loginContent = [Net.Http.StringContent]::new(
        (@{ password = $password } | ConvertTo-Json -Compress),
        [Text.Encoding]::UTF8,
        "application/json"
    )
    $login = $client.PostAsync(
        ($NextBaseUrl.TrimEnd("/") + "/api/login"),
        $loginContent
    ).GetAwaiter().GetResult()
    if ([int]$login.StatusCode -ne 200) {
        Fail "login status=$([int]$login.StatusCode)"
    }

    $body = (@{ message = "next-flag-contract" } | ConvertTo-Json -Compress)
    $content = [Net.Http.StringContent]::new($body, [Text.Encoding]::UTF8, "application/json")
    $response = $client.PostAsync(
        ($NextBaseUrl.TrimEnd("/") + "/api/internal/ai/echo"),
        $content
    ).GetAwaiter().GetResult()
    $responseBody = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()

    if ([int]$response.StatusCode -ne 200) {
        Fail "echo status=$([int]$response.StatusCode) body=$responseBody"
    }
    $parsed = $responseBody | ConvertFrom-Json
    if ($parsed.backend -ne $ExpectedBackend) {
        Fail "backend esperado=$ExpectedBackend actual=$($parsed.backend)"
    }

    Write-Output "NEXT FLAG CONTRACT PASS: backend=$($parsed.backend)"
} finally {
    $client.Dispose()
    $handler.Dispose()
}
