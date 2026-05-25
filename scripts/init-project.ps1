# scripts/init-project.ps1
# HX MM Logistics System - Windows initialization script
# Supports Windows PowerShell 5.1 and PowerShell 7+

$ErrorActionPreference = "Stop"

function Write-Step { param([string]$Message) Write-Host ""; Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Ok { param([string]$Message) Write-Host "OK: $Message" -ForegroundColor Green }
function Write-Warn { param([string]$Message) Write-Host "WARN: $Message" -ForegroundColor Yellow }
function Fail { param([string]$Message) Write-Host ""; Write-Host "ERROR: $Message" -ForegroundColor Red; exit 1 }
function Test-Command { param([string]$Command) return $null -ne (Get-Command $Command -ErrorAction SilentlyContinue) }

function Run-Step {
  param([string]$Title, [scriptblock]$Command)
  Write-Step $Title
  try {
    & $Command
    if ($LASTEXITCODE -ne $null -and $LASTEXITCODE -ne 0) { Fail "$Title failed with exit code $LASTEXITCODE" }
    Write-Ok $Title
  } catch {
    Fail "$Title failed: $($_.Exception.Message)"
  }
}

function Get-NpmScripts {
  $packagePath = Join-Path $ProjectRoot "package.json"
  if (-not (Test-Path $packagePath)) { Fail "package.json not found" }
  return (Get-Content $packagePath -Raw | ConvertFrom-Json).scripts.PSObject.Properties.Name
}

function Assert-NpmScript {
  param([string]$ScriptName)
  if ($Scripts -notcontains $ScriptName) { Fail "Missing npm script: $ScriptName" }
}

function Read-EnvDatabaseUrl {
  param([string]$EnvPath)
  if (-not (Test-Path $EnvPath)) { return $null }
  $line = Get-Content $EnvPath | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
  if (-not $line) { return $null }
  return ($line -replace '^DATABASE_URL=', '').Trim().Trim('"').Trim("'")
}

function Assert-DatabaseUrl {
  param([string]$DatabaseUrl)
  if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) { Fail "DATABASE_URL is required" }
  if ($DatabaseUrl -notmatch '^postgres(ql)?://') { Fail "DATABASE_URL must start with postgresql:// or postgres://" }
  try { [void][System.Uri]$DatabaseUrl } catch { Fail "DATABASE_URL is not a valid URL" }
}

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $ProjectRoot

Write-Host "HX MM Logistics System initialization" -ForegroundColor Green
Write-Host "Project root: $ProjectRoot"

Write-Step "Checking Node.js"
if (-not (Test-Command "node")) { Fail "Node.js is not installed. Install Node.js 22+ first." }
Write-Ok "Node.js detected: $(node -v)"

Write-Step "Checking npm"
if (-not (Test-Command "npm")) { Fail "npm is not installed." }
Write-Ok "npm detected: $(npm -v)"

Write-Step "Checking PostgreSQL client"
if (Test-Command "psql") { Write-Ok "PostgreSQL client detected: $(psql --version)" } else { Write-Warn "psql not found. Install PostgreSQL client tools if you want local DB checks." }

Write-Step "Preparing .env"
$EnvPath = Join-Path $ProjectRoot ".env"
$EnvExamplePath = Join-Path $ProjectRoot ".env.example"
if (-not (Test-Path $EnvPath)) {
  if (Test-Path $EnvExamplePath) { Copy-Item $EnvExamplePath $EnvPath; Write-Ok ".env created from .env.example" }
  else { New-Item -Path $EnvPath -ItemType File | Out-Null; Write-Ok ".env created" }
}

$DatabaseUrl = Read-EnvDatabaseUrl $EnvPath
if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
  $DatabaseUrl = Read-Host "Enter DATABASE_URL, e.g. postgresql://user:password@host:5432/hxmm_staging"
  Assert-DatabaseUrl $DatabaseUrl
  $envContent = Get-Content $EnvPath -Raw -ErrorAction SilentlyContinue
  if ($envContent -match '(?m)^DATABASE_URL=') { $envContent = $envContent -replace '(?m)^DATABASE_URL=.*', "DATABASE_URL=$DatabaseUrl"; Set-Content -Path $EnvPath -Value $envContent -Encoding UTF8 }
  else { Add-Content -Path $EnvPath -Value "DATABASE_URL=$DatabaseUrl" -Encoding UTF8 }
  Write-Ok "DATABASE_URL saved"
} else {
  Assert-DatabaseUrl $DatabaseUrl
  Write-Ok "DATABASE_URL exists"
}

$Scripts = Get-NpmScripts
foreach ($required in @('db:init', 'build', 'start')) { Assert-NpmScript $required }

Run-Step "Installing npm dependencies" { npm install }
Run-Step "Initializing database with db:init" { npm run db:init }
Run-Step "Building frontend" { npm run build }

Write-Host "" 
Write-Host "HX MM initialization completed successfully." -ForegroundColor Green
Write-Host "Start API: npm run start" -ForegroundColor Cyan
Write-Host "Health: http://localhost:4000/api/health" -ForegroundColor Cyan
Write-Host "Dev mode: npm run dev" -ForegroundColor Cyan
Write-Host "Acceptance: npm run acceptance" -ForegroundColor Cyan
