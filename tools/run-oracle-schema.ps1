[CmdletBinding()]
param(
    [ValidateSet('review', 'install', 'verify', 'constraints', 'crud')]
    [string]$Mode = 'review',
    [string]$ConfigPath,
    [string]$DriverPath,
    [switch]$ParseOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

try {
    $workspaceRoot = Split-Path -Parent $PSScriptRoot
    $javaCommand = Get-Command java -CommandType Application -ErrorAction Stop | Select-Object -First 1
    $javacCommand = Get-Command javac -CommandType Application -ErrorAction Stop | Select-Object -First 1
    $classDirectory = Join-Path $workspaceRoot '.work/oracle-schema'
    New-Item -ItemType Directory -Path $classDirectory -Force | Out-Null
    & $javacCommand.Source -encoding UTF-8 -source 8 -target 8 -d $classDirectory (Join-Path $PSScriptRoot 'OracleConnectionCheck.java') (Join-Path $PSScriptRoot 'OracleSchemaTool.java')
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    if ($ParseOnly) {
        & $javaCommand.Source -cp $classDirectory OracleSchemaTool --parse-only $workspaceRoot
        exit $LASTEXITCODE
    }
    if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
        $ConfigPath = Join-Path $workspaceRoot 'src/main/resources/application-local.properties'
    } elseif (-not [IO.Path]::IsPathRooted($ConfigPath)) {
        $ConfigPath = Join-Path $workspaceRoot $ConfigPath
    }
    if ([string]::IsNullOrWhiteSpace($DriverPath)) { $DriverPath = $env:ORACLE_JDBC_JAR }
    if ([string]::IsNullOrWhiteSpace($DriverPath)) {
        $DriverPath = Join-Path $workspaceRoot '.work/jdbc/ojdbc6-11.2.0.4.jar'
    } elseif (-not [IO.Path]::IsPathRooted($DriverPath)) {
        $DriverPath = Join-Path $workspaceRoot $DriverPath
    }
    if (-not (Test-Path -LiteralPath $DriverPath -PathType Leaf)) {
        [Console]::Error.WriteLine('Oracle JDBC jar is missing. Run tools/setup-oracle-jdbc.ps1 first.')
        exit 2
    }
    $classPath = $classDirectory + [IO.Path]::PathSeparator + $DriverPath
    # Only a config path and fixed mode/root are passed; no credentials are in argv.
    & $javaCommand.Source -cp $classPath OracleSchemaTool $ConfigPath $Mode $workspaceRoot
    exit $LASTEXITCODE
} catch {
    [Console]::Error.WriteLine('Schema launcher failed. Check Java/javac 8+, fixed SQL sources and the local setup. Details are hidden.')
    exit 2
}
