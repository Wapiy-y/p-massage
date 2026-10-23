import { describe, expect, it } from 'vitest';
import { confirmUpload, IMAGE_RULES } from '../../src/services/images';
import type { ObjectStat } from '../../src/lib/s3';

/**
 * These cover the bug where a provider refused HEAD, the object was actually
 * in the bucket, and confirm deleted the row — so the photo never appeared.
 */

const ROW = {
  id: 'img_1',
  kind: 'gallery' as const,
  object_key: 'gallery-img_1.jpg',
  content_type: 'image/jpeg',
  bytes: null,
  sort: 1,
  status: 'pending' as const,
  created_at: Date.now()
};

/** Minimal D1 stand-in: only findById and markReady are exercised. */
function fakeDb(row: typeof ROW | null) {
  const state = { row: row ? { ...row } : null, markedReady: false, deleted: false };
  const db = {
    prepare(sql: string) {
      return {
        bind: () => ({
          first: () => {
            if (sql.includes('FROM images WHERE id')) return Promise.resolve(state.row);
            return Promise.resolve(null);
          },
          run: () => {
            if (sql.includes("status = 'ready'")) state.markedReady = true;
            if (sql.startsWith('DELETE')) {
              state.deleted = true;
              state.row = null;
            }
            return Promise.resolve({ meta: { changes: 1 } });
          },
          all: () => Promise.resolve({ results: [] })
        })
      };
    }
  };
  return { db: db as unknown as D1Database, state };
}

function deps(stat: ObjectStat) {
  const calls = { stat: 0, deletes: 0 };
  return {
    calls,
    value: {
      statObject: () => {
        calls.stat += 1;
        return Promise.resolve(stat);
      },
      deleteObject: () => {
        calls.deletes += 1;
        return Promise.resolve();
      }
    }
  };
}

const config = {} as never;

describe('confirmUpload', () => {
  it('marks the image ready when HEAD reports the object', async () => {
    const { db, state } = fakeDb(ROW);
    const d = deps({ found: true, bytes: 1234, status: 200, viaRangedGet: false });

    const result = await confirmUpload(db, config, ROW.id, d.value);

    expect(result.ok).toBe(true);
    expect(state.markedReady).toBe(true);
    expect(state.deleted).toBe(false);
  });

  it('still succeeds when HEAD is refused and the ranged GET finds the object', async () => {
    const { db, state } = fakeDb(ROW);
    const d = deps({ found: true, bytes: 4321, status: 206, viaRangedGet: true });

    const result = await confirmUpload(db, config, ROW.id, d.value);

    expect(result.ok).toBe(true);
    expect(state.markedReady).toBe(true);
  });

  it('keeps the row when the object cannot be verified — the old bug', async () => {
    const { db, state } = fakeDb(ROW);
    const d = deps({ found: false, bytes: null, status: 405, viaRangedGet: true });

    const result = await confirmUpload(db, config, ROW.id, d.value);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
      expect(result.errors._form).toMatch(/405/);
    }
    expect(state.deleted).toBe(false);
    expect(state.markedReady).toBe(false);
  });

  it('deletes an object that is genuinely too large', async () => {
    const { db, state } = fakeDb(ROW);
    const d = deps({
      found: true,
      bytes: IMAGE_RULES.maxBytes + 1,
      status: 200,
      viaRangedGet: false
    });

    const result = await confirmUpload(db, config, ROW.id, d.value);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(413);
    expect(d.calls.deletes).toBe(1);
    expect(state.deleted).toBe(true);
  });

  it('accepts a file exactly at the limit', async () => {
    const { db, state } = fakeDb(ROW);
    const d = deps({ found: true, bytes: IMAGE_RULES.maxBytes, status: 200, viaRangedGet: false });

    const result = await confirmUpload(db, config, ROW.id, d.value);

    expect(result.ok).toBe(true);
    expect(state.markedReady).toBe(true);
  });

  it('is idempotent — confirming twice does not re-check storage', async () => {
    const { db } = fakeDb({ ...ROW, status: 'ready' as never });
    const d = deps({ found: true, bytes: 10, status: 200, viaRangedGet: false });

    const result = await confirmUpload(db, config, ROW.id, d.value);

    expect(result.ok).toBe(true);
    expect(d.calls.stat).toBe(0);
  });

  it('reports an unknown upload', async () => {
    const { db } = fakeDb(null);
    const d = deps({ found: true, bytes: 1, status: 200, viaRangedGet: false });

    const result = await confirmUpload(db, config, 'nope', d.value);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });
});
