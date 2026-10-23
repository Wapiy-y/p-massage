/**
 * S3-compatible object storage (Neon in this deployment).
 *
 * The bucket is private: nothing is served directly from it. The Worker signs
 * its own requests, and browsers get either a short-lived presigned PUT (to
 * upload) or a streamed response from GET /img/:key (to read).
 */
import { AwsClient } from 'aws4fetch';
import type { Env } from '../types';

export interface S3Config {
  endpoint: string;
  bucket: string;
  region: string;
  client: AwsClient;
}

/** Returns null when storage is not configured, so callers can fail closed. */
export function s3Config(env: Env): S3Config | null {
  const endpoint = env.S3_ENDPOINT?.trim();
  const bucket = env.S3_BUCKET?.trim();
  const region = env.S3_REGION?.trim() || 'ap-southeast-1';
  const accessKeyId = env.S3_ACCESS_KEY_ID;
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY;

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;

  return {
    endpoint: endpoint.replace(/\/+$/, ''),
    bucket,
    region,
    client: new AwsClient({ accessKeyId, secretAccessKey, region, service: 's3' })
  };
}

function objectUrl(config: S3Config, key: string): string {
  const encoded = key.split('/').map(encodeURIComponent).join('/');
  return `${config.endpoint}/${config.bucket}/${encoded}`;
}

/** Presigned PUT, valid for a short window. The key is always server-generated. */
export async function presignPut(
  config: S3Config,
  key: string,
  expiresSeconds = 600
): Promise<string> {
  const url = new URL(objectUrl(config, key));
  url.searchParams.set('X-Amz-Expires', String(expiresSeconds));

  const signed = await config.client.sign(url.toString(), {
    method: 'PUT',
    aws: { signQuery: true }
  });
  return signed.url.toString();
}

/** Signed GET used by the /img/:key proxy. */
export function signedGet(config: S3Config, key: string): Promise<Response> {
  return config.client.fetch(objectUrl(config, key));
}

export async function putObject(
  config: S3Config,
  key: string,
  body: ArrayBuffer | string,
  contentType?: string
): Promise<Response> {
  return config.client.fetch(objectUrl(config, key), {
    method: 'PUT',
    body,
    headers: contentType ? { 'content-type': contentType } : undefined
  });
}

export async function headObject(config: S3Config, key: string): Promise<Response> {
  return config.client.fetch(objectUrl(config, key), { method: 'HEAD' });
}

/** One-byte GET, used when HEAD is unsupported by the provider. */
export async function rangedGet(config: S3Config, key: string): Promise<Response> {
  return config.client.fetch(objectUrl(config, key), { headers: { Range: 'bytes=0-0' } });
}

export interface ObjectStat {
  found: boolean;
  /** Size in bytes when the provider reports it. */
  bytes: number | null;
  /** Status of the check that decided the outcome. */
  status: number;
  /** True when HEAD was refused and the fallback was used. */
  viaRangedGet: boolean;
}

/**
 * Does this object exist?
 *
 * Not every S3-compatible provider implements HEAD — Neon's answered with a
 * non-2xx even though the object was there, which made every upload look
 * missing. A one-byte ranged GET is the fallback, and its Content-Range carries
 * the full size.
 */
export async function statObject(config: S3Config, key: string): Promise<ObjectStat> {
  const head = await headObject(config, key);
  if (head.ok) {
    const declared = Number(head.headers.get('content-length') ?? 0);
    return {
      found: true,
      bytes: declared > 0 ? declared : null,
      status: head.status,
      viaRangedGet: false
    };
  }
  if (head.status === 404) {
    return { found: false, bytes: null, status: 404, viaRangedGet: false };
  }

  const ranged = await rangedGet(config, key);
  if (ranged.ok || ranged.status === 206) {
    const total = ranged.headers.get('content-range')?.split('/')[1];
    const parsed = total ? Number(total) : Number(ranged.headers.get('content-length') ?? 0);
    return {
      found: true,
      bytes: Number.isFinite(parsed) && parsed > 0 ? parsed : null,
      status: ranged.status,
      viaRangedGet: true
    };
  }

  return { found: false, bytes: null, status: ranged.status, viaRangedGet: true };
}

/** Best-effort delete: a missing object is not an error worth failing on. */
export async function deleteObject(config: S3Config, key: string): Promise<void> {
  try {
    await config.client.fetch(objectUrl(config, key), { method: 'DELETE' });
  } catch (error) {
    console.warn('s3 delete failed', key, error);
  }
}
