import { describe, expect, it, vi } from "vitest";
import type { FastifyRequest } from "fastify";
import {
  BearerRequestAuthenticator,
  AuthenticationError,
} from "../src/infrastructure/authentication";

function request(
  authorization?: string,
): FastifyRequest {
  return {
    headers:
      authorization === undefined
        ? {}
        : { authorization },
  } as FastifyRequest;
}

describe("BearerRequestAuthenticator", () => {
  it("rejects a missing Authorization header", async () => {
    const verifier = {
      verify: vi.fn(),
    };

    const authenticator =
      new BearerRequestAuthenticator(verifier);

    await expect(
      authenticator.authenticate(request()),
    ).rejects.toBeInstanceOf(AuthenticationError);

    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it.each([
    "",
    "Basic credentials",
    "Bearer",
    "Bearer ",
    "bearer token",
    "Bearer token extra",
  ])("rejects malformed credentials: %s", async (authorization) => {
    const verifier = {
      verify: vi.fn(),
    };

    const authenticator =
      new BearerRequestAuthenticator(verifier);

    await expect(
      authenticator.authenticate(request(authorization)),
    ).rejects.toBeInstanceOf(AuthenticationError);

    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it("passes only the bearer token to the verifier", async () => {
    const claims = {
      subject: "user-1",
      organisationId: "org-1",
      roles: ["LEARNER"],
    } as const;

    const verifier = {
      verify: vi.fn(async () => claims),
    };

    const authenticator =
      new BearerRequestAuthenticator(verifier);

    await expect(
      authenticator.authenticate(
        request("Bearer header.payload.signature"),
      ),
    ).resolves.toEqual(claims);

    expect(verifier.verify).toHaveBeenCalledWith(
      "header.payload.signature",
    );
  });
});
