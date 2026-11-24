<#
.SYNOPSIS
  Mata procesos node huérfanos que quedaron escuchando 8788 (API) o 5173 (web)
  después de un Ctrl+C de pnpm dev que no limpió correctamente.

.DESCRIPTION
  En Windows, tsx-watch a veces deja un node hijo zombie tras Ctrl+C de pnpm.
  El próximo "pnpm dev" falla con EADDRINUSE. Este script encuentra y mata
  el ocupante.

.EXAMPLE
  .\scripts\kill-stuck.ps1
#>
$ErrorActionPreference = "Stop"

foreach ($port in 8788, 5173) {
    $owners = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
    if ($owners) {
        foreach ($id in $owners) {
            $p = Get-Process -Id $id -ErrorAction SilentlyContinue
            if ($p) {
                Write-Host "Matando $($p.ProcessName) PID $id (puerto $port, started $($p.StartTime))" -ForegroundColor Yellow
                Stop-Process -Id $id -Force
            }
        }
    } else {
        Write-Host "Puerto $port libre" -ForegroundColor Green
    }
}

Start-Sleep -Milliseconds 500
Write-Host "Listo. Podés correr 'pnpm dev'" -ForegroundColor Cyan
