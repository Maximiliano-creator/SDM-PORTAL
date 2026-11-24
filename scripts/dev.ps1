<#
.SYNOPSIS
  Arranca apps/api y apps/web en paralelo para desarrollo local.

.DESCRIPTION
  Lanza ambos procesos en nuevas ventanas de PowerShell. Cerrá las ventanas
  para detener cada proceso. Ctrl+C tradicional dentro de cada ventana también
  funciona.

  Si querés correrlos en background sin ventanas extras, usá `pnpm dev` desde
  la raíz que es la versión `pnpm -r --parallel`.
#>
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Write-Host "Lanzando API en :8788..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$root\apps\api'; pnpm dev"

Write-Host "Lanzando Web en :5173..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit","-Command","cd '$root\apps\web'; pnpm dev"

Write-Host ""
Write-Host "API:  http://127.0.0.1:8788/api/health"
Write-Host "Web:  http://127.0.0.1:5173"
Write-Host ""
Write-Host "Login default tras la primera corrida: admin / admin"
