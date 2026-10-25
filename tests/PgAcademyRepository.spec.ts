import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { PgAcademyRepository } from "../src/infrastructure/database/repositories/PgAcademyRepository";
import {
  DomainConstraintError,
} from "../src/domain/competency/errors";

const organisationId =
  "22222222-2222-4222-8222-222222222222";

const learnerId =
  "11111111-1111-4111-8111-111111111111";

function repositoryWith(
  rows: Record<string, unknown>[],
) {
  const query = vi.fn(
    async (_sql: string, _parameters?: readonly unknown[]) => ({
      rows,
    }),
  );

  const context = {
    client: {
      query,
    } as unknown as PoolClient,
    organisationId,
    claims: {
      subject: learnerId,
      organisationId,
      roles: ["LEARNER"],
    },
  } as any;

  return {
    repository: new PgAcademyRepository(context),
    query,
  };
}

describe("PgAcademyRepository lesson progress", () => {
  it("lists only organisation-scoped published lessons", async () => {
    const h = repositoryWith([]);

    await h.repository.listPublishedLessons("course-1");

    const [sql, parameters] = h.query.mock.calls[0]!;

    expect(sql).toContain(
      "FROM nabuuma.academy_lessons",
    );
    expect(sql).toContain(
      "organisation_id = $1",
    );
    expect(sql).toContain(
      "is_published = true",
    );
    expect(parameters).toEqual([
      organisationId,
      "course-1",
    ]);
  });

  it("derives learner and organisation from execution context", async () => {
    const h = repositoryWith([]);

    await h.repository.getLessonProgress(
      "enrolment-1",
      "lesson-1",
    );

    expect(h.query.mock.calls[0]?.[1]).toEqual([
      organisationId,
      learnerId,
      "enrolment-1",
      "lesson-1",
    ]);
  });

  it("uses an atomic conflict update for progress", async () => {
    const h = repositoryWith([
      {
        id: "progress-1",
        organisation_id: organisationId,
        learner_id: learnerId,
        course_id: "course-1",
        enrolment_id: "enrolment-1",
        lesson_id: "lesson-1",
        status: "IN_PROGRESS",
        progress_percent: 50,
        started_at: new Date(
          "2026-10-22T00:00:00.000Z",
        ),
        completed_at: null,
        last_activity_at: new Date(
          "2026-10-22T00:10:00.000Z",
        ),
      },
    ]);

    const result =
      await h.repository.saveLessonProgress({
        courseId: "course-1",
        enrolmentId: "enrolment-1",
        lessonId: "lesson-1",
        status: "IN_PROGRESS",
        progressPercent: 50,
      });

    const [sql, parameters] = h.query.mock.calls[0]!;

    expect(sql).toContain("ON CONFLICT");
    expect(sql).toContain("DO UPDATE SET");

    expect(parameters).toEqual([
      organisationId,
      learnerId,
      "course-1",
      "enrolment-1",
      "lesson-1",
      "IN_PROGRESS",
      50,
    ]);

    expect(result).toEqual({
      id: "progress-1",
      organisationId,
      learnerId,
      courseId: "course-1",
      enrolmentId: "enrolment-1",
      lessonId: "lesson-1",
      status: "IN_PROGRESS",
      progressPercent: 50,
      startedAt: "2026-10-22T00:00:00.000Z",
      lastActivityAt: "2026-10-22T00:10:00.000Z",
    });
  });

  it("surfaces a completed-state conflict when the guarded upsert returns no row", async () => {
    const h = repositoryWith([]);

    await expect(
      h.repository.saveLessonProgress({
        courseId: "course-1",
        enrolmentId: "enrolment-1",
        lessonId: "lesson-1",
        status: "IN_PROGRESS",
        progressPercent: 50,
      }),
    ).rejects.toBeInstanceOf(DomainConstraintError);
  });
});

describe("PgAcademyRepository certificate revocation", () => {
  it("executes the database-authoritative revocation function", async () => {
    const h = repositoryWith([
      {
        certificate_number: "NAB-TEST",
        revoked_at: new Date(
          "2026-10-25T05:00:00.000Z",
        ),
        newly_revoked: true,
      },
    ]);

    const result = await h.repository.revokeCertificate(
      "NAB-TEST",
      "Issued in error",
    );

    const [sql, parameters] = h.query.mock.calls[0]!;

    expect(sql).toContain(
      "FROM nabuuma.revoke_academy_certificate",
    );
    expect(parameters).toEqual([
      "NAB-TEST",
      "Issued in error",
    ]);

    expect(result).toEqual({
      certificateNumber: "NAB-TEST",
      revokedAt: "2026-10-25T05:00:00.000Z",
      newlyRevoked: true,
    });
  });

  it("fails closed when revocation returns no row", async () => {
    const h = repositoryWith([]);

    await expect(
      h.repository.revokeCertificate(
        "NAB-TEST",
        "Issued in error",
      ),
    ).rejects.toBeInstanceOf(
      DomainConstraintError,
    );
  });
});

describe("PgAcademyRepository completion", () => {
  it("executes atomic Academy course completion", async () => {
    const h = repositoryWith([
      {
        id: "certificate-1",
        organisation_id: organisationId,
        learner_id: learnerId,
        course_id: "course-1",
        enrolment_id: "enrolment-1",
        certificate_number: "NAB-TEST",
        issued_at: new Date("2026-10-24T00:00:00.000Z"),
        issued_by_id: null,
        metadata: {
          completion_source: "academy_course_completion",
        },
      },
    ]);

    const certificate = await h.repository.completeCourse(
      "course-1",
      "enrolment-1",
    );

    const [sql, parameters] = h.query.mock.calls[0]!;

    expect(sql).toContain(
      "FROM nabuuma.complete_academy_course",
    );
    expect(parameters).toEqual([
      "course-1",
      "enrolment-1",
    ]);

    expect(certificate).toEqual({
      id: "certificate-1",
      organisationId,
      learnerId,
      courseId: "course-1",
      enrolmentId: "enrolment-1",
      certificateNumber: "NAB-TEST",
      issuedAt: "2026-10-24T00:00:00.000Z",
      metadata: {
        completion_source: "academy_course_completion",
      },
    });
  });
});

describe("PgAcademyRepository certificates", () => {
  const certificateRow = {
    id: "certificate-1",
    organisation_id: organisationId,
    learner_id: learnerId,
    course_id: "course-1",
    enrolment_id: "enrolment-1",
    certificate_number: "NAB-TEST",
    issued_at: new Date(
      "2026-10-24T00:00:00.000Z",
    ),
    issued_by_id: null,
    metadata: {
      completion_source: "academy_course_completion",
    },
  };

  it("lists only certificates owned by the execution context", async () => {
    const h = repositoryWith([certificateRow]);

    const certificates =
      await h.repository.listCertificates();

    const [sql, parameters] = h.query.mock.calls[0]!;

    expect(sql).toContain(
      "FROM nabuuma.academy_certificates",
    );
    expect(sql).toContain("organisation_id = $1");
    expect(sql).toContain("learner_id = $2");

    expect(parameters).toEqual([
      organisationId,
      learnerId,
    ]);

    expect(certificates).toEqual([
      {
        id: "certificate-1",
        organisationId,
        learnerId,
        courseId: "course-1",
        enrolmentId: "enrolment-1",
        certificateNumber: "NAB-TEST",
        issuedAt: "2026-10-24T00:00:00.000Z",
        metadata: {
          completion_source:
            "academy_course_completion",
        },
      },
    ]);
  });

  it("gets a certificate through tenant and learner ownership", async () => {
    const h = repositoryWith([certificateRow]);

    const certificate =
      await h.repository.getCertificateById(
        "certificate-1",
      );

    const [sql, parameters] = h.query.mock.calls[0]!;

    expect(sql).toContain("organisation_id = $1");
    expect(sql).toContain("learner_id = $2");
    expect(sql).toContain("id = $3");

    expect(parameters).toEqual([
      organisationId,
      learnerId,
      "certificate-1",
    ]);

    expect(certificate?.id).toBe("certificate-1");
  });

  it("returns null when certificate ownership is not visible", async () => {
    const h = repositoryWith([]);

    await expect(
      h.repository.getCertificateById(
        "certificate-foreign",
      ),
    ).resolves.toBeNull();
  });
});
