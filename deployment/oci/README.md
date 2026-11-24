# OCI Small-VM Deployment Blueprint

Blueprint only. No account, VM, network, image or billing configuration created.

Topology: Internet 80/443 -> Caddy TLS proxy -> private Fastify API container -> external PostgreSQL provider. PostgreSQL remains external. Never expose port 5432 publicly.

Requirements: Linux VM; Docker Engine/Compose; region/capacity and free eligibility verified; authorized DNS; TLS via Caddy; private runtime environment; firewall inbound 80/443 only and SSH restricted; restart-on-boot; monitoring; independent DB backup.

Provisioning is an external account action requiring authorized adult/account holder. Review current OCI Free Tier terms, region capacity, identity and billing before provisioning.

Deployment outline: provision VM and restrict ingress; install Docker; copy compose/Caddy; create private runtime.env mode 600; configure DNS; start; verify HTTPS/live/ready/logs/DB; configure restart/backup; rehearse recovery.

Secrets never enter Git/image/compose labels/history/logs. Recovery rebuilds from reviewed source/lockfile, restores into new DB, validates schema/data/RLS/policies/triggers/function owners/grants/resolver/verifier, then DNS switch after checks. Review usage and avoid PAYG or paid services without explicit authorized budget.
