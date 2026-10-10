import { randomUUID } from 'crypto';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Neo NOS is S3-compatible but not AWS: it needs an explicit endpoint, and
// path-style addressing because there is no per-bucket DNS. `region` is only
// a signing input here — it is the storage policy's region ("idn"), not an
// AWS region.
const endpoint = process.env.S3_ENDPOINT || '';
const region = process.env.S3_REGION || 'idn';
const bucket = process.env.S3_BUCKET || '';
const accessKeyId = process.env.S3_ACCESS_KEY_ID || '';
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || '';
const prefix = (process.env.S3_PREFIX || 'attachments').replace(/^\/+|\/+$/g, '');

/** False when the deployment has no object storage configured yet. */
export function isS3Configured() {
  return Boolean(endpoint && bucket && accessKeyId && secretAccessKey);
}

let client: S3Client | null = null;

function s3() {
  if (!isS3Configured()) {
    throw new Error('Object storage belum dikonfigurasi. Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID dan S3_SECRET_ACCESS_KEY.');
  }
  if (!client) {
    client = new S3Client({
      endpoint,
      region,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return client;
}

/**
 * Object key for one attachment. Grouped by parent so a document's files stay
 * together in the console, and prefixed with a UUID so two uploads of the same
 * filename never collide.
 */
export function buildKey(entity: 'rfq' | 'fupa' | 'trip' | 'prospect', entityId: string, filename: string) {
  const safe = filename.replace(/[^\w.\- ]+/g, '_').slice(-120);
  return `${prefix}/${entity}/${entityId}/${randomUUID()}-${safe}`;
}

export async function putObject(key: string, body: Buffer, contentType: string) {
  await s3().send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType || 'application/octet-stream' }),
  );
  return key;
}

/**
 * Short-lived download URL. The bucket stays private — the API route redirects
 * to one of these rather than proxying bytes through the Node process.
 */
export async function presignGet(key: string, filename?: string, expiresIn = 300, inline = false) {
  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
    ...(filename ? { ResponseContentDisposition: `${inline ? 'inline' : 'attachment'}; filename="${filename.replace(/"/g, '')}"` } : {}),
  });
  return getSignedUrl(s3(), command, { expiresIn });
}

export async function deleteObject(key: string) {
  await s3().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}
