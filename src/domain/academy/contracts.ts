import type { UUID } from "../competency/repositories/contracts";

export interface AcademyCourse {
  readonly id: UUID;
  readonly organisationId: UUID;
  readonly stableKey: string;
  readonly version: number;
  readonly title: string;
  readonly description: string;
  readonly isPublished: boolean;
}

export type AcademyEnrolmentStatus =
  | "ACTIVE"
  | "COMPLETED"
  | "CANCELLED";

export interface AcademyEnrolment {
  readonly id: UUID;
  readonly organisationId: UUID;
  readonly learnerId: UUID;
  readonly courseId: UUID;
  readonly status: AcademyEnrolmentStatus;
  readonly enrolledAt: string;
  readonly completedAt?: string;
}

export interface AcademyRepository {
  listPublishedCourses(): Promise<AcademyCourse[]>;

  getCourseById(
    courseId: UUID,
  ): Promise<AcademyCourse | null>;

  enrol(
    courseId: UUID,
  ): Promise<AcademyEnrolment>;

  getEnrolment(
    courseId: UUID,
  ): Promise<AcademyEnrolment | null>;
}
