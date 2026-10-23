import type { FastifyRequest } from "fastify";
import type { TokenClaims } from "../security/security";
import type { RequestAuthenticator } from "../../interfaces/http/authentication";
import type { AccessTokenVerifier } from "./JoseJwtVerifier";
import { AuthenticationError } from "./errors";

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
