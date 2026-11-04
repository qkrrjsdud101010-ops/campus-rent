[CmdletBinding()]
param(
    [string]$ConfigPath,
    [string]$DriverPath,
    [switch]$ValidateOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-JavaMajorVersion {
    param([string]$ExecutablePath, [string]$VersionArgument)

    $startInfo = New-Object Diagnostics.ProcessStartInfo
    $startInfo.FileName = $ExecutablePath
    $startInfo.Arguments = $VersionArgument
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $versionProcess = New-Object Diagnostics.Process
    $versionProcess.StartInfo = $startInfo
    try {
        if (-not $versionProcess.Start()) { throw 'Version check could not start.' }
        $versionText = $versionProcess.StandardOutput.ReadToEnd() + $versionProcess.StandardError.ReadToEnd()
        $versionProcess.WaitForExit()
        if ($versionProcess.ExitCode -ne 0) { throw 'Version check failed.' }
        $versionMatch = [regex]::Match($versionText, '(?:version\s+|javac\s+)"?(\d+)(?:\.(\d+))?')
        if (-not $versionMatch.Success) { throw 'Unrecognized Java version.' }
        $majorVersion = [int]$versionMatch.Groups[1].Value
        if ($majorVersion -eq 1) { $majorVersion = [int]$versionMatch.Groups[2].Value }
        return $majorVersion
    } finally {
        $versionProcess.Dispose()
    }
}

try {
    $workspaceRoot = Split-Path -Parent $PSScriptRoot
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
        [Console]::Error.WriteLine('Oracle JDBC jar is missing. Run tools/setup-oracle-jdbc.ps1 first, or set ORACLE_JDBC_JAR.')
        exit 2
    }

    $javaCommand = Get-Command java -CommandType Application -ErrorAction Stop | Select-Object -First 1
    $javacCommand = Get-Command javac -CommandType Application -ErrorAction Stop | Select-Object -First 1
    if ((Get-JavaMajorVersion $javaCommand.Source '-version') -lt 8 -or (Get-JavaMajorVersion $javacCommand.Source '-version') -lt 8) {
        [Console]::Error.WriteLine('Java and javac 8 or later are required. Configure the local JDK and retry.')
        exit 2
    }

    $classDirectory = Join-Path $workspaceRoot '.work/oracle-check'
    $sourcePath = Join-Path $PSScriptRoot 'OracleConnectionCheck.java'
    New-Item -ItemType Directory -Path $classDirectory -Force | Out-Null
    & $javacCommand.Source -encoding UTF-8 -source 8 -target 8 -d $classDirectory $sourcePath
    $compileExitCode = $LASTEXITCODE
    if ($compileExitCode -ne 0) { exit $compileExitCode }

    $classPath = $classDirectory + [IO.Path]::PathSeparator + $DriverPath
    $javaArguments = @('-cp', $classPath, 'OracleConnectionCheck', $ConfigPath)
    if ($ValidateOnly) { $javaArguments += '--validate-only' }
    # Pass only the config file path; DB URL, username and password stay out of argv.
    & $javaCommand.Source @javaArguments
    exit $LASTEXITCODE
} catch {
    [Console]::Error.WriteLine('Oracle connection launcher failed. Check the local JDK, JDBC setup and configuration file. Connection details were not printed.')
    exit 1
}
