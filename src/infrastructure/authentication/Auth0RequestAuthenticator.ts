import type { FastifyRequest } from "fastify";
import type { TokenClaims } from "../security/security.js";
import type { RequestAuthenticator } from "../../interfaces/http/authentication.js";
import { AuthenticationError } from "./errors.js";
import type { VerifiedJwtPayloadVerifier } from "./JoseJwtVerifier.js";
import { mapVerifiedAuth0Payload, ExternalIdentityResolver } from "./external-identity.js";

const BEARER_PATTERN = /^Bearer ([A-Za-z0-9\-._~+/]+=*)$/;

/** Auth0-specific composition. Provider choice is explicit; no issuer fallback. */
export class Auth0RequestAuthenticator implements RequestAuthenticator {
  constructor(
    private readonly verifier: VerifiedJwtPayloadVerifier,
    private readonly resolver: ExternalIdentityResolver,
  ) {}

  async authenticate(request: FastifyRequest): Promise<TokenClaims> {
    const match = request.headers.authorization?.match(BEARER_PATTERN);
    if (!match?.[1]) throw new AuthenticationError();
    try {
      const verified = await this.verifier.verifyPayload(match[1]);
      const external = mapVerifiedAuth0Payload(verified.rawClaims);
      return await this.resolver.resolve(external);
    } catch {
      throw new AuthenticationError();
    }
  }
}
