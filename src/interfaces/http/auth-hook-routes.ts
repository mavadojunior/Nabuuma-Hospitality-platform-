import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
} from "fastify";
import {
  Webhook,
  WebhookVerificationError,
} from "standardwebhooks";

export interface AccessTokenHookEvent {
  readonly user_id: string;
  readonly claims: Readonly<Record<string, unknown>>;
  readonly authentication_method: string;
}

export interface AccessTokenHookResult {
  readonly claims: Readonly<Record<string, unknown>>;
}

export interface AccessTokenClaimsResolver {
  resolve(
    event: AccessTokenHookEvent,
  ): Promise<AccessTokenHookResult>;
}

export interface AuthHookRouteDependencies {
  readonly secret: string;
  readonly resolver: AccessTokenClaimsResolver;
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function header(
  request: FastifyRequest,
  name:
    | "webhook-id"
    | "webhook-timestamp"
    | "webhook-signature",
): string | undefined {
  const value = request.headers[name];

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseEvent(
  rawBody: string,
): AccessTokenHookEvent {
  let input: unknown;

  try {
    input = JSON.parse(rawBody);
  } catch {
    throw new TypeError(
      "Hook payload must contain valid JSON.",
    );
  }

  if (!isRecord(input)) {
    throw new TypeError(
      "Hook payload must be a JSON object.",
    );
  }

  const userId = input.user_id;
  const claims = input.claims;
  const authenticationMethod =
    input.authentication_method;

  if (
    typeof userId !== "string" ||
    userId.trim().length === 0 ||
    !isRecord(claims) ||
    typeof authenticationMethod !== "string" ||
    authenticationMethod.trim().length === 0
  ) {
    throw new TypeError(
      "Hook payload does not satisfy the access-token event contract.",
    );
  }

  return {
    user_id: userId,
    claims,
    authentication_method: authenticationMethod,
  };
}

export function createAuthHookPlugin(
  dependencies: AuthHookRouteDependencies,
): FastifyPluginAsync {
  return async function authHookPlugin(
    app: FastifyInstance,
  ): Promise<void> {
    app.removeContentTypeParser("application/json");

    app.addContentTypeParser(
      "application/json",
      { parseAs: "string" },
      (_request, body, done) => {
        done(null, body);
      },
    );

    const webhook =
      new Webhook(dependencies.secret);

    app.post<{ Body: string }>(
      "/internal/auth/hooks/custom-access-token",
      async (request, reply) => {
        const webhookId =
          header(request, "webhook-id");
        const webhookTimestamp =
          header(request, "webhook-timestamp");
        const webhookSignature =
          header(request, "webhook-signature");

        if (
          !webhookId ||
          !webhookTimestamp ||
          !webhookSignature
        ) {
          return reply.code(401).send({
            code: "INVALID_WEBHOOK_SIGNATURE",
            message:
              "Webhook authentication failed.",
          });
        }

        if (typeof request.body !== "string") {
          return reply.code(400).send({
            code: "INVALID_HOOK_PAYLOAD",
            message: "Invalid hook payload.",
          });
        }

        const rawBody = request.body;

        try {
          webhook.verify(rawBody, {
            "webhook-id": webhookId,
            "webhook-timestamp":
              webhookTimestamp,
            "webhook-signature":
              webhookSignature,
          });
        } catch (error) {
          if (
            error instanceof WebhookVerificationError
          ) {
            return reply.code(401).send({
              code: "INVALID_WEBHOOK_SIGNATURE",
              message:
                "Webhook authentication failed.",
            });
          }

          throw error;
        }

        let event: AccessTokenHookEvent;

        try {
          event = parseEvent(rawBody);
        } catch (error) {
          if (error instanceof TypeError) {
            return reply.code(400).send({
              code: "INVALID_HOOK_PAYLOAD",
              message: error.message,
            });
          }

          throw error;
        }

        try {
          const result =
            await dependencies.resolver.resolve(
              event,
            );

          if (!isRecord(result.claims)) {
            return reply.code(500).send({
              code: "AUTH_HOOK_RESOLUTION_FAILED",
              message:
                "Access-token claims could not be resolved.",
            });
          }

          return reply.code(200).send({
            claims: result.claims,
          });
        } catch {
          return reply.code(500).send({
            code: "AUTH_HOOK_RESOLUTION_FAILED",
            message:
              "Access-token claims could not be resolved.",
          });
        }
      },
    );
  };
}
