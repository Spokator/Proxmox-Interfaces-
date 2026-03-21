# Proxmox-Interfaces Support Runbook

## 1) Quick health check

```bash
bash /opt/proxmox-interfaces/deploy/diagnose.sh
```

What to verify:
- `systemctl is-active proxmox-interfaces` is `active`
- `http://127.0.0.1/` returns `200`
- `/api/status` returns JSON
- `/api/proxmox/config-check` indicates configured/connected target

## 2) Collect support bundle

```bash
bash /opt/proxmox-interfaces/deploy/support-bundle.sh
```

Output:
- `/tmp/proxmox-interfaces-support-YYYYmmdd-HHMMSS.tar.gz`

Bundle includes:
- system info
- service status and logs
- nginx + systemd unit snapshots
- redacted environment file
- API snapshots (status/config-check/watchers)

## 3) First-run (or reconfiguration)

```bash
bash /opt/proxmox-interfaces/deploy/configure-instance.sh
```

Use this when:
- moving to another Proxmox target
- rotating API token
- changing DNS integration values

## 4) Core operational commands

```bash
systemctl status proxmox-interfaces
journalctl -u proxmox-interfaces -f
systemctl restart proxmox-interfaces
nginx -t
```

## 5) Escalation checklist

1. Attach support bundle archive
2. Include deployment method used (bootstrap args or compose)
3. Include current release tag (v1.0.x)
4. Include exact timestamp and observed error
