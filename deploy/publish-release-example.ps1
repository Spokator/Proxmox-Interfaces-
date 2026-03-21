$env:GITHUB_TOKEN = "<YOUR_GITHUB_TOKEN>"

powershell -ExecutionPolicy Bypass -File .\deploy\publish-github-release.ps1 `
  -Repo "Spokator/Proxmox-Interfaces-" `
  -Tag "v1.0.0" `
  -Name "Proxmox-Interfaces v1.0.0" `
  -NotesFile ".\release-notes-v1.0.0.md" `
  -Assets @(
    ".\dist\proxmox-interfaces-v1.0.0.tar.gz",
    ".\dist\proxmox-interfaces-v1.0.0.sha256",
    ".\dist\proxmox-interfaces-latest.tar.gz",
    ".\dist\proxmox-interfaces-latest.sha256"
  )
