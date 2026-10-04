param([Parameter(Mandatory=$true)][string]$SourcePath)
$tokens=$null
$errors=$null
[void][Management.Automation.Language.Parser]::ParseFile($SourcePath,[ref]$tokens,[ref]$errors)
if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Error $_.Message }; exit 1 }
Write-Output 'PowerShell syntax verified.'
