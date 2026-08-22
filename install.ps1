<#
.SYNOPSIS
    PowerShell companion to copy_to_plugins_dir.sh for native Windows.

.DESCRIPTION
    Installs this repo's opencode extensions into the global config directory
    that opencode scans at startup:

        *.ts -> <config>\plugins\*.ts   (auto-loaded plugins)
        *.md -> <config>\command\*.md   (slash commands; README.md is skipped)

    Target directory resolution mirrors opencode itself:
        $env:OPENCODE_CONFIG_DIR, else ${XDG_CONFIG_HOME:-~/.config}\opencode
    (opencode uses xdg-basedir, which resolves identically on Windows,
    Linux, and macOS.)

    Prefers symlinks so edits in this repo take effect immediately; falls back
    to copying when symlinks are unavailable (PowerShell without elevation or
    Developer Mode). Re-running is safe and refreshes links/copies in place.

.USAGE
    powershell -ExecutionPolicy Bypass -File .\copy_to_plugins_dir.ps1
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$SrcDir = $PSScriptRoot

if ($env:OPENCODE_CONFIG_DIR) {
	$ConfigDir = $env:OPENCODE_CONFIG_DIR
}
elseif ($env:XDG_CONFIG_HOME) {
	$ConfigDir = Join-Path $env:XDG_CONFIG_HOME 'opencode'
}
else {
	$ConfigDir = Join-Path $HOME '.config/opencode'
}

$pluginFiles = @(Get-ChildItem -Path (Join-Path $SrcDir '*.ts') -File -ErrorAction SilentlyContinue)
$commandFiles = @(
	Get-ChildItem -Path (Join-Path $SrcDir '*.md') -File -ErrorAction SilentlyContinue |
		Where-Object { $_.Name -ine 'README.md' }
)

if ($pluginFiles.Count -eq 0 -and $commandFiles.Count -eq 0) {
	[Console]::Error.WriteLine("Nothing to install: no .ts or .md files found in $SrcDir")
	exit 1
}

function Install-ExtensionFile {
	param(
		[string]$Source,
		[string]$DestDir
	)

	$Name = Split-Path -Leaf $Source
	$Dest = Join-Path $DestDir $Name

	try {
		if (-not (Test-Path -LiteralPath $DestDir)) {
			New-Item -ItemType Directory -Path $DestDir -Force | Out-Null
		}

		# Remove any stale destination so re-runs refresh in place.
		if (Test-Path -LiteralPath $Dest) {
			Remove-Item -LiteralPath $Dest -Force
		}

		try {
			New-Item -ItemType SymbolicLink -Path $Dest -Value $Source -ErrorAction Stop | Out-Null
			Write-Host ('linked    {0}' -f $Dest)
		}
		catch {
			# Symlinks unavailable (no elevation / Developer Mode off): copy instead.
			Copy-Item -LiteralPath $Source -Destination $Dest -Force
			Write-Host ('copied    {0}' -f $Dest)
		}
	}
	catch {
		[Console]::Error.WriteLine(('FAILED    {0}' -f $Dest))
		return $false
	}

	return $true
}

Write-Host ('Installing from {0}' -f $SrcDir)
Write-Host ('into        {0}' -f $ConfigDir)
Write-Host ''

$status = $true

foreach ($file in $pluginFiles) {
	if (-not (Install-ExtensionFile -Source $file.FullName -DestDir (Join-Path $ConfigDir 'plugins'))) {
		$status = $false
	}
}

foreach ($file in $commandFiles) {
	if (-not (Install-ExtensionFile -Source $file.FullName -DestDir (Join-Path $ConfigDir 'command'))) {
		$status = $false
	}
}

if (-not $status) {
	Write-Host ''
	[Console]::Error.WriteLine('Some files failed to install.')
	exit 1
}

Write-Host ''
Write-Host 'Done. Restart running opencode sessions to pick up changes.'
