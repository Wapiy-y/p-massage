/**
 * Image rules and orchestration: presign an upload, confirm it, serve it,
 * delete it. Validation is a pure function so it can be tested without S3.
 */
import { newId } from '../lib/id';
import * as s3 from '../lib/s3';
import * as imageRepo from '../repositories/images';
import type { ImageKind, ImageRow, PublicImage, ServiceResult } from '../types';

export const IMAGE_RULES = {
  /** Hard cap on gallery images. The profile picture is separate. */
  maxGallery: 10,
  maxBytes: 5 * 1024 * 1024,
  /** Only formats a phone camera or screenshot realistically produces. */
  allowedTypes: {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp'
  } as Record<string, string>,
  /** Presigned uploads older than this were abandoned. */
  staleAfterMs: 60 * 60 * 1000
};

export interface UploadRequest {
  kind: ImageKind;
  contentType: string;
  bytes: number;
  /** Images already stored plus uploads in flight for this kind. */
  occupied: number;
}

export function validateUpload(request: UploadRequest): ServiceResult<{ extension: string }> {
  const { kind, contentType, bytes, occupied } = request;
  const extension = IMAGE_RULES.allowedTypes[contentType];

  if (!extension) {
    return {
      ok: false,
      status: 415,
      errors: { file: 'Use a JPEG, PNG or WebP image.' }
    };
  }
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return { ok: false, status: 422, errors: { file: 'That file looks empty.' } };
  }
  if (bytes > IMAGE_RULES.maxBytes) {
    return {
      ok: false,
      status: 413,
      errors: { file: `Keep it under ${Math.round(IMAGE_RULES.maxBytes / 1024 / 1024)} MB.` }
    };
  }
  if (kind === 'gallery' && occupied >= IMAGE_RULES.maxGallery) {
    return {
      ok: false,
      status: 409,
      errors: { file: `The gallery is full (${IMAGE_RULES.maxGallery} photos). Remove one first.` }
    };
  }
  return { ok: true, value: { extension } };
}

export interface PresignedUpload {
  id: string;
  key: string;
  uploadUrl: string;
  url: string;
}

/**
 * Reserve a slot and hand back a presigned PUT.
 *
 * The row is created as `pending` immediately: an abandoned upload therefore
 * holds its gallery slot only until the purge, rather than being invisible and
 * letting concurrent uploads exceed the limit.
 */
export async function presignUpload(
  db: D1Database,
  config: s3.S3Config,
  input: { kind: ImageKind; contentType: string; bytes: number }
): Promise<ServiceResult<PresignedUpload>> {
  const occupied = await imageRepo.countOccupied(db, input.kind);
  const valid = validateUpload({ ...input, occupied });
  if (!valid.ok) return valid;

  const id = newId('img');
  const key = `${input.kind}-${id}.${valid.value.extension}`;
  const sort = input.kind === 'gallery' ? await imageRepo.nextSort(db, 'gallery') : 0;

  await imageRepo.insertPending(db, {
    id,
    kind: input.kind,
    objectKey: key,
    contentType: input.contentType,
    sort,
    createdAt: Date.now()
  });

  return {
    ok: true,
    value: {
      id,
      key,
      uploadUrl: await s3.presignPut(config, key),
      url: publicUrlFor(key)
    }
  };
}

/**
 * Called by the browser once the PUT finishes. The object is verified by
 * HEAD — its real size decides, not what the client claimed.
 */
export interface ConfirmDeps {
  statObject: (config: s3.S3Config, key: string) => Promise<s3.ObjectStat>;
  deleteObject: (config: s3.S3Config, key: string) => Promise<void>;
}

const defaultConfirmDeps: ConfirmDeps = {
  statObject: s3.statObject,
  deleteObject: s3.deleteObject
};

/**
 * Called by the browser once the PUT succeeds.
 *
 * Deliberately non-destructive: if the object cannot be verified, the row is
 * left in place so a retry can succeed and so the daily purge — not this
 * request — decides what is abandoned. Deleting here once threw away uploads
 * that were sitting in the bucket.
 */
export async function confirmUpload(
  db: D1Database,
  config: s3.S3Config,
  id: string,
  deps: ConfirmDeps = defaultConfirmDeps
): Promise<ServiceResult<ImageRow>> {
  const row = await imageRepo.findById(db, id);
  if (!row) return { ok: false, status: 404, errors: { _form: 'Upload not found.' } };

  if (row.status === 'ready') return { ok: true, value: row };

  const stat = await deps.statObject(config, row.object_key);
  if (!stat.found) {
    return {
      ok: false,
      status: 502,
      errors: {
        _form: `Storage could not confirm the upload (HTTP ${stat.status}). The file may have arrived — try again.`
      }
    };
  }

  if (stat.bytes && stat.bytes > IMAGE_RULES.maxBytes) {
    await deps.deleteObject(config, row.object_key);
    await imageRepo.remove(db, id);
    return { ok: false, status: 413, errors: { file: 'That image is too large.' } };
  }

  await imageRepo.markReady(db, id, stat.bytes ?? 0);

  // A profile picture is singular: drop whatever it replaced.
  if (row.kind === 'profile') {
    for (const previous of await imageRepo.listByKind(db, 'profile', id)) {
      await deps.deleteObject(config, previous.object_key);
      await imageRepo.remove(db, previous.id);
    }
  }

  return { ok: true, value: { ...row, status: 'ready', bytes: stat.bytes ?? 0 } };
}

export function publicUrlFor(key: string): string {
  return `/img/${key}`;
}

export async function listPublicImages(
  db: D1Database
): Promise<{ profile: PublicImage | null; gallery: PublicImage[] }> {
  const [profileRows, galleryRows] = await Promise.all([
    imageRepo.listReady(db, 'profile'),
    imageRepo.listReady(db, 'gallery')
  ]);

  const toPublic = (row: ImageRow): PublicImage => ({
    id: row.id,
    url: publicUrlFor(row.object_key)
  });

  return {
    profile: profileRows[0] ? toPublic(profileRows[0]) : null,
    gallery: galleryRows.slice(0, IMAGE_RULES.maxGallery).map(toPublic)
  };
}

export async function listForAdmin(
  db: D1Database
): Promise<{ profile: ImageRow | null; gallery: ImageRow[]; maxGallery: number }> {
  const [profileRows, galleryRows] = await Promise.all([
    imageRepo.listReady(db, 'profile'),
    imageRepo.listReady(db, 'gallery')
  ]);
  return {
    profile: profileRows[0] ?? null,
    gallery: galleryRows,
    maxGallery: IMAGE_RULES.maxGallery
  };
}

export async function deleteImage(
  db: D1Database,
  config: s3.S3Config,
  id: string
): Promise<boolean> {
  const row = await imageRepo.findById(db, id);
  if (!row) return false;

  await s3.deleteObject(config, row.object_key);
  await imageRepo.remove(db, id);
  return true;
}

/** Remove uploads that were presigned but never confirmed, and their objects. */
export async function purgeStaleUploads(
  db: D1Database,
  config: s3.S3Config,
  now = Date.now()
): Promise<number> {
  const stale = await imageRepo.listStalePending(db, now - IMAGE_RULES.staleAfterMs);
  for (const row of stale) {
    await s3.deleteObject(config, row.object_key);
    await imageRepo.remove(db, row.id);
  }
  return stale.length;
}
