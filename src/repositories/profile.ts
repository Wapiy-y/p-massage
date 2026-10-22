/** Data access for the single profile row. */
import type { Profile } from '../types';
import type { ProfileInput } from '../domain/validation';

export async function findProfile(db: D1Database): Promise<Profile | null> {
  const row = await db.prepare('SELECT json FROM profile WHERE id = 1').first<{ json: string }>();
  if (!row) return null;

  try {
    return JSON.parse(row.json) as Profile;
  } catch {
    // Corrupt row: behave as if unset rather than taking the whole page down.
    return null;
  }
}

export async function upsertProfile(db: D1Database, profile: ProfileInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO profile (id, json) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET json = excluded.json`
    )
    .bind(JSON.stringify(profile))
    .run();
}
