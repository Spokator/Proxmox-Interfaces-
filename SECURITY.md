# Security Policy

## Supported versions

The latest release line is supported for security fixes.

## Reporting a vulnerability

If you discover a vulnerability:

1. Do not open a public issue with exploit details.
2. Send a private report to the project maintainer.
3. Include:
   - impact summary
   - affected versions
   - reproduction steps
   - mitigation ideas if available

The project will acknowledge the report and provide a remediation timeline.

## Security best practices for operators

- Keep `.env` private and rotate API tokens periodically.
- Use SHA256 verification for all artifact installs.
- Avoid using `--skip-checks` in production bootstrap runs.
- Restrict network exposure at reverse proxy/firewall level.
