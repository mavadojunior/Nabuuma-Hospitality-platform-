import {
  McpServer,
} from "@modelcontextprotocol/server";
import {
  z,
} from "zod/v4";

import type {
  AcademyApplicationServices,
} from "../../bootstrap.js";
import type {
  TokenClaims,
} from "../../infrastructure/security/security.js";

export const LIST_PUBLISHED_COURSES_TOOL =
  "list_published_courses";

export const LIST_COURSE_LESSONS_TOOL =
  "list_course_lessons";

export const LIST_ACADEMY_CERTIFICATES_TOOL =
  "list_academy_certificates";

export const GET_ACADEMY_CERTIFICATE_TOOL =
  "get_academy_certificate";

export const ENROL_IN_ACADEMY_COURSE_TOOL =
  "enrol_in_academy_course";

export interface AcademyMcpServerDependencies {
  readonly services: AcademyApplicationServices;
  readonly claims: TokenClaims;
}

function serialiseToolResult(
  value: unknown,
): {
  readonly content: [{
    readonly type: "text";
    readonly text: string;
  }];
} {
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        data: value,
      }),
    }],
  };
}

function sanitisedToolFailure(): {
  readonly isError: true;
  readonly content: [{
    readonly type: "text";
    readonly text: string;
  }];
} {
  return {
    isError: true,
    content: [{
      type: "text",
      text: JSON.stringify({
        error: {
          code: "MCP_TOOL_EXECUTION_FAILED",
          message:
            "The requested Academy operation could not be completed.",
        },
      }),
    }],
  };
}

export function createAcademyMcpServer(
  dependencies: AcademyMcpServerDependencies,
): McpServer {
  const server = new McpServer({
    name: "nabuuma-hospitality",
    version: "1.0.0",
  });

  server.registerTool(
    LIST_PUBLISHED_COURSES_TOOL,
    {
      description:
        "List published Academy courses visible to the authenticated caller.",
      inputSchema: {},
    },
    async () => {
      try {
        const courses =
          await dependencies.services
            .listPublishedAcademyCoursesUseCase
            .execute(dependencies.claims);

        return serialiseToolResult(courses);
      } catch {
        return sanitisedToolFailure();
      }
    },
  );

  server.registerTool(
    LIST_COURSE_LESSONS_TOOL,
    {
      description:
        "List published lessons for a course visible to the authenticated caller.",
      inputSchema: {
        courseId: z
          .string()
          .uuid(),
      },
    },
    async ({ courseId }) => {
      try {
        const lessons =
          await dependencies.services
            .listAcademyLessonsUseCase
            .execute(
              courseId,
              dependencies.claims,
            );

        return serialiseToolResult(lessons);
      } catch {
        return sanitisedToolFailure();
      }
    },
  );

  server.registerTool(
    LIST_ACADEMY_CERTIFICATES_TOOL,
    {
      description:
        "List Academy certificates visible to the authenticated caller.",
      inputSchema: {},
    },
    async () => {
      try {
        const certificates =
          await dependencies.services
            .listAcademyCertificatesUseCase
            .execute(dependencies.claims);

        return serialiseToolResult(
          certificates,
        );
      } catch {
        return sanitisedToolFailure();
      }
    },
  );

  server.registerTool(
    GET_ACADEMY_CERTIFICATE_TOOL,
    {
      description:
        "Get an Academy certificate visible to the authenticated caller.",
      inputSchema: {
        certificateId: z
          .string()
          .uuid(),
      },
    },
    async ({ certificateId }) => {
      try {
        const certificate =
          await dependencies.services
            .getAcademyCertificateUseCase
            .execute(
              certificateId,
              dependencies.claims,
            );

        return serialiseToolResult(
          certificate,
        );
      } catch {
        return sanitisedToolFailure();
      }
    },
  );

  server.registerTool(
    ENROL_IN_ACADEMY_COURSE_TOOL,
    {
      description:
        "Enrol the authenticated learner in a visible Academy course.",
      inputSchema: {
        courseId: z
          .string()
          .uuid(),
      },
    },
    async ({ courseId }) => {
      try {
        const enrolment =
          await dependencies.services
            .enrolInAcademyCourseUseCase
            .execute(
              courseId,
              dependencies.claims,
            );

        return serialiseToolResult(
          enrolment,
        );
      } catch {
        return sanitisedToolFailure();
      }
    },
  );

  return server;
}
