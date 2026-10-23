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
