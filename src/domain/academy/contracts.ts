import type { UUID } from "../competency/repositories/contracts.js";

export interface AcademyCourse {
  readonly id: UUID;
  readonly organisationId: UUID;
  readonly stableKey: string;
  readonly version: number;
  readonly title: string;
  readonly description: string;
  readonly isPublished: boolean;
}

export interface AcademyLesson {
  readonly id: UUID;
  readonly organisationId: UUID;
  readonly courseId: UUID;
  readonly stableKey: string;
  readonly title: string;
  readonly content: Record<string, unknown>;
  readonly sequenceNumber: number;
  readonly estimatedDurationMinutes?: number;
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

export type AcademyLessonProgressStatus =
  | "NOT_STARTED"
  | "IN_PROGRESS"
  | "COMPLETED";

export interface AcademyLessonProgress {
  readonly id: UUID;
  readonly organisationId: UUID;
  readonly learnerId: UUID;
  readonly courseId: UUID;
  readonly enrolmentId: UUID;
  readonly lessonId: UUID;
  readonly status: AcademyLessonProgressStatus;
  readonly progressPercent: number;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly lastActivityAt: string;
}

export interface SaveAcademyLessonProgressInput {
  readonly courseId: UUID;
  readonly enrolmentId: UUID;
  readonly lessonId: UUID;
  readonly status: AcademyLessonProgressStatus;
  readonly progressPercent: number;
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

  listPublishedLessons(
    courseId: UUID,
  ): Promise<AcademyLesson[]>;

  getLessonProgress(
    enrolmentId: UUID,
    lessonId: UUID,
  ): Promise<AcademyLessonProgress | null>;

  saveLessonProgress(
    input: SaveAcademyLessonProgressInput,
  ): Promise<AcademyLessonProgress>;

  listCertificates(): Promise<AcademyCertificate[]>;

  getCertificateById(
    certificateId: UUID,
  ): Promise<AcademyCertificate | null>;

  revokeCertificate(
    certificateNumber: string,
    reason: string,
  ): Promise<AcademyCertificateRevocation>;

  completeCourse(
    courseId: UUID,
    enrolmentId: UUID,
  ): Promise<AcademyCertificate>;
}

export interface AcademyCertificateRevocation {
  readonly certificateNumber: string;
  readonly revokedAt: string;
  readonly newlyRevoked: boolean;
}

export interface AcademyCertificate {
  readonly id: UUID;
  readonly organisationId: UUID;
  readonly learnerId: UUID;
  readonly courseId: UUID;
  readonly enrolmentId: UUID;
  readonly certificateNumber: string;
  readonly issuedAt: string;
  readonly issuedById?: UUID;
  readonly metadata: Record<string, unknown>;
}
