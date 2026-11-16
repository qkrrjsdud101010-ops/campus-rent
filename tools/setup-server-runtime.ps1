[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$workspaceRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$runtimeRoot = Join-Path $workspaceRoot '.work/runtime'
$previousProtocol = [Net.ServicePointManager]::SecurityProtocol
$extractPaths = New-Object 'System.Collections.Generic.List[string]'

function Assert-RuntimePath {
    param([string]$Candidate)
    $absolute = [IO.Path]::GetFullPath($Candidate)
    $prefix = [IO.Path]::GetFullPath($runtimeRoot).TrimEnd('\') + '\'
    if (-not $absolute.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Runtime path is outside the intended workspace directory.'
    }
    return $absolute
}

function Get-JavaMajor {
    param([string]$JdkHome)
    $releasePath = Join-Path $JdkHome 'release'
    if (-not (Test-Path -LiteralPath (Join-Path $JdkHome 'bin/java.exe') -PathType Leaf) -or
        -not (Test-Path -LiteralPath (Join-Path $JdkHome 'bin/javac.exe') -PathType Leaf) -or
        -not (Test-Path -LiteralPath $releasePath -PathType Leaf)) { return 0 }
    $releaseText = [IO.File]::ReadAllText($releasePath)
    $versionMatch = [regex]::Match($releaseText, '(?m)^JAVA_VERSION="(\d+)')
    if (-not $versionMatch.Success) { return 0 }
    return [int]$versionMatch.Groups[1].Value
}

function Get-VerifiedArchive {
    param([string]$Name, [string]$Uri, [string]$ChecksumUri, [string]$Algorithm, [string]$PinnedChecksum)
    Write-Host ('Checking official runtime checksum: ' + $Name)
    $checksumResponse = Invoke-WebRequest -Uri $ChecksumUri -UseBasicParsing -TimeoutSec 60
    $checksumText = if ($checksumResponse.Content -is [byte[]]) { [Text.Encoding]::ASCII.GetString($checksumResponse.Content) } else { [string]$checksumResponse.Content }
    $hashLength = if ($Algorithm -eq 'SHA256') { 64 } else { 128 }
    $published = [regex]::Match($checksumText, ('(?i)\b[0-9a-f]{' + $hashLength + '}\b')).Value
    if ($published.Length -ne $hashLength -or -not $published.Equals($PinnedChecksum, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Official checksum is missing or does not match the pinned release.'
    }
    $archive = Assert-RuntimePath (Join-Path $runtimeRoot $Name)
    if (Test-Path -LiteralPath $archive -PathType Leaf) {
        if ((Get-FileHash -LiteralPath $archive -Algorithm $Algorithm).Hash -ne $published) { throw 'Existing archive checksum does not match.' }
        return $archive
    }
    $temporary = Assert-RuntimePath (Join-Path $runtimeRoot ([Guid]::NewGuid().ToString('N') + '.download'))
    try {
        Write-Host ('Downloading verified runtime archive: ' + $Name)
        $curlCommand = Get-Command curl.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($null -ne $curlCommand) {
            & $curlCommand.Source --fail --location --silent --show-error --connect-timeout 20 --max-time 600 --output $temporary $Uri
            if ($LASTEXITCODE -ne 0) { throw 'Runtime archive download failed.' }
        } else {
            Invoke-WebRequest -Uri $Uri -OutFile $temporary -UseBasicParsing -TimeoutSec 600
        }
        if ((Get-FileHash -LiteralPath $temporary -Algorithm $Algorithm).Hash -ne $published) { throw 'Downloaded archive checksum does not match.' }
        [IO.File]::Move($temporary, $archive)
        return $archive
    } finally {
        if (Test-Path -LiteralPath $temporary -PathType Leaf) { Remove-Item -LiteralPath (Assert-RuntimePath $temporary) -Force }
    }
}

function Expand-VerifiedRuntime {
    param([string]$Archive, [string]$DestinationName)
    $destination = Assert-RuntimePath (Join-Path $runtimeRoot $DestinationName)
    if (Test-Path -LiteralPath $destination) { throw 'An incomplete runtime directory already exists. Inspect it before retrying.' }
    $temporary = Assert-RuntimePath (Join-Path $runtimeRoot ('extract-' + [Guid]::NewGuid().ToString('N')))
    $extractPaths.Add($temporary)
    New-Item -ItemType Directory -Path $temporary | Out-Null
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archiveReader = [IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        $extractPrefix = $temporary.TrimEnd('\') + '\'
        foreach ($entry in $archiveReader.Entries) {
            if ([IO.Path]::IsPathRooted($entry.FullName) -or $entry.FullName.Contains(':')) { throw 'Archive contains an unsafe entry.' }
            $entryTarget = [IO.Path]::GetFullPath((Join-Path $temporary $entry.FullName.Replace('/', '\')))
            if (-not $entryTarget.StartsWith($extractPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Archive entry escapes its extraction directory.' }
        }
    } finally { $archiveReader.Dispose() }
    [IO.Compression.ZipFile]::ExtractToDirectory($Archive, $temporary)
    $roots = @(Get-ChildItem -LiteralPath $temporary -Directory)
    if ($roots.Count -ne 1 -or @(Get-ChildItem -LiteralPath $temporary -File).Count -ne 0) { throw 'Unexpected runtime archive structure.' }
    $source = Assert-RuntimePath $roots[0].FullName
    $destination = Assert-RuntimePath $destination
    Move-Item -LiteralPath $source -Destination $destination
    return $destination
}

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
    $javaHome = $null
    if (-not [string]::IsNullOrWhiteSpace($env:CAMPUS_JAVA_HOME)) {
        if ((Get-JavaMajor $env:CAMPUS_JAVA_HOME) -ne 25) { throw 'CAMPUS_JAVA_HOME must point to a JDK 25 installation.' }
        $javaHome = [IO.Path]::GetFullPath($env:CAMPUS_JAVA_HOME)
    }
    $jdkInstall = Join-Path $runtimeRoot 'temurin-25.0.5-8'
    $candidates = New-Object 'System.Collections.Generic.List[string]'
    if (Test-Path -LiteralPath $jdkInstall -PathType Container) { $candidates.Add($jdkInstall) }
    if (-not [string]::IsNullOrWhiteSpace($env:JAVA_HOME)) { $candidates.Add($env:JAVA_HOME) }
    $parentDirectories = @('C:\Program Files\Java', 'C:\Program Files\Eclipse Adoptium', 'C:\Program Files\Microsoft', (Join-Path $env:USERPROFILE '.jdks'))
    foreach ($directory in $parentDirectories) {
        if (Test-Path -LiteralPath $directory -PathType Container) {
            foreach ($item in Get-ChildItem -LiteralPath $directory -Directory) { $candidates.Add($item.FullName) }
        }
    }
    $extensionDirectory = Join-Path $env:USERPROFILE '.vscode/extensions'
    if (Test-Path -LiteralPath $extensionDirectory -PathType Container) {
        foreach ($extension in Get-ChildItem -LiteralPath $extensionDirectory -Directory -Filter 'redhat.java-*') {
            $bundledJre = Join-Path $extension.FullName 'jre'
            if (Test-Path -LiteralPath $bundledJre -PathType Container) {
                foreach ($item in Get-ChildItem -LiteralPath $bundledJre -Directory) { $candidates.Add($item.FullName) }
            }
        }
    }
    if ($null -eq $javaHome) {
        foreach ($candidate in $candidates) { if ((Get-JavaMajor $candidate) -eq 25) { $javaHome = $candidate; break } }
    }
    if ($null -eq $javaHome) {
        # Exact Eclipse Temurin release published by the official Adoptium API.
        $jdkBase = 'https://github.com/adoptium/temurin25-binaries/releases/download/jdk-25.0.5%2B8/'
        $jdkName = 'OpenJDK25U-jdk_x64_windows_hotspot_25.0.5_8.zip'
        $jdkArchive = Get-VerifiedArchive $jdkName ($jdkBase + $jdkName) ($jdkBase + $jdkName + '.sha256.txt') 'SHA256' '636bdc13dc649ddc7d5921c5c7d23cca6e44fd19d662b45cc9c02135a6c96c42'
        $javaHome = Expand-VerifiedRuntime $jdkArchive 'temurin-25.0.5-8'
    }
    if ((Get-JavaMajor $javaHome) -ne 25) { throw 'The prepared JDK is not compatible with Java 25.' }

    $mavenHome = $null
    $mavenCandidates = @($env:CAMPUS_MAVEN_HOME, $env:MAVEN_HOME, (Join-Path $runtimeRoot 'apache-maven-3.9.16'))
    $mavenCommand = Get-Command mvn.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $mavenCommand) { $mavenCandidates += (Split-Path -Parent (Split-Path -Parent $mavenCommand.Source)) }
    foreach ($candidate in $mavenCandidates) {
        if ([string]::IsNullOrWhiteSpace($candidate)) { continue }
        if ((Test-Path -LiteralPath (Join-Path $candidate 'bin/mvn.cmd') -PathType Leaf) -and
            @(Get-ChildItem -LiteralPath (Join-Path $candidate 'lib') -Filter 'maven-core-3.9.*.jar' -File -ErrorAction SilentlyContinue).Count -eq 1) {
            $mavenHome = [IO.Path]::GetFullPath($candidate); break
        }
    }
    if ($null -eq $mavenHome) {
        $mavenName = 'apache-maven-3.9.16-bin.zip'
        $mavenBase = 'https://downloads.apache.org/maven/maven-3/3.9.16/binaries/'
        $mavenArchive = Get-VerifiedArchive $mavenName ($mavenBase + $mavenName) ($mavenBase + $mavenName + '.sha512') 'SHA512' 'ed41650d42485cfc243fad22158caf9cbb5dc408ce7a09ddb94dd42a019de929ca43065bfa450612cf12bf78b5cafa3884b96c090de326ff590448c933454af3'
        $mavenHome = Expand-VerifiedRuntime $mavenArchive 'apache-maven-3.9.16'
    }
    $runtimeConfiguration = @{ JavaHome = $javaHome; MavenHome = $mavenHome; JavaMajor = (Get-JavaMajor $javaHome) }
    $runtimeConfiguration | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeRoot 'server-runtime.json') -Encoding UTF8
    Write-Output ('PASS server runtime prepared: JDK ' + $runtimeConfiguration.JavaMajor + ', Maven 3.9.x. System Java and environment were not changed.')
} catch {
    [Console]::Error.WriteLine('Server runtime setup failed. Check official download access, archive checksums and workspace permissions. No system installation was changed.')
    exit 1
} finally {
    [Net.ServicePointManager]::SecurityProtocol = $previousProtocol
    foreach ($temporary in $extractPaths) {
        if (Test-Path -LiteralPath $temporary -PathType Container) { Remove-Item -LiteralPath (Assert-RuntimePath $temporary) -Recurse -Force }
    }
}
