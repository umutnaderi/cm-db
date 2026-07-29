param(
    [int]$StartChunk = 1,
    [int]$EndChunk = 14,
    [string]$Database = "retroball-db",
    [string]$WorkerDirectory = "",
    [string]$ChunkDirectory = "",
    [string]$LogPath = "",
    [string]$StatusPath = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$workspace = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if (-not $WorkerDirectory) {
    $WorkerDirectory = Join-Path $workspace "worker"
}
if (-not $ChunkDirectory) {
    $ChunkDirectory = Join-Path $workspace "data\d1\chunks"
}
if (-not $LogPath) {
    $LogPath = Join-Path $workspace "data\d1\remote-import.log"
}
if (-not $StatusPath) {
    $StatusPath = Join-Path $workspace "data\d1\remote-import-status.json"
}

$WorkerDirectory = (Resolve-Path $WorkerDirectory).Path
$ChunkDirectory = (Resolve-Path $ChunkDirectory).Path
$wrangler = Join-Path $WorkerDirectory "node_modules\.bin\wrangler.cmd"
if (-not (Test-Path -LiteralPath $wrangler)) {
    throw "Wrangler executable not found: $wrangler"
}
if ($StartChunk -lt 1 -or $EndChunk -gt 14 -or $StartChunk -gt $EndChunk) {
    throw "Chunk range must be between 1 and 14."
}

function Write-ImportLog {
    param([string]$Message)
    $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss zzz"), $Message
    $line | Tee-Object -FilePath $LogPath -Append
}

function Write-ImportStatus {
    param(
        [string]$State,
        [int]$Chunk,
        [int]$ExitCode = 0,
        [double]$ElapsedSeconds = 0
    )
    [ordered]@{
        state = $State
        database = $Database
        chunk = $Chunk
        start_chunk = $StartChunk
        end_chunk = $EndChunk
        exit_code = $ExitCode
        elapsed_seconds = [math]::Round($ElapsedSeconds, 1)
        updated_at = (Get-Date).ToString("o")
    } | ConvertTo-Json | Set-Content -LiteralPath $StatusPath -Encoding UTF8
}

Write-ImportLog "IMPORT RANGE START database=$Database chunks=$StartChunk-$EndChunk"

for ($chunkNumber = $StartChunk; $chunkNumber -le $EndChunk; $chunkNumber++) {
    $chunkName = "retroball-d1-{0:D4}.sql" -f $chunkNumber
    $chunkPath = Join-Path $ChunkDirectory $chunkName
    if (-not (Test-Path -LiteralPath $chunkPath)) {
        throw "Chunk not found: $chunkPath"
    }

    $sizeMiB = [math]::Round((Get-Item -LiteralPath $chunkPath).Length / 1MB, 1)
    $timer = [Diagnostics.Stopwatch]::StartNew()
    Write-ImportStatus -State "running" -Chunk $chunkNumber
    Write-ImportLog "CHUNK $chunkNumber/$EndChunk START file=$chunkName size_mib=$sizeMiB"

    $exitCode = -1
    Push-Location $WorkerDirectory
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        # Windows PowerShell wraps native stderr lines as error records. Wrangler
        # writes normal progress there, so keep those records loggable rather than
        # letting ErrorActionPreference=Stop terminate an otherwise successful import.
        $ErrorActionPreference = "Continue"
        & $wrangler d1 execute $Database --remote --yes --file $chunkPath 2>&1 |
            ForEach-Object { Write-ImportLog "CHUNK $chunkNumber OUTPUT $_" }
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
        Pop-Location
        $timer.Stop()
    }

    if ($exitCode -ne 0) {
        Write-ImportStatus -State "failed" -Chunk $chunkNumber -ExitCode $exitCode -ElapsedSeconds $timer.Elapsed.TotalSeconds
        Write-ImportLog "CHUNK $chunkNumber/$EndChunk FAILED exit_code=$exitCode elapsed_seconds=$([math]::Round($timer.Elapsed.TotalSeconds, 1))"
        exit $exitCode
    }

    Write-ImportStatus -State "completed" -Chunk $chunkNumber -ElapsedSeconds $timer.Elapsed.TotalSeconds
    Write-ImportLog "CHUNK $chunkNumber/$EndChunk COMPLETE elapsed_seconds=$([math]::Round($timer.Elapsed.TotalSeconds, 1))"
}

Write-ImportLog "IMPORT RANGE COMPLETE database=$Database chunks=$StartChunk-$EndChunk"
