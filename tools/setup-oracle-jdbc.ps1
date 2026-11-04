[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Oracle publishes this artifact on Maven Central; its POM includes the license.
# No DB connection information is accepted by this download helper.
$artifactUri = 'https://repo.maven.apache.org/maven2/com/oracle/database/jdbc/ojdbc6/11.2.0.4/ojdbc6-11.2.0.4.jar'
$workspaceRoot = Split-Path -Parent $PSScriptRoot
$driverDirectory = Join-Path $workspaceRoot '.work/jdbc'
$driverPath = Join-Path $driverDirectory 'ojdbc6-11.2.0.4.jar'
$downloadPath = $null
$previousSecurityProtocol = [Net.ServicePointManager]::SecurityProtocol

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    New-Item -ItemType Directory -Path $driverDirectory -Force | Out-Null

    # Compare with the publisher's checksum over HTTPS. Missing/invalid checksums fail closed.
    $checksumResponse = Invoke-WebRequest -Uri ($artifactUri + '.sha1') -UseBasicParsing -TimeoutSec 60
    $checksumText = if ($checksumResponse.Content -is [byte[]]) {
        [Text.Encoding]::ASCII.GetString($checksumResponse.Content)
    } else {
        [string]$checksumResponse.Content
    }
    $publishedHash = ($checksumText.Trim() -split '\s+')[0].ToUpperInvariant()
    if ($publishedHash -notmatch '^[0-9A-F]{40}$') {
        throw 'Invalid published checksum.'
    }

    if (Test-Path -LiteralPath $driverPath -PathType Leaf) {
        $existingHash = (Get-FileHash -LiteralPath $driverPath -Algorithm SHA1).Hash
        if ($existingHash -eq $publishedHash) {
            Write-Output 'Oracle JDBC 11.2.0.4 already present; published checksum verified.'
            exit 0
        }
    }

    $downloadPath = Join-Path $driverDirectory ('ojdbc6-' + [Guid]::NewGuid().ToString('N') + '.download')
    Invoke-WebRequest -Uri $artifactUri -UseBasicParsing -TimeoutSec 120 -OutFile $downloadPath
    $downloadHash = (Get-FileHash -LiteralPath $downloadPath -Algorithm SHA1).Hash
    if ($downloadHash -ne $publishedHash) {
        throw 'Downloaded checksum mismatch.'
    }

    # Both paths are fixed/generated inside .work/jdbc, on the same filesystem.
    if (Test-Path -LiteralPath $driverPath -PathType Leaf) {
        [IO.File]::Replace($downloadPath, $driverPath, $null)
    } else {
        [IO.File]::Move($downloadPath, $driverPath)
    }
    $downloadPath = $null
    Write-Output 'Oracle JDBC 11.2.0.4 downloaded to .work/jdbc; published checksum verified.'
} catch {
    [Console]::Error.WriteLine('Oracle JDBC setup failed. Check Maven Central access and retry tools/setup-oracle-jdbc.ps1. No DB connection was attempted.')
    exit 1
} finally {
    [Net.ServicePointManager]::SecurityProtocol = $previousSecurityProtocol
    if ($downloadPath -and (Test-Path -LiteralPath $downloadPath -PathType Leaf)) {
        Remove-Item -LiteralPath $downloadPath -Force -ErrorAction SilentlyContinue
    }
}
