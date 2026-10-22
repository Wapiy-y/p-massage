/**
 * Review business rules. Knows about validation order, rate limiting and the
 * moderation workflow; knows nothing about HTTP or SQL specifics.
 */
import { LIMITS, RATE_LIMIT_WINDOW_MS } from '../config/limits';
import { validateReview } from '../domain/validation';
import { newId } from '../lib/id';
import * as reviewRepo from '../repositories/reviews';
import * as serviceRepo from '../repositories/services';
import * as rateLimitRepo from '../repositories/rate-limit';
import type {
  ModerationCounts,
  PublicReview,
  ReviewListOptions,
  ReviewRow,
  ReviewStatus,
  ServiceResult,
  Summary
} from '../types';

export async function listPublishedReviews(
  db: D1Database,
  options: ReviewListOptions
): Promise<{ items: PublicReview[]; nextCursor: string | null }> {
  return reviewRepo.listPublished(db, options);
}

export async function reviewSummary(db: D1Database): Promise<Summary> {
  return reviewRepo.summarise(db);
}

/** Input for publishing a review, once the request has been authenticated. */
export interface SubmitReviewCommand {
  body: Record<string, unknown>;
  ipHash: string;
  rateLimitMax: number;
}

/**
 * Persist a new review as `pending`.
 *
 * Order matters: reject free (honeypot, validation) before spending a rate-limit
 * slot, so a legitimate visitor who fixes a typo is not counted twice.
 */
export async function submitReview(
  db: D1Database,
  command: SubmitReviewCommand
): Promise<ServiceResult<{ id: string }>> {
  const services = await serviceRepo.listServices(db);
  const validated = validateReview(command.body, {
    serviceIds: services.map((service) => service.id)
  });

  if (!validated.ok) {
    const spam = validated.errors._spam;
    return {
      ok: false,
      status: spam ? 400 : 422,
      errors: validated.errors
    };
  }

  const limit = await rateLimitRepo.consume(
    db,
    `review:${command.ipHash}`,
    command.rateLimitMax,
    RATE_LIMIT_WINDOW_MS
  );
  if (!limit.ok) {
    const minutes = Math.ceil(limit.retryAfterMs / 60_000);
    const plural = minutes === 1 ? '' : 's';
    return {
      ok: false,
      status: 429,
      errors: {
        _form: `You have already sent ${command.rateLimitMax} reviews in the last hour. Please try again in ${minutes} minute${plural}.`
      }
    };
  }

  const id = newId();
  await reviewRepo.insertReview(db, {
    id,
    rating: validated.value.rating,
    service_id: validated.value.service_id,
    nickname: validated.value.nickname,
    message: validated.value.message,
    ip_hash: command.ipHash,
    created_at: Date.now()
  });

  return { ok: true, value: { id } };
}

export async function moderationQueue(
  db: D1Database,
  status: ReviewStatus
): Promise<{ items: ReviewRow[]; counts: ModerationCounts }> {
  const [items, counts] = await Promise.all([
    reviewRepo.listByStatus(db, status),
    reviewRepo.countByStatus(db)
  ]);
  return { items, counts };
}

export interface ModerationChanges {
  status?: ReviewStatus;
  /** `null` clears an existing reply; `undefined` leaves it untouched. */
  reply?: string | null;
}

export async function moderateReview(
  db: D1Database,
  id: string,
  changes: ModerationChanges
): Promise<ServiceResult<ReviewRow>> {
  const existing = await reviewRepo.findById(db, id);
  if (!existing) {
    return { ok: false, status: 404, errors: { _form: 'Review not found.' } };
  }

  if (changes.status) await reviewRepo.updateStatus(db, id, changes.status);
  if (changes.reply !== undefined) {
    const trimmed = changes.reply?.trim().slice(0, LIMITS.replyMax) ?? '';
    await reviewRepo.updateReply(db, id, trimmed || null);
  }

  const updated = await reviewRepo.findById(db, id);
  return { ok: true, value: updated ?? existing };
}

export async function deleteReview(db: D1Database, id: string): Promise<boolean> {
  const existing = await reviewRepo.findById(db, id);
  if (!existing) return false;
  await reviewRepo.deleteById(db, id);
  return true;
}
