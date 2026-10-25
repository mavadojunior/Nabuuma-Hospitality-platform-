import {
  AcademyCertificateNotFoundError,
  AcademyCourseUnavailableError,
  InvalidAcademyLessonProgressError,
} from "../../application/academy/index.js";
import { AuthenticationError } from "../../infrastructure/authentication/errors.js";
import {
  DomainConstraintError,
  TenantBoundaryViolationError,
} from "../../domain/competency/errors.js";

export interface HttpError {
  readonly statusCode: number;
  readonly body: {
    readonly code: string;
    readonly message: string;
  };
}

export function mapHttpError(error: unknown): HttpError {
  if (error instanceof AuthenticationError) {
    return {
      statusCode: 401,
      body: {
        code: "UNAUTHENTICATED",
        message: "Authentication required.",
      },
    };
  }

  if (error instanceof AcademyCourseUnavailableError) {
    return {
      statusCode: 404,
      body: {
        code: "ACADEMY_COURSE_NOT_FOUND",
        message: "The requested Academy course is unavailable.",
      },
    };
  }

  if (error instanceof AcademyCertificateNotFoundError) {
    return {
      statusCode: 404,
      body: {
        code: "ACADEMY_CERTIFICATE_NOT_FOUND",
        message: "The requested Academy certificate was not found.",
      },
    };
  }

  if (error instanceof InvalidAcademyLessonProgressError) {
    return {
      statusCode: 400,
      body: {
        code: "INVALID_ACADEMY_LESSON_PROGRESS",
        message: "The Academy lesson progress transition is invalid.",
      },
    };
  }

  if (error instanceof TenantBoundaryViolationError) {
    return {
      statusCode: 403,
      body: {
        code: "FORBIDDEN",
        message: "The requested operation is not permitted.",
      },
    };
  }

  if (error instanceof DomainConstraintError) {
    return {
      statusCode: 409,
      body: {
        code: "CONFLICT",
        message: "The requested operation conflicts with existing state.",
      },
    };
  }

  return {
    statusCode: 500,
    body: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
    },
  };
}
