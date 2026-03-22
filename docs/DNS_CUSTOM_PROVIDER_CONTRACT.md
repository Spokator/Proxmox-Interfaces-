# DNS Custom Provider Contract

This document defines the expected HTTP contract when using:
- DNS_PROVIDER=custom
- DNS_API_URL=<your endpoint>

The backend requests DNS_API_URL with:
- Method: GET
- Timeout: 5s
- Header: Accept: application/json
- Header: Authorization: Bearer <DNS_API_TOKEN> (only if DNS_API_TOKEN is set)

## Expected JSON payload

The endpoint must return a JSON object. Both shapes are accepted:
- direct payload
- wrapped payload under data

Examples:

```json
{
  "byIp": {
    "10.0.0.20": ["wiki.internal", "wiki-alt.internal"],
    "10.0.0.30": ["n8n.internal"]
  },
  "byDomain": {
    "wiki.internal": ["10.0.0.20"],
    "n8n.internal": ["10.0.0.30"]
  },
  "byDomainPorts": {
    "wiki.internal": [80, 443],
    "n8n.internal": [5678]
  },
  "source": "custom-api",
  "zones": 2
}
```

or

```json
{
  "data": {
    "byIp": {
      "10.0.0.20": ["wiki.internal"]
    },
    "byDomain": {
      "wiki.internal": ["10.0.0.20"]
    },
    "byDomainPorts": {
      "wiki.internal": [443]
    }
  }
}
```

## Field rules

- byIp:
  - object map: IPv4 string => array of hostnames
  - invalid IPs are ignored
  - hostnames are normalized lowercase/FQDN style

- byDomain:
  - object map: hostname => array of IPv4 strings
  - invalid hostnames/IPs are ignored

- byDomainPorts:
  - object map: hostname => array of ports
  - valid port range: 1..65535

- source (optional):
  - string describing the provider source (e.g. "custom-api")

- zones (optional):
  - number used for reporting/debug only

## Operational behavior

- HTTP non-2xx response marks DNS source as error.
- Invalid JSON marks DNS source as error.
- Missing DNS_API_URL marks provider as disabled.
- API diagnostics available:
  - /api/dns/status
  - /api/dns/config-check

## Recommendations

- Keep response payload small and deterministic.
- Return normalized hostnames (lowercase, without trailing dot).
- Add lightweight caching on provider side to avoid frequent backend pressure.
- Ensure endpoint is reachable from the Proxmox-Interfaces runtime network.
