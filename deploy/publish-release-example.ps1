$env:GITHUB_TOKEN = "<YOUR_GITHUB_TOKEN>"

& .\deploy\publish-github-release.ps1 `
  -Repo "Spokator/Proxmox-Interfaces-" `
  -Tag "v1.0.2" `
  -Name "Proxmox-Interfaces v1.0.2" `
  -NotesFile ".\release-notes-v1.0.2.md" `
  -Assets @(
    ".\dist\proxmox-interfaces-v1.0.2.tar.gz",
    ".\dist\proxmox-interfaces-v1.0.2.sha256",
    ".\dist\proxmox-interfaces-latest.tar.gz",
    ".\dist\proxmox-interfaces-latest.sha256"
  )
