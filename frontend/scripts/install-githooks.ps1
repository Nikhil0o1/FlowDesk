# Enable repo git hooks on Windows (Git Bash runs the hook scripts).
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root
git config core.hooksPath .githooks
Write-Host "Installed git hooks -> .githooks (flowdesk_ui)"
Write-Host "  pre-commit, pre-push, commit-msg"
Write-Host "Run hooks via Git Bash (included with Git for Windows)."
