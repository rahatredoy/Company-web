<#
.SYNOPSIS
  Starts every app of the Multi-Tenant E-Commerce SaaS platform at once.

.DESCRIPTION
  Each app runs in its own PowerShell window so its logs stay readable and it
  can be stopped on its own with Ctrl+C. Ports are fixed and never collide:

    company-web     3000    company-api   4000
    company-admin   3001    client-api    4100
    client-admin    3002
    client-store    3003

.PARAMETER Target
  all (default) | company | client | api | web

.PARAMETER Workers
  Also start the two BullMQ worker processes (no ports of their own).

.EXAMPLE
  .\dev.ps1
  .\dev.ps1 company
  .\dev.ps1 all -Workers
#>
[CmdletBinding()]
param(
  [ValidateSet('all', 'company', 'client', 'api', 'web')]
  [string]$Target = 'all',

  [switch]$Workers
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

$apps = @(
  @{ Name = 'company-api';   Path = 'company\company-api';   Script = 'dev'; Port = 4000; Side = 'company'; Kind = 'api' }
  @{ Name = 'company-web';   Path = 'company\company-web';   Script = 'dev'; Port = 3000; Side = 'company'; Kind = 'web' }
  @{ Name = 'company-admin'; Path = 'company\company-admin'; Script = 'dev'; Port = 3001; Side = 'company'; Kind = 'web' }
  @{ Name = 'client-api';    Path = 'client\client-api';     Script = 'dev'; Port = 4100; Side = 'client';  Kind = 'api' }
  @{ Name = 'client-admin';  Path = 'client\client-admin';   Script = 'dev'; Port = 3002; Side = 'client';  Kind = 'web' }
  @{ Name = 'client-store';  Path = 'client\client-store';   Script = 'dev'; Port = 3003; Side = 'client';  Kind = 'web' }
)

$selected = switch ($Target) {
  'company' { $apps | Where-Object { $_.Side -eq 'company' } }
  'client'  { $apps | Where-Object { $_.Side -eq 'client' } }
  'api'     { $apps | Where-Object { $_.Kind -eq 'api' } }
  'web'     { $apps | Where-Object { $_.Kind -eq 'web' } }
  default   { $apps }
}

if ($Workers) {
  $selected = @($selected) + @(
    @{ Name = 'company-worker'; Path = 'company\company-api'; Script = 'worker:dev'; Port = $null }
    @{ Name = 'client-worker';  Path = 'client\client-api';   Script = 'worker:dev'; Port = $null }
  )
}

# --- Pre-flight ---------------------------------------------------------------
# A missing dependency is fatal. A port that is already listening is not: that
# app is simply already up, so it is skipped and the rest still start.

$blocked = $false
$toStart = @()

foreach ($app in $selected) {
  $full = Join-Path $root $app.Path

  if (-not (Test-Path $full)) {
    Write-Host "MISSING  $($app.Name) -> $($app.Path) does not exist" -ForegroundColor Red
    $blocked = $true
    continue
  }

  if (-not (Test-Path (Join-Path $full 'node_modules'))) {
    Write-Host "MISSING  $($app.Name) has no node_modules - run: cd '$full'; npm install" -ForegroundColor Red
    $blocked = $true
    continue
  }

  if ($null -ne $app.Port) {
    $inUse = Get-NetTCPConnection -LocalPort $app.Port -State Listen -ErrorAction SilentlyContinue
    if ($inUse) {
      $pidList = ($inUse.OwningProcess | Sort-Object -Unique) -join ', '
      Write-Host "running  $($app.Name) :$($app.Port) already up (PID $pidList) - skipped" -ForegroundColor DarkGray
      continue
    }
  }

  $toStart += $app
}

if ($blocked) {
  Write-Host ''
  Write-Host 'Install the missing dependencies above, then run this script again.' -ForegroundColor Yellow
  exit 1
}

if (-not $toStart) {
  Write-Host ''
  Write-Host 'Everything selected is already running.' -ForegroundColor Cyan
  Write-Host 'To restart one:  Stop-Process -Id <PID>   then run this script again.' -ForegroundColor DarkGray
  exit 0
}

# --- Launch -------------------------------------------------------------------

foreach ($app in $toStart) {
  $full = Join-Path $root $app.Path
  $title = "$($app.Name)$(if ($app.Port) { " :$($app.Port)" })"

  $inner = "`$Host.UI.RawUI.WindowTitle = '$title'; Set-Location '$full'; npm run $($app.Script)"
  Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoExit', '-Command', $inner | Out-Null

  Write-Host "started  $title" -ForegroundColor Green
}

Write-Host ''
Write-Host 'Local URLs' -ForegroundColor Cyan
foreach ($app in $selected | Where-Object { $_.Port }) {
  '{0,-14} http://localhost:{1}' -f $app.Name, $app.Port | Write-Host
}
Write-Host ''
Write-Host 'Each app owns its window - close it or press Ctrl+C there to stop that one app.' -ForegroundColor DarkGray
