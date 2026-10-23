import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";
import type { TokenClaims } from "../security/security";
import type { JwtAuthenticationConfig } from "./config";
import { mapJwtPayloadToTokenClaims } from "./claims";
import { AuthenticationError } from "./errors";

export interface AccessTokenVerifier {
  verify(token: string): Promise<TokenClaims>;
}

export class JoseJwtVerifier implements AccessTokenVerifier {
  private readonly keySet: JWTVerifyGetKey;

  constructor(
    private readonly config: JwtAuthenticationConfig,
    keySet?: JWTVerifyGetKey,
  ) {
    this.keySet =
      keySet ??
      createRemoteJWKSet(new URL(config.jwksUri));
  }

  async verify(token: string): Promise<TokenClaims> {
    try {
      const result = await jwtVerify(token, this.keySet, {
        issuer: this.config.issuer,
        audience: this.config.audience,
        algorithms: [...this.config.algorithms],
        requiredClaims: [
          "sub",
          "exp",
          "iat",
          "organisation_id",
          "roles",
        ],
      });

      return mapJwtPayloadToTokenClaims(result.payload);
    } catch {
      throw new AuthenticationError();
    }
  }
}
