/** Data access for the service catalogue. */
import type { ServiceRow } from '../types';
import type { ServiceInput } from '../domain/validation';

export async function listServices(
  db: D1Database,
  options: { activeOnly?: boolean } = {}
): Promise<ServiceRow[]> {
  const activeOnly = options.activeOnly !== false;
  const sql = activeOnly
    ? 'SELECT id, name, duration_min, price_rm, sort FROM services WHERE active = 1 ORDER BY sort, name'
    : 'SELECT id, name, duration_min, price_rm, sort FROM services ORDER BY sort, name';

  const { results } = await db.prepare(sql).all<ServiceRow>();
  return results ?? [];
}

/**
 * Replace the catalogue in a single batch: rows missing from `services` are
 * deleted, the rest are upserted. Batched so a partial catalogue cannot land.
 */
export async function replaceServices(db: D1Database, services: ServiceInput[]): Promise<void> {
  const existing = await db.prepare('SELECT id FROM services').all<{ id: string }>();
  const keep = new Set(services.map((service) => service.id));

  const statements: D1PreparedStatement[] = [];
  for (const row of existing.results ?? []) {
    if (!keep.has(row.id)) {
      statements.push(db.prepare('DELETE FROM services WHERE id = ?').bind(row.id));
    }
  }

  services.forEach((service, index) => {
    statements.push(
      db
        .prepare(
          `INSERT INTO services (id, name, duration_min, price_rm, sort, active)
           VALUES (?, ?, ?, ?, ?, 1)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name,
             duration_min = excluded.duration_min,
             price_rm = excluded.price_rm,
             sort = excluded.sort,
             active = 1`
        )
        .bind(service.id, service.name, service.duration_min, service.price_rm, index + 1)
    );
  });

  if (statements.length) await db.batch(statements);
}
