import type { FastifyInstance } from "fastify";
import type {
  CertificateVerification,
} from "../../infrastructure/database/PgCertificateVerifier.js";

export interface CertificateVerifier {
  verify(
    certificateNumber: string,
  ): Promise<CertificateVerification | null>;
}

interface VerificationParams {
  certificateNumber: string;
}

export async function registerCertificateVerificationRoutes(
  app: FastifyInstance,
  verifier: CertificateVerifier,
): Promise<void> {
  app.get<{ Params: VerificationParams }>(
    "/api/v1/academy/certificates/:certificateNumber/verification",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["certificateNumber"],
          properties: {
            certificateNumber: {
              type: "string",
              minLength: 1,
              maxLength: 128,
              pattern: "^NAB-[A-Za-z0-9-]+$",
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const verification = await verifier.verify(
          request.params.certificateNumber,
        );

        if (!verification) {
          return reply.code(200).send({
            data: {
              valid: false,
            },
          });
        }

        return reply.code(200).send({
          data: verification,
        });
      } catch {
        return reply.code(500).send({
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred.",
        });
      }
    },
  );
}
