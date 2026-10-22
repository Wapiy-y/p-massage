/** Profile and catalogue rules. */
import { validateProfile, validateServices } from '../domain/validation';
import * as profileRepo from '../repositories/profile';
import * as serviceRepo from '../repositories/services';
import type { Profile, ServiceRow, ServiceResult } from '../types';

export async function getPublicContent(
  db: D1Database
): Promise<{ profile: Profile | null; services: ServiceRow[] }> {
  const [profile, services] = await Promise.all([
    profileRepo.findProfile(db),
    serviceRepo.listServices(db)
  ]);
  return { profile, services };
}

export async function getEditableContent(
  db: D1Database
): Promise<{ profile: Profile | null; services: ServiceRow[] }> {
  const [profile, services] = await Promise.all([
    profileRepo.findProfile(db),
    serviceRepo.listServices(db, { activeOnly: false })
  ]);
  return { profile, services };
}

export async function updateContent(
  db: D1Database,
  body: Record<string, unknown>
): Promise<ServiceResult<true>> {
  const validated = validateProfile(body.profile ?? body);
  if (!validated.ok) {
    return { ok: false, status: 422, errors: validated.errors };
  }

  await profileRepo.upsertProfile(db, validated.value);

  // The catalogue is optional in this payload: profile edits do not have to
  // carry it, and vice versa.
  if (Array.isArray(body.services)) {
    await serviceRepo.replaceServices(db, validateServices(body.services));
  }

  return { ok: true, value: true };
}
