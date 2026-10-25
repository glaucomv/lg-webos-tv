# schedule_photo_sync.ps1
# Configura o Agendador de Tarefas do Windows para sincronizar automaticamente
# fotos do Google Fotos para o pendrive ou para a TV.
#
# Uso:
#   .\tools\schedule_photo_sync.ps1 -AlbumUrl "https://photos.app.goo.gl/SEU_ALBUM" -PendriveFolder "E:\fotos" [-SendToTv]

param (
    [Parameter(Mandatory=$true)]
    [string]$AlbumUrl,

    [Parameter(Mandatory=$false)]
    [string]$PendriveFolder = "",

    [Parameter(Mandatory=$false)]
    [switch]$SendToTv
)

$TaskName = "SyncGooglePhotosToLGTV"
$PythonExe = (Get-Command python).Source
$ScriptPath = Join-Path $PSScriptRoot "sync_google_photos.py"

$ArgsList = "`"$ScriptPath`" --album-url `"$AlbumUrl`""
if ($PendriveFolder) {
    $ArgsList += " --dest `"$PendriveFolder`""
}
if ($SendToTv) {
    $ArgsList += " --tv"
}

$Action = New-ScheduledTaskAction -Execute $PythonExe -Argument $ArgsList
# Dispara a cada 12 horas ou diariamente as 04:00 AM
$Trigger = New-ScheduledTaskTrigger -Daily -At 4am

Write-Host "[*] Registrando tarefa agendada: $TaskName ..." -ForegroundColor Cyan
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Description "Sincronizacao periodica de fotos do Google Fotos para TV LG" -Force

Write-Host "[OK] Tarefa agendada com sucesso! O Windows executara a sincronizacao diariamente." -ForegroundColor Green
Write-Host "     Comando que sera executado: $PythonExe $ArgsList"
