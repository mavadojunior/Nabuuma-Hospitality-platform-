import type {
  AcademyCourse,
  AcademyEnrolment,
  AcademyRepository,
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
}
