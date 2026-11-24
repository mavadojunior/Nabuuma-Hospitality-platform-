import type { FastifyRequest } from "fastify";
import type { TokenClaims } from "../security/security.js";
import type { RequestAuthenticator } from "../../interfaces/http/authentication.js";
import type { AccessTokenVerifier } from "./JoseJwtVerifier.js";
import { AuthenticationError } from "./errors.js";

const BEARER_PATTERN = /^Bearer ([A-Za-z0-9\-._~+/]+=*)$/;

export class BearerRequestAuthenticator
  implements RequestAuthenticator
{
  constructor(
    private readonly verifier: AccessTokenVerifier,
  ) {}

  async authenticate(
    request: FastifyRequest,
  ): Promise<TokenClaims> {
    const authorization = request.headers.authorization;
    const match = authorization?.match(BEARER_PATTERN);

    if (!match?.[1]) {
      throw new AuthenticationError();
    }

    return this.verifier.verify(match[1]);
  }
}
