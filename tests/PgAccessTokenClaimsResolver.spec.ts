import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type {
  Pool,
  PoolClient,
} from "pg";
import {
  AccessTokenClaimResolutionError,
  PgAccessTokenClaimsResolver,
  type CustomAccessTokenEvent,
} from "../src/infrastructure/authentication/PgAccessTokenClaimsResolver";

const EVENT: CustomAccessTokenEvent = {
  user_id: "11111111-1111-4111-8111-111111111111",
  authentication_method: "password",
  claims: {
    sub: "11111111-1111-4111-8111-111111111111",
    aud: "authenticated",
    role: "authenticated",
  },
};

function createHarness(result: unknown) {
  const query = vi.fn(async () => ({
    rows: [{ result }],
  })) as unknown as PoolClient["query"];

  const release = vi.fn();

  const client = {
    query,
    release,
  } as unknown as PoolClient;

  const pool = {
    connect: vi.fn(async () => client),
  } as unknown as Pool;

  return {
    resolver: new PgAccessTokenClaimsResolver(pool),
    query,
    release,
  };
}

describe("PgAccessTokenClaimsResolver", () => {
  it("returns the trusted claims projection", async () => {
    const h = createHarness({
      claims: {
        ...EVENT.claims,
        organisation_id:
          "22222222-2222-4222-8222-222222222222",
        roles: ["LEARNER"],
      },
    });

    await expect(
      h.resolver.resolve(EVENT),
    ).resolves.toEqual({
      claims: {
        ...EVENT.claims,
        organisation_id:
          "22222222-2222-4222-8222-222222222222",
        roles: ["LEARNER"],
      },
    });

    expect(h.release).toHaveBeenCalledOnce();
  });

  it("passes the event only as a JSONB parameter", async () => {
    const h = createHarness({
      claims: EVENT.claims,
    });

    await h.resolver.resolve(EVENT);

    expect(h.query).toHaveBeenCalledOnce();

    expect(h.query).toHaveBeenCalledWith(
      expect.stringContaining(
        "nabuuma.custom_access_token_hook",
      ),
      [JSON.stringify(EVENT)],
    );

    expect(h.query).toHaveBeenCalledWith(
      expect.stringContaining("$1::jsonb"),
      [JSON.stringify(EVENT)],
    );

    expect(h.query).not.toHaveBeenCalledWith(
      expect.stringContaining(EVENT.user_id),
      expect.anything(),
    );
  });

  it("rejects an empty database result", async () => {
    const query = vi.fn(async () => ({
      rows: [],
    })) as unknown as PoolClient["query"];

    const release = vi.fn();

    const pool = {
      connect: vi.fn(async () => ({
        query,
        release,
      })),
    } as unknown as Pool;

    const resolver =
      new PgAccessTokenClaimsResolver(pool);

    await expect(
      resolver.resolve(EVENT),
    ).rejects.toBeInstanceOf(
      AccessTokenClaimResolutionError,
    );

    expect(release).toHaveBeenCalledOnce();
  });

  it("rejects a malformed hook result", async () => {
    const h = createHarness({
      claims: ["not", "an", "object"],
    });

    await expect(
      h.resolver.resolve(EVENT),
    ).rejects.toBeInstanceOf(
      AccessTokenClaimResolutionError,
    );

    expect(h.release).toHaveBeenCalledOnce();
  });

  it("propagates database failures and releases the client", async () => {
    const query = vi.fn(async () => {
      throw new Error("claim resolution failed");
    }) as unknown as PoolClient["query"];

    const release = vi.fn();

    const pool = {
      connect: vi.fn(async () => ({
        query,
        release,
      })),
    } as unknown as Pool;

    const resolver =
      new PgAccessTokenClaimsResolver(pool);

    await expect(
      resolver.resolve(EVENT),
    ).rejects.toThrow(
      "claim resolution failed",
    );

    expect(release).toHaveBeenCalledOnce();
  });
});
