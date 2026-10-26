---
name: jwt-validate
description: Verify JSON Web Tokens (JWTs) using the project's existing reviewed jose dependency, an explicitly trusted key source, an algorithm allowlist, and required issuer/audience policy. Use when asked to verify or validate a JWT. Never claim authenticity when signature verification was skipped.
---

# JWT Validate

Use a fail-closed process. A JWT's decoded header and payload are attacker-controlled until cryptographic verification succeeds. Decoding or parsing a token does not verify its signature and does not establish that any claim is true.

## Required dependency policy

1. Prefer the project's existing, reviewed `jose` dependency for Node.js JWT verification.
2. Never automatically install packages, run package managers, or modify dependency manifests or lockfiles.
3. Check availability before attempting verification:

   ```bash
   node --input-type=module -e "await import('jose'); console.log('jose: available')"
   ```

4. If that command fails, stop. Report that `jose` is unavailable and request explicit approval before any dependency change. Do not fall back to custom cryptography, another unreviewed package, or an insecure decode-only check presented as verification.

## Validation procedure

### 1. Establish trusted verification policy

Before trusting claims, establish these values from trusted application configuration or the user’s verified identity-provider configuration:

- The expected signing algorithm or a narrow algorithm allowlist appropriate to the key type.
- The expected issuer (`iss`).
- The expected audience (`aud`).
- A trusted key, or a fixed JWKS URL obtained from trusted configuration.
- Any application-specific required claims and token-age policy.

Do not derive issuer, audience, algorithms, or key locations from unverified token contents. If required policy is missing, ask for it or report that validation cannot be completed; do not silently skip the checks.

### 2. Inspect structure only as untrusted input

If inspecting a token before verification is useful, treat every decoded header and payload value as attacker-controlled diagnostic data. Parsing JSON, reading `alg`, `kid`, `iss`, `aud`, `exp`, `nbf`, or `iat` before verification is not validation. Do not make authorization, key-source, or trust decisions based on those values.

Reject malformed tokens and unsigned `alg: "none"` tokens. Never choose the verification algorithm from the token's `alg` header. Never use token-supplied `jku`, `x5u`, or embedded `jwk` values as a key source. A `kid` may only be used by the verification library to select a key from the independently configured, trusted key set.

### 3. Verify the signature and enforce claims together

Use `jose` verification APIs with an explicit algorithm allowlist and required expected issuer and audience. Require the claims mandated by the application's policy. Signature verification, expiration, not-before, issuer, and audience checks must all succeed before treating claims as trusted.

Do not add clock tolerance by default. The default is zero tolerance. Only apply a non-zero tolerance when the system owner has explicitly established and documented a justified value; never apply an unconditional 60-second allowance. Apply any maximum token age or `iat` policy explicitly when the application requires it.

Never print the full token, secret, key, or entire payload. Report only the minimum non-sensitive result fields needed, such as verification status, configured algorithm, and expiry time. Avoid echoing raw verification exceptions or untrusted claim values into logs.

## Node.js example: HMAC key from a protected file

This example expects the token and raw HMAC key to already exist in access-restricted files. It does not put either value in shell history, command arguments, or environment variables. Provision these files securely outside this command. Keep the key file's bytes exact; do not add a newline to the secret.

Set only file paths and trusted policy values in the environment:

```bash
export JWT_FILE="$HOME/.secrets/token.jwt"
export JWT_SECRET_FILE="$HOME/.secrets/jwt-hmac.key"
export JWT_EXPECTED_ISSUER="https://issuer.example"
export JWT_EXPECTED_AUDIENCE="nabuuma-api"
```

Replace the issuer and audience with the values configured by your trusted identity provider. Then run:

```bash
node --input-type=module <<'NODE'
import { readFile } from 'node:fs/promises';
import { jwtVerify } from 'jose';

try {
  const required = [
    'JWT_FILE',
    'JWT_SECRET_FILE',
    'JWT_EXPECTED_ISSUER',
    'JWT_EXPECTED_AUDIENCE',
  ];
  for (const name of required) {
    if (!process.env[name]) throw new Error('Required trusted configuration is missing');
  }

  const token = (await readFile(process.env.JWT_FILE, 'utf8')).trim();
  const key = await readFile(process.env.JWT_SECRET_FILE);

  const { payload, protectedHeader } = await jwtVerify(
    token,
    new Uint8Array(key),
    {
      algorithms: ['HS256'],
      issuer: process.env.JWT_EXPECTED_ISSUER,
      audience: process.env.JWT_EXPECTED_AUDIENCE,
      requiredClaims: ['exp', 'iss', 'aud'],
    },
  );

  console.log('VALID — signature and configured claim checks passed');
  console.log(JSON.stringify({
    algorithm: protectedHeader.alg,
    expiresAt: typeof payload.exp === 'number'
      ? new Date(payload.exp * 1000).toISOString()
      : undefined,
  }));
} catch {
  console.error('INVALID — verification or required policy check failed');
  process.exitCode = 1;
}
NODE
```

Use this HMAC example only when HS256 is the algorithm configured by the trusted system and the key is the correct secret. Do not use an asymmetric public key as an HMAC secret.

## Node.js example: trusted remote JWKS

Use this pattern only when the identity provider and its JWKS endpoint are known and trusted independently of the token. The URL and allowed hostname below must come from trusted configuration, never from JWT headers.

```bash
export JWT_FILE="$HOME/.secrets/token.jwt"
export JWT_JWKS_URL="https://issuer.example/.well-known/jwks.json"
export JWT_JWKS_ALLOWED_HOST="issuer.example"
export JWT_EXPECTED_ISSUER="https://issuer.example"
export JWT_EXPECTED_AUDIENCE="nabuuma-api"
```

Replace the example values with the identity provider's verified settings. Then run:

```bash
node --input-type=module <<'NODE'
import { readFile } from 'node:fs/promises';
import { createRemoteJWKSet, jwtVerify } from 'jose';

try {
  const required = [
    'JWT_FILE',
    'JWT_JWKS_URL',
    'JWT_JWKS_ALLOWED_HOST',
    'JWT_EXPECTED_ISSUER',
    'JWT_EXPECTED_AUDIENCE',
  ];
  for (const name of required) {
    if (!process.env[name]) throw new Error('Required trusted configuration is missing');
  }

  const jwksUrl = new URL(process.env.JWT_JWKS_URL);
  if (
    jwksUrl.protocol !== 'https:' ||
    jwksUrl.hostname !== process.env.JWT_JWKS_ALLOWED_HOST
  ) {
    throw new Error('JWKS URL is outside the configured trust boundary');
  }

  const token = (await readFile(process.env.JWT_FILE, 'utf8')).trim();
  const trustedJwks = createRemoteJWKSet(jwksUrl);

  const { payload, protectedHeader } = await jwtVerify(token, trustedJwks, {
    algorithms: ['RS256'],
    issuer: process.env.JWT_EXPECTED_ISSUER,
    audience: process.env.JWT_EXPECTED_AUDIENCE,
    requiredClaims: ['exp', 'iss', 'aud'],
  });

  console.log('VALID — signature and configured claim checks passed');
  console.log(JSON.stringify({
    algorithm: protectedHeader.alg,
    expiresAt: typeof payload.exp === 'number'
      ? new Date(payload.exp * 1000).toISOString()
      : undefined,
  }));
} catch {
  console.error('INVALID — verification or required policy check failed');
  process.exitCode = 1;
}
NODE
```

The hostname check is a guardrail, not a substitute for deployment-level outbound network controls. Keep the JWKS endpoint fixed in trusted configuration and restrict network egress where appropriate. Do not follow token-controlled key URLs or accept token-embedded public keys.

## If no trusted key is available

You may report only that the token's syntax or decoded fields were inspected. Do not label its claims as validated, do not infer authenticity, and do not use those values for authorization.

Use this exact distinction in the report:

```text
Structure: inspected only; input remains untrusted
Claims:    NOT VALIDATED
Signature: NOT VERIFIED — token authenticity is unknown
Result:    UNVERIFIED
```

## Output format

After successful cryptographic verification and required policy checks, report only minimal metadata:

```text
## JWT Validation Report
Signature: PASS
Issuer:    PASS
Audience:  PASS
Expiry:    PASS
Result:    VALID
```

On any verification or required-claim failure:

```text
## JWT Validation Report
Verification: FAIL
Result:       INVALID
```

Do not report a claim as `PASS` unless the verification library enforced it against trusted policy. Do not print the full payload or secrets to make a report appear more detailed.

## Security rules

- Never automatically install packages or modify dependencies.
- Prefer the project's existing, reviewed `jose` dependency; fail closed if unavailable.
- Never place a JWT or secret in inline shell assignments, command-line arguments, logs, or chat output. Use protected files or an approved secret-input mechanism.
- Never trust decoded header or payload fields before successful verification.
- Never select allowed algorithms from the token header; always configure an explicit allowlist.
- Never use token-supplied `jku`, `x5u`, or embedded `jwk` to locate or supply verification keys.
- Require expected issuer and audience when the application uses them; do not silently omit configured policy checks.
- Do not apply unconditional clock tolerance. Default to zero; use a non-zero value only under an explicit documented policy.
- Never print the entire verified payload. Minimize output and treat exception messages and untrusted claim values as potentially sensitive.
- If verification cannot be completed, fail closed and report `UNVERIFIED` or `INVALID`; never imply authenticity.
