[CmdletBinding()]
param(
    [ValidateSet('build', 'test', 'run', 'package')]
    [string]$Task = 'run',
    [ValidateRange(1, 65535)]
    [int]$Port = 8081
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function ConvertTo-NativeArgument {
    param([string]$Argument)
    if ($Argument.Length -gt 0 -and $Argument -notmatch '[\s"]') { return $Argument }
    $quoted = [regex]::Replace($Argument, '(\\*)"', '$1$1\"')
    $quoted = [regex]::Replace($quoted, '(\\+)$', '$1$1')
    return '"' + $quoted + '"'
}

try {
    $workspaceRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
    $runtimePath = Join-Path $workspaceRoot '.work/runtime/server-runtime.json'
    if (-not (Test-Path -LiteralPath $runtimePath -PathType Leaf)) {
        [Console]::Error.WriteLine('Run tools/setup-server-runtime.ps1 before using the server tools.')
        exit 2
    }
    # This file contains tool paths only. The datasource configuration is never read here.
    $runtimeConfiguration = [IO.File]::ReadAllText($runtimePath) | ConvertFrom-Json
    $javaHome = [string]$runtimeConfiguration.JavaHome
    $mavenHome = [string]$runtimeConfiguration.MavenHome
    $javaExecutable = Join-Path $javaHome 'bin/java.exe'
    $classworlds = @(Get-ChildItem -LiteralPath (Join-Path $mavenHome 'boot') -Filter 'plexus-classworlds-*.jar' -File)
    if (-not (Test-Path -LiteralPath $javaExecutable -PathType Leaf) -or $classworlds.Count -ne 1 -or
        -not (Test-Path -LiteralPath (Join-Path $workspaceRoot 'pom.xml') -PathType Leaf)) {
        throw 'Runtime or Maven project is not ready.'
    }
    $mavenTask = switch ($Task) { 'build' { 'compile' } 'test' { 'test' } 'package' { 'package' } 'run' { 'spring-boot:run' } }
    $arguments = @(
        '-classpath', $classworlds[0].FullName,
        ('-Dclassworlds.conf=' + (Join-Path $mavenHome 'bin/m2.conf')),
        ('-Dmaven.home=' + $mavenHome),
        ('-Dmaven.multiModuleProjectDirectory=' + $workspaceRoot),
        'org.codehaus.plexus.classworlds.launcher.Launcher',
        '--batch-mode', '--no-transfer-progress',
        ('-Dmaven.repo.local=' + (Join-Path $workspaceRoot '.work/m2')),
        $mavenTask
    )
    $startInfo = New-Object Diagnostics.ProcessStartInfo
    $startInfo.FileName = $javaExecutable
    $startInfo.Arguments = (($arguments | ForEach-Object { ConvertTo-NativeArgument $_ }) -join ' ')
    $startInfo.WorkingDirectory = $workspaceRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.EnvironmentVariables['JAVA_HOME'] = $javaHome
    $startInfo.EnvironmentVariables['MAVEN_HOME'] = $mavenHome
    $startInfo.EnvironmentVariables['PATH'] = (Join-Path $javaHome 'bin') + ';' + (Join-Path $mavenHome 'bin') + ';' + $env:PATH
    if ($Task -eq 'run') {
        $startInfo.EnvironmentVariables['DEBUG'] = 'false'
        $startInfo.EnvironmentVariables['SPRING_PROFILES_ACTIVE'] = 'local'
        $startInfo.EnvironmentVariables['SERVER_ADDRESS'] = '127.0.0.1'
        $startInfo.EnvironmentVariables['SERVER_PORT'] = [string]$Port
    }
    $serverProcess = New-Object Diagnostics.Process
    $serverProcess.StartInfo = $startInfo
    try {
        if (-not $serverProcess.Start()) { throw 'Maven could not start.' }
        $stdoutCopy = $serverProcess.StandardOutput.BaseStream.CopyToAsync([Console]::OpenStandardOutput())
        $stderrCopy = $serverProcess.StandardError.BaseStream.CopyToAsync([Console]::OpenStandardError())
        $serverProcess.WaitForExit()
        [Threading.Tasks.Task]::WaitAll(@($stdoutCopy, $stderrCopy))
        exit $serverProcess.ExitCode
    } finally { $serverProcess.Dispose() }
} catch {
    [Console]::Error.WriteLine('Server task failed. Check the prepared runtime, project build output and local settings. Tooling does not print datasource values.')
    exit 2
}
