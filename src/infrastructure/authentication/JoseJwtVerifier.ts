import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
} from "jose";
import type { TokenClaims } from "../security/security.js";
import type { JWTPayload } from "jose";
import type { JwtAuthenticationConfig } from "./config.js";
import { mapJwtPayloadToTokenClaims } from "./claims.js";
import { AuthenticationError } from "./errors.js";

export interface AccessTokenVerifier {
  verify(token: string): Promise<TokenClaims>;
}

export interface VerifiedJwtPayload {
  readonly issuer: string;
  readonly subject: string;
  readonly audience: string | readonly string[];
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly rawClaims: Readonly<Record<string, unknown>>;
}

export interface VerifiedJwtPayloadVerifier {
  verifyPayload(token: string): Promise<VerifiedJwtPayload>;
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

  async verifyPayload(token: string): Promise<VerifiedJwtPayload> {
    try {
      const result = await jwtVerify(token, this.keySet, {
        issuer: this.config.issuer,
        audience: this.config.audience,
        algorithms: [...this.config.algorithms],
        requiredClaims: ["sub", "exp", "iat"],
      });
      const payload: JWTPayload = result.payload;
      if (
        typeof payload.iss !== "string" ||
        typeof payload.sub !== "string" ||
        (typeof payload.aud !== "string" &&
          (!Array.isArray(payload.aud) || !payload.aud.every((item) => typeof item === "string"))) ||
        typeof payload.iat !== "number" ||
        typeof payload.exp !== "number"
      ) throw new AuthenticationError();
      return {
        issuer: payload.iss,
        subject: payload.sub,
        audience: payload.aud,
        issuedAt: payload.iat,
        expiresAt: payload.exp,
        rawClaims: payload as Readonly<Record<string, unknown>>,
      };
    } catch {
      throw new AuthenticationError();
    }
  }

  async verify(token: string): Promise<TokenClaims> {
    try {
      const verified = await this.verifyPayload(token);
      return mapJwtPayloadToTokenClaims(verified.rawClaims as JWTPayload);
    } catch {
      throw new AuthenticationError();
    }
  }
}
