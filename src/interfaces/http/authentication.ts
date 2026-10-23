import type { FastifyRequest } from "fastify";
import type { TokenClaims } from "../../infrastructure/security/security";

export interface RequestAuthenticator {
  authenticate(request: FastifyRequest): Promise<TokenClaims>;
}
