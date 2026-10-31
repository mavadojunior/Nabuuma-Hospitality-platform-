import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import Fastify from "fastify";
import {
  Webhook,
} from "standardwebhooks";

import {
  createAuthHookPlugin,
  type AccessTokenClaimsResolver,
} from "../src/interfaces/http/auth-hook-routes";

const SECRET =
  "whsec_dGVzdC1hdXRoLWhvb2stc2VjcmV0LTIwMjY";

const USER_ID =
  "11111111-1111-4111-8111-111111111111";

const ORGANISATION_ID =
  "22222222-2222-4222-8222-222222222222";

const EVENT = {
  user_id: USER_ID,
  authentication_method: "password",
  claims: {
    iss: "https://issuer.example.test/auth/v1",
    aud: "authenticated",
    exp: 2_000_000_000,
    iat: 1_900_000_000,
    sub: USER_ID,
    role: "authenticated",
    aal: "aal1",
    session_id:
      "33333333-3333-4333-8333-333333333333",
    email: "learner@example.test",
    phone: "",
    is_anonymous: false,
  },
} as const;

function createResolver() {
  const resolve = vi.fn(
    async () => ({
      claims: {
        ...EVENT.claims,
        organisation_id: ORGANISATION_ID,
        roles: ["LEARNER"],
      },
    }),
  );

  return {
    resolver: {
      resolve,
    } as AccessTokenClaimsResolver,
    resolve,
  };
}

function signedHeaders(
  payload: string,
): Record<string, string> {
  const webhook = new Webhook(SECRET);
  const messageId =
    "msg_nabuuma_auth_hook_test";
  const timestamp = new Date();

  const signature = webhook.sign(
    messageId,
    timestamp,
    payload,
  );

  return {
    "content-type": "application/json",
    "webhook-id": messageId,
    "webhook-timestamp":
      Math.floor(
        timestamp.getTime() / 1000,
      ).toString(),
    "webhook-signature": signature,
  };
}

async function createHarness() {
  const app = Fastify({
    logger: false,
  });

  const h = createResolver();

  await app.register(
    createAuthHookPlugin({
      secret: SECRET,
      resolver: h.resolver,
    }),
  );

  await app.ready();

  return {
    app,
    ...h,
  };
}

describe("Custom access-token Auth Hook HTTP API", () => {
  it("accepts a valid signed hook and returns resolved claims", async () => {
    const h = await createHarness();
    const payload = JSON.stringify(EVENT);

    try {
      const response = await h.app.inject({
        method: "POST",
        url:
          "/internal/auth/hooks/custom-access-token",
        headers: signedHeaders(payload),
        payload,
      });

      expect(response.statusCode).toBe(200);

      expect(response.json()).toEqual({
        claims: {
          ...EVENT.claims,
          organisation_id: ORGANISATION_ID,
          roles: ["LEARNER"],
        },
      });

      expect(h.resolve).toHaveBeenCalledOnce();
      expect(h.resolve).toHaveBeenCalledWith(EVENT);
    } finally {
      await h.app.close();
    }
  });

  it("rejects a tampered signature before claim resolution", async () => {
    const h = await createHarness();
    const payload = JSON.stringify(EVENT);
    const headers = signedHeaders(payload);

    headers["webhook-signature"] =
      "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

    try {
      const response = await h.app.inject({
        method: "POST",
        url:
          "/internal/auth/hooks/custom-access-token",
        headers,
        payload,
      });

      expect(response.statusCode).toBe(401);

      expect(response.json()).toEqual({
        code: "INVALID_WEBHOOK_SIGNATURE",
        message: "Webhook authentication failed.",
      });

      expect(h.resolve).not.toHaveBeenCalled();
    } finally {
      await h.app.close();
    }
  });

  it("rejects missing signing headers before claim resolution", async () => {
    const h = await createHarness();

    try {
      const response = await h.app.inject({
        method: "POST",
        url:
          "/internal/auth/hooks/custom-access-token",
        headers: {
          "content-type": "application/json",
        },
        payload: JSON.stringify(EVENT),
      });

      expect(response.statusCode).toBe(401);

      expect(response.json()).toEqual({
        code: "INVALID_WEBHOOK_SIGNATURE",
        message: "Webhook authentication failed.",
      });

      expect(h.resolve).not.toHaveBeenCalled();
    } finally {
      await h.app.close();
    }
  });

  it("rejects a body altered after signing", async () => {
    const h = await createHarness();
    const payload = JSON.stringify(EVENT);

    const alteredPayload = JSON.stringify({
      ...EVENT,
      user_id:
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });

    try {
      const response = await h.app.inject({
        method: "POST",
        url:
          "/internal/auth/hooks/custom-access-token",
        headers: signedHeaders(payload),
        payload: alteredPayload,
      });

      expect(response.statusCode).toBe(401);
      expect(h.resolve).not.toHaveBeenCalled();
    } finally {
      await h.app.close();
    }
  });

  it("rejects a signed malformed event", async () => {
    const h = await createHarness();

    const payload = JSON.stringify({
      user_id: USER_ID,
      authentication_method: "password",
      claims: [],
    });

    try {
      const response = await h.app.inject({
        method: "POST",
        url:
          "/internal/auth/hooks/custom-access-token",
        headers: signedHeaders(payload),
        payload,
      });

      expect(response.statusCode).toBe(400);

      expect(response.json()).toEqual({
        code: "INVALID_HOOK_PAYLOAD",
        message:
          "Hook payload does not satisfy the access-token event contract.",
      });

      expect(h.resolve).not.toHaveBeenCalled();
    } finally {
      await h.app.close();
    }
  });

  it("does not leak resolver failures", async () => {
    const app = Fastify({
      logger: false,
    });

    const resolve = vi.fn(async () => {
      throw new Error(
        "sensitive PostgreSQL implementation detail",
      );
    });

    await app.register(
      createAuthHookPlugin({
        secret: SECRET,
        resolver: {
          resolve,
        },
      }),
    );

    await app.ready();

    const payload = JSON.stringify(EVENT);

    try {
      const response = await app.inject({
        method: "POST",
        url:
          "/internal/auth/hooks/custom-access-token",
        headers: signedHeaders(payload),
        payload,
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(
        500,
      );

      expect(response.body).not.toContain(
        "sensitive PostgreSQL implementation detail",
      );

      expect(resolve).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });

  it("keeps ordinary Fastify JSON parsing encapsulated outside the hook plugin", async () => {
    const app = Fastify({
      logger: false,
    });

    app.post(
      "/ordinary-json",
      async (request) => ({
        body: request.body,
      }),
    );

    const h = createResolver();

    await app.register(
      createAuthHookPlugin({
        secret: SECRET,
        resolver: h.resolver,
      }),
    );

    await app.ready();

    try {
      const response = await app.inject({
        method: "POST",
        url: "/ordinary-json",
        headers: {
          "content-type": "application/json",
        },
        payload: JSON.stringify({
          ordinary: true,
        }),
      });

      expect(response.statusCode).toBe(200);

      expect(response.json()).toEqual({
        body: {
          ordinary: true,
        },
      });
    } finally {
      await app.close();
    }
  });
});
