$env:GITHUB_TOKEN = "<YOUR_GITHUB_TOKEN>"

& .\deploy\publish-github-release.ps1 `
  -Repo "Spokator/Proxmox-Interfaces-" `
  -Tag "v1.0.1" `
  -Name "Proxmox-Interfaces v1.0.1" `
  -NotesFile ".\release-notes-v1.0.1.md" `
  -Assets @(
    ".\dist\proxmox-interfaces-v1.0.1.tar.gz",
    ".\dist\proxmox-interfaces-v1.0.1.sha256",
    ".\dist\proxmox-interfaces-latest.tar.gz",
    ".\dist\proxmox-interfaces-latest.sha256"
  )
