import { describe, expect, it } from 'vitest';
import { IMAGE_RULES, validateUpload } from '../../src/services/images';

const valid = {
  kind: 'gallery' as const,
  contentType: 'image/jpeg',
  bytes: 800_000,
  occupied: 0
};

describe('validateUpload', () => {
  it('accepts a normal gallery image', () => {
    const result = validateUpload(valid);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.extension).toBe('jpg');
  });

  it('accepts png and webp', () => {
    expect(validateUpload({ ...valid, contentType: 'image/png' }).ok).toBe(true);
    expect(validateUpload({ ...valid, contentType: 'image/webp' }).ok).toBe(true);
  });

  it('rejects anything that is not an allowed image type', () => {
    for (const contentType of ['image/gif', 'image/svg+xml', 'text/html', 'application/pdf', '']) {
      const result = validateUpload({ ...valid, contentType });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.status).toBe(415);
    }
  });

  it('rejects an empty or nonsensical size', () => {
    expect(validateUpload({ ...valid, bytes: 0 }).ok).toBe(false);
    expect(validateUpload({ ...valid, bytes: Number.NaN }).ok).toBe(false);
    expect(validateUpload({ ...valid, bytes: -5 }).ok).toBe(false);
  });

  it('rejects a file over the size limit', () => {
    const result = validateUpload({ ...valid, bytes: IMAGE_RULES.maxBytes + 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(413);
  });

  it('accepts a file exactly at the limit', () => {
    expect(validateUpload({ ...valid, bytes: IMAGE_RULES.maxBytes }).ok).toBe(true);
  });

  it('stops the gallery at ten images', () => {
    const lastSlot = validateUpload({ ...valid, occupied: IMAGE_RULES.maxGallery - 1 });
    expect(lastSlot.ok).toBe(true);

    const full = validateUpload({ ...valid, occupied: IMAGE_RULES.maxGallery });
    expect(full.ok).toBe(false);
    if (!full.ok) {
      expect(full.status).toBe(409);
      expect(full.errors.file).toMatch(/gallery is full/i);
    }
  });

  it('does not apply the gallery limit to the profile photo', () => {
    const result = validateUpload({
      kind: 'profile',
      contentType: 'image/png',
      bytes: 1000,
      occupied: IMAGE_RULES.maxGallery
    });
    expect(result.ok).toBe(true);
  });
});
