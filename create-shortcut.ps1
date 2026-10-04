$ErrorActionPreference = 'Stop'
$launcher = Join-Path $PSScriptRoot 'DeepWork.bat'
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'DeepWork.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $launcher
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.IconLocation = Join-Path $PSScriptRoot 'resources\icon.ico'
$shortcut.Save()
[void][Runtime.InteropServices.Marshal]::ReleaseComObject($shortcut)
[void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell)
