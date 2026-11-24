import {
  toNodeHandler,
} from "@modelcontextprotocol/node";
import {
  createMcpHandler,
} from "@modelcontextprotocol/server";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";

import type {
  AcademyApplicationServices,
} from "../../bootstrap.js";
import type {
  RequestAuthenticator,
} from "../http/authentication.js";
import {
  mapHttpError,
} from "../http/errors.js";
import {
  createAcademyMcpServer,
} from "./academy-mcp-server.js";
import {
  isAllowedMcpRequestOrigin,
} from "./request-origin-guard.js";

export interface McpRouteDependencies {
  readonly services: AcademyApplicationServices;
  readonly authenticator: RequestAuthenticator;
}

async function sendAuthenticationFailure(
  reply: FastifyReply,
  error: unknown,
): Promise<FastifyReply> {
  const mapped = mapHttpError(error);

  return reply
    .code(mapped.statusCode)
    .send(mapped.body);
}

export async function registerMcpRoutes(
  app: FastifyInstance,
  dependencies: McpRouteDependencies,
): Promise<void> {
  app.all(
    "/mcp",
    async (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => {
      if (!isAllowedMcpRequestOrigin(request)) {
        return reply.code(403).send({
          error: {
            code: "MCP_ORIGIN_REJECTED",
            message: "MCP request origin is not allowed.",
          },
        });
      }

      let claims;

      try {
        claims =
          await dependencies.authenticator
            .authenticate(request);
      } catch (error) {
        return sendAuthenticationFailure(
          reply,
          error,
        );
      }

      const handler = createMcpHandler(
        () =>
          createAcademyMcpServer({
            services: dependencies.services,
            claims,
          }),
      );

      const nodeHandler =
        toNodeHandler(handler);

      reply.hijack();

      try {
        await nodeHandler(
          Object.assign(
            request.raw,
            {
              method: request.method,
              url: request.url,
            },
          ),
          reply.raw,
          request.body,
        );
      } finally {
        await handler.close();
      }

      return reply;
    },
  );
}
