import { z } from "zod";

import {
  ArtifactIdSchema,
  ImportJobSnapshotSchemaV2,
  ProjectIdSchema,
  RuntimeCaptureScreenV1Schema,
} from "@memi/protocol";

import { isSafeReferenceSourceUrl } from "../../canvas/reference-security.js";
import { isSafeCaptureArtifactUrl } from "./repository-artifact-url.js";
import { RepositoryImportManifestSchema } from "./repository-import.js";
import { RepositoryReconstructionReviewSchema } from "./repository-reconstruction-review.js";

const MAX_BYTES = 4_194_304;
const safeLocalId = /^[a-z0-9][a-z0-9-]{0,127}$/u;

function isSafeProjectId(value: string): boolean {
  return (
    safeLocalId.test(value) ||
    ProjectIdSchema.safeParse(value).success
  );
}
const ArtifactReferenceSchema = z
  .strictObject({
    alt: z.string().max(4_096),
    capturedAt: z.iso.datetime({ offset: true }),
    sourceUrl: z
      .url()
      .max(8_192)
      .refine(isSafeReferenceSourceUrl),
    src: z.string().refine((value) => {
      const match =
        /(?:^\/imports\/artifacts\/|^memi-artifact:\/\/localhost\/)(art_[0-9A-HJKMNP-TV-Z]{26})(?:\.png)?$/u.exec(
          value,
        );
      return match !== null && isSafeCaptureArtifactUrl(value, match[1]!);
    }),
    reconstruction: RuntimeCaptureScreenV1Schema.optional(),
    reconstructionReview: RepositoryReconstructionReviewSchema.optional(),
  })
  .refine(
    ({ reconstruction, reconstructionReview }) =>
      reconstructionReview === undefined || reconstruction !== undefined,
    {
      message: "Reconstruction review requires semantic reconstruction evidence.",
      path: ["reconstructionReview"],
    },
  );
const RecordSchema = z.strictObject({
  capture: z
    .strictObject({
      artifactReferences: z.record(
        ArtifactIdSchema,
        ArtifactReferenceSchema,
      ),
      job: ImportJobSnapshotSchemaV2.refine(
        (job) => job.state === "committed" && job.projectId !== null,
        "Persisted capture projects require a durably committed import job.",
      ),
    })
    .optional(),
  harnessId: z.string().trim().min(1).max(64),
  manifest: RepositoryImportManifestSchema,
});

export type RepositoryProjectRecord = z.infer<typeof RecordSchema>;

type CaptureRecord = NonNullable<RepositoryProjectRecord["capture"]>;
type ArtifactReference =
  CaptureRecord["artifactReferences"][keyof CaptureRecord["artifactReferences"]];

function reconstructionMatchesArtifactAuthority(
  artifactId: string,
  capture: CaptureRecord,
  reference: ArtifactReference,
): boolean {
  const reconstruction = reference.reconstruction;
  if (reconstruction === undefined) return true;
  const artifact = capture.job.artifacts.find(
    (candidate) => candidate.id === artifactId,
  );
  if (
    artifact === undefined ||
    artifact.reconstructionArtifactId === null
  ) {
    return false;
  }
  return (
    reconstruction.captureId === artifact.id &&
    reconstruction.artifact.artifactId === artifact.screenshotArtifactId &&
    reconstruction.artifact.hash === artifact.screenshotHash &&
    reconstruction.artifact.width === artifact.dimensions.width &&
    reconstruction.artifact.height === artifact.dimensions.height &&
    reconstruction.repository.rootPath ===
      capture.job.repository.rootPath &&
    reconstruction.repository.revision ===
      capture.job.repository.sourceRevision
  );
}

function captureAuthorityIsConsistent(
  record: RepositoryProjectRecord,
): boolean {
  const capture = record.capture;
  if (capture === undefined) return true;
  return Object.entries(capture.artifactReferences).every(
    ([artifactId, reference]) =>
      reconstructionMatchesArtifactAuthority(
        artifactId,
        capture,
        reference,
      ),
  );
}

function matchesProjectAuthority(
  projectId: string,
  record: RepositoryProjectRecord,
): boolean {
  return (
    (record.capture === undefined ||
      record.capture.job.projectId === projectId) &&
    captureAuthorityIsConsistent(record)
  );
}

function persistentRecord(
  record: RepositoryProjectRecord,
): RepositoryProjectRecord {
  if (record.capture === undefined) return record;
  const artifactReferences = Object.fromEntries(
    Object.entries(record.capture.artifactReferences).map(
      ([artifactId, reference]) => [
        artifactId,
        {
          alt: reference.alt,
          capturedAt: reference.capturedAt,
          sourceUrl: reference.sourceUrl,
          src: reference.src,
        },
      ],
    ),
  );
  return {
    ...record,
    capture: {
      artifactReferences,
      job: record.capture.job,
    },
  };
}

export interface RepositoryProjectStorage {
  getItem(key: string): string | null;
  removeItem?(key: string): void;
  setItem(key: string, value: string): void;
}

export function repositoryProjectKey(projectId: string): string {
  return `memi.repository-project.v1:${projectId}`;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function createRepositoryProjectPersistence(
  storage: RepositoryProjectStorage,
) {
  return Object.freeze({
    load(projectId: string): RepositoryProjectRecord | null {
      if (!isSafeProjectId(projectId)) return null;
      try {
        const serialized = storage.getItem(repositoryProjectKey(projectId));
        if (
          serialized === null ||
          byteLength(serialized) > MAX_BYTES
        ) {
          return null;
        }
        const result = RecordSchema.safeParse(JSON.parse(serialized));
        return result.success &&
          matchesProjectAuthority(projectId, result.data)
          ? result.data
          : null;
      } catch {
        return null;
      }
    },
    save(projectId: string, record: RepositoryProjectRecord): boolean {
      if (!isSafeProjectId(projectId)) return false;
      try {
        const parsed = RecordSchema.safeParse(record);
        if (
          !parsed.success ||
          !matchesProjectAuthority(projectId, parsed.data)
        ) {
          return false;
        }
        const serialized = JSON.stringify(persistentRecord(parsed.data));
        if (byteLength(serialized) > MAX_BYTES) return false;
        storage.setItem(repositoryProjectKey(projectId), serialized);
        return true;
      } catch {
        return false;
      }
    },
    remove(projectId: string): boolean {
      if (
        !isSafeProjectId(projectId) ||
        storage.removeItem === undefined
      ) {
        return false;
      }
      try {
        storage.removeItem(repositoryProjectKey(projectId));
        return true;
      } catch {
        return false;
      }
    },
  });
}
