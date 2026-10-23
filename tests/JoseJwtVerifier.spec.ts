import { describe, expect, it } from "vitest";
import {
  generateKeyPair,
  SignJWT,
  type JWTVerifyGetKey,
} from "jose";
import {
  AuthenticationError,
  JoseJwtVerifier,
  type JwtAuthenticationConfig,
} from "../src/infrastructure/authentication";

const config: JwtAuthenticationConfig = {
  issuer: "https://identity.example.test",
  audience: "nabuuma-api",
  jwksUri: "https://identity.example.test/.well-known/jwks.json",
  algorithms: ["RS256"],
};

const subject = "11111111-1111-4111-8111-111111111111";
const organisationId = "22222222-2222-4222-8222-222222222222";

async function createHarness() {
  const { privateKey, publicKey } = await generateKeyPair("RS256");

  const keySet: JWTVerifyGetKey = async () => publicKey;
  const verifier = new JoseJwtVerifier(config, keySet);

  const sign = async (
    overrides: {
      issuer?: string;
      audience?: string;
      organisationId?: string;
      roles?: readonly string[];
      expiresIn?: string;
    } = {},
  ): Promise<string> => {
    return new SignJWT({
      organisation_id:
        overrides.organisationId ?? organisationId,
      roles: overrides.roles ?? ["LEARNER"],
    })
      .setProtectedHeader({ alg: "RS256" })
      .setSubject(subject)
      .setIssuer(overrides.issuer ?? config.issuer)
      .setAudience(overrides.audience ?? config.audience)
      .setIssuedAt()
      .setExpirationTime(overrides.expiresIn ?? "5m")
      .sign(privateKey);
  };

  return { verifier, sign };
}

describe("JoseJwtVerifier", () => {
  it("verifies a signed JWT and returns trusted application claims", async () => {
    const h = await createHarness();
    const token = await h.sign();

    await expect(h.verifier.verify(token)).resolves.toEqual({
      subject,
      organisationId,
      roles: ["LEARNER"],
    });
  });

  it("rejects a token signed by an untrusted key", async () => {
    const h = await createHarness();
    const { privateKey } = await generateKeyPair("RS256");

    const token = await new SignJWT({
      organisation_id: organisationId,
      roles: ["LEARNER"],
    })
      .setProtectedHeader({ alg: "RS256" })
      .setSubject(subject)
      .setIssuer(config.issuer)
      .setAudience(config.audience)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    await expect(
      h.verifier.verify(token),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rejects the wrong issuer", async () => {
    const h = await createHarness();

    await expect(
      h.verifier.verify(
        await h.sign({
          issuer: "https://attacker.example.test",
        }),
      ),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rejects the wrong audience", async () => {
    const h = await createHarness();

    await expect(
      h.verifier.verify(
        await h.sign({
          audience: "different-api",
        }),
      ),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rejects an expired token", async () => {
    const h = await createHarness();

    await expect(
      h.verifier.verify(
        await h.sign({ expiresIn: "-1s" }),
      ),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rejects an unsupported application role", async () => {
    const h = await createHarness();

    await expect(
      h.verifier.verify(
        await h.sign({ roles: ["ADMIN"] }),
      ),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("rejects a token without an organisation", async () => {
    const { privateKey, publicKey } =
      await generateKeyPair("RS256");

    const verifier = new JoseJwtVerifier(
      config,
      async () => publicKey,
    );

    const token = await new SignJWT({
      roles: ["LEARNER"],
    })
      .setProtectedHeader({ alg: "RS256" })
      .setSubject(subject)
      .setIssuer(config.issuer)
      .setAudience(config.audience)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    await expect(
      verifier.verify(token),
    ).rejects.toBeInstanceOf(AuthenticationError);
  });
});
