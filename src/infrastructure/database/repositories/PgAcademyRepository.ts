import type {
  AcademyCourse,
  AcademyEnrolment,
  AcademyLesson,
  AcademyLessonProgress,
  AcademyRepository,
  SaveAcademyLessonProgressInput,
} from "../../../domain/academy";
import type { UUID } from "../../../domain/competency/repositories/contracts";
import type { PgExecutionContext } from "../transaction";
import { mapPgError } from "../error-mapping";

interface AcademyCourseRow {
  id: string;
  organisation_id: string;
  stable_key: string;
  version: number;
  title: string;
  description: string;
  is_published: boolean;
}

interface AcademyEnrolmentRow {
  id: string;
  organisation_id: string;
  learner_id: string;
  course_id: string;
  status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  enrolled_at: Date | string;
  completed_at: Date | string | null;
}

interface AcademyLessonRow {
  id: string;
  organisation_id: string;
  course_id: string;
  stable_key: string;
  title: string;
  content: Record<string, unknown>;
  sequence_number: number;
  estimated_duration_minutes: number | null;
  is_published: boolean;
}

interface AcademyLessonProgressRow {
  id: string;
  organisation_id: string;
  learner_id: string;
  course_id: string;
  enrolment_id: string;
  lesson_id: string;
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
  progress_percent: number;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  last_activity_at: Date | string;
}

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function mapCourse(row: AcademyCourseRow): AcademyCourse {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    stableKey: row.stable_key,
    version: row.version,
    title: row.title,
    description: row.description,
    isPublished: row.is_published,
  };
}

function mapEnrolment(row: AcademyEnrolmentRow): AcademyEnrolment {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    learnerId: row.learner_id,
    courseId: row.course_id,
    status: row.status,
    enrolledAt: timestamp(row.enrolled_at),
    ...(row.completed_at === null
      ? {}
      : { completedAt: timestamp(row.completed_at) }),
  };
}

function mapLesson(row: AcademyLessonRow): AcademyLesson {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    courseId: row.course_id,
    stableKey: row.stable_key,
    title: row.title,
    content: row.content ?? {},
    sequenceNumber: row.sequence_number,
    ...(row.estimated_duration_minutes === null
      ? {}
      : {
          estimatedDurationMinutes:
            row.estimated_duration_minutes,
        }),
    isPublished: row.is_published,
  };
}

function mapLessonProgress(
  row: AcademyLessonProgressRow,
): AcademyLessonProgress {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    learnerId: row.learner_id,
    courseId: row.course_id,
    enrolmentId: row.enrolment_id,
    lessonId: row.lesson_id,
    status: row.status,
    progressPercent: row.progress_percent,
    ...(row.started_at === null
      ? {}
      : { startedAt: timestamp(row.started_at) }),
    ...(row.completed_at === null
      ? {}
      : { completedAt: timestamp(row.completed_at) }),
    lastActivityAt: timestamp(row.last_activity_at),
  };
}

export class PgAcademyRepository implements AcademyRepository {
  constructor(private readonly context: PgExecutionContext) {}

  async listPublishedCourses(): Promise<AcademyCourse[]> {
    try {
      const result = await this.context.client.query<AcademyCourseRow>(
        `
          SELECT
            id,
            organisation_id,
            stable_key,
            version,
            title,
            description,
            is_published
          FROM nabuuma.academy_courses
          WHERE organisation_id = $1
            AND is_published = true
          ORDER BY stable_key ASC, version DESC
        `,
        [this.context.organisationId],
      );

      return result.rows.map(mapCourse);
    } catch (error) {
      throw mapPgError(error, "academy");
    }
  }

  async getCourseById(courseId: UUID): Promise<AcademyCourse | null> {
    try {
      const result = await this.context.client.query<AcademyCourseRow>(
        `
          SELECT
            id,
            organisation_id,
            stable_key,
            version,
            title,
            description,
            is_published
          FROM nabuuma.academy_courses
          WHERE organisation_id = $1
            AND id = $2
            AND is_published = true
          LIMIT 1
        `,
        [this.context.organisationId, courseId],
      );

      const row = result.rows[0];
      return row ? mapCourse(row) : null;
    } catch (error) {
      throw mapPgError(error, "academy");
    }
  }

  async enrol(courseId: UUID): Promise<AcademyEnrolment> {
    try {
      const result = await this.context.client.query<AcademyEnrolmentRow>(
        `
          INSERT INTO nabuuma.academy_enrolments (
            organisation_id,
            learner_id,
            course_id,
            status
          )
          VALUES ($1, $2, $3, 'ACTIVE')
          RETURNING
            id,
            organisation_id,
            learner_id,
            course_id,
            status,
            enrolled_at,
            completed_at
        `,
        [
          this.context.organisationId,
          this.context.claims.subject,
          courseId,
        ],
      );

      const row = result.rows[0];
      if (!row) {
        throw new Error("Academy enrolment insert returned no row.");
      }

      return mapEnrolment(row);
    } catch (error) {
      throw mapPgError(error, "academy");
    }
  }

  async getEnrolment(courseId: UUID): Promise<AcademyEnrolment | null> {
    try {
      const result = await this.context.client.query<AcademyEnrolmentRow>(
        `
          SELECT
            id,
            organisation_id,
            learner_id,
            course_id,
            status,
            enrolled_at,
            completed_at
          FROM nabuuma.academy_enrolments
          WHERE organisation_id = $1
            AND learner_id = $2
            AND course_id = $3
          LIMIT 1
        `,
        [
          this.context.organisationId,
          this.context.claims.subject,
          courseId,
        ],
      );

      const row = result.rows[0];
      return row ? mapEnrolment(row) : null;
    } catch (error) {
      throw mapPgError(error, "academy");
    }
  }

  async listPublishedLessons(
    courseId: UUID,
  ): Promise<AcademyLesson[]> {
    try {
      const result =
        await this.context.client.query<AcademyLessonRow>(
          `
            SELECT
              id,
              organisation_id,
              course_id,
              stable_key,
              title,
              content,
              sequence_number,
              estimated_duration_minutes,
              is_published
            FROM nabuuma.academy_lessons
            WHERE organisation_id = $1
              AND course_id = $2
              AND is_published = true
            ORDER BY sequence_number ASC, id ASC
          `,
          [
            this.context.organisationId,
            courseId,
          ],
        );

      return result.rows.map(mapLesson);
    } catch (error) {
      throw mapPgError(error, "academy");
    }
  }

  async getLessonProgress(
    enrolmentId: UUID,
    lessonId: UUID,
  ): Promise<AcademyLessonProgress | null> {
    try {
      const result =
        await this.context.client.query<AcademyLessonProgressRow>(
          `
            SELECT
              id,
              organisation_id,
              learner_id,
              course_id,
              enrolment_id,
              lesson_id,
              status,
              progress_percent,
              started_at,
              completed_at,
              last_activity_at
            FROM nabuuma.academy_lesson_progress
            WHERE organisation_id = $1
              AND learner_id = $2
              AND enrolment_id = $3
              AND lesson_id = $4
            LIMIT 1
          `,
          [
            this.context.organisationId,
            this.context.claims.subject,
            enrolmentId,
            lessonId,
          ],
        );

      const row = result.rows[0];

      return row ? mapLessonProgress(row) : null;
    } catch (error) {
      throw mapPgError(error, "academy");
    }
  }

  async saveLessonProgress(
    input: SaveAcademyLessonProgressInput,
  ): Promise<AcademyLessonProgress> {
    try {
      const result =
        await this.context.client.query<AcademyLessonProgressRow>(
          `
            INSERT INTO nabuuma.academy_lesson_progress (
              organisation_id,
              learner_id,
              course_id,
              enrolment_id,
              lesson_id,
              status,
              progress_percent,
              started_at,
              completed_at,
              last_activity_at
            )
            VALUES (
              $1,
              $2,
              $3,
              $4,
              $5,
              $6,
              $7,
              CASE
                WHEN $6 = 'NOT_STARTED' THEN NULL
                ELSE now()
              END,
              CASE
                WHEN $6 = 'COMPLETED' THEN now()
                ELSE NULL
              END,
              now()
            )
            ON CONFLICT (
              organisation_id,
              learner_id,
              enrolment_id,
              lesson_id
            )
            DO UPDATE SET
              status = EXCLUDED.status,
              progress_percent = EXCLUDED.progress_percent,
              started_at = COALESCE(
                nabuuma.academy_lesson_progress.started_at,
                EXCLUDED.started_at
              ),
              completed_at = EXCLUDED.completed_at,
              last_activity_at = now(),
              updated_at = now()
            WHERE
              nabuuma.academy_lesson_progress.status
                <> 'COMPLETED'
              OR (
                EXCLUDED.status = 'COMPLETED'
                AND EXCLUDED.progress_percent = 100
              )
            RETURNING
              id,
              organisation_id,
              learner_id,
              course_id,
              enrolment_id,
              lesson_id,
              status,
              progress_percent,
              started_at,
              completed_at,
              last_activity_at
          `,
          [
            this.context.organisationId,
            this.context.claims.subject,
            input.courseId,
            input.enrolmentId,
            input.lessonId,
            input.status,
            input.progressPercent,
          ],
        );

      const row = result.rows[0];

      if (!row) {
        throw new Error(
          "Academy lesson progress update was rejected.",
        );
      }

      return mapLessonProgress(row);
    } catch (error) {
      throw mapPgError(error, "academy");
    }
  }

}
