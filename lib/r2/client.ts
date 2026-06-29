import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';

type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
};

function readEnv(primary: string, fallback?: string): string | undefined {
  const value = process.env[primary] ?? (fallback ? process.env[fallback] : undefined);
  return value?.trim() || undefined;
}

export function getR2Config(): R2Config {
  const accountId =
    readEnv('R2_ACCOUNT_ID', 'CLOUDFLARE_R2_ACCOUNT_ID') ?? '';
  const accessKeyId =
    readEnv('R2_ACCESS_KEY_ID', 'CLOUDFLARE_R2_ACCESS_KEY_ID') ?? '';
  const secretAccessKey =
    readEnv('R2_SECRET_ACCESS_KEY', 'CLOUDFLARE_R2_SECRET_ACCESS_KEY') ?? '';
  const bucketName =
    readEnv('R2_BUCKET_NAME', 'CLOUDFLARE_R2_BUCKET_NAME') ?? '';

  const missing: string[] = [];
  if (!accountId) missing.push('R2_ACCOUNT_ID');
  if (!accessKeyId) missing.push('R2_ACCESS_KEY_ID');
  if (!secretAccessKey) missing.push('R2_SECRET_ACCESS_KEY');
  if (!bucketName) missing.push('R2_BUCKET_NAME');

  if (missing.length > 0) {
    throw new Error(
      `Missing R2 environment variable(s): ${missing.join(', ')}. Set R2_* or CLOUDFLARE_R2_* values in .env.local.`,
    );
  }

  return { accountId, accessKeyId, secretAccessKey, bucketName };
}

let cachedClient: S3Client | null = null;

export function createR2Client(): S3Client {
  if (cachedClient) {
    return cachedClient;
  }

  const config = getR2Config();
  cachedClient = new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return cachedClient;
}

export type UploadPdfOptions = {
  key: string;
  body: Buffer;
  metadata?: Record<string, string>;
};

export async function uploadPdfToR2(options: UploadPdfOptions): Promise<void> {
  const config = getR2Config();
  const client = createR2Client();

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucketName,
      Key: options.key,
      Body: options.body,
      ContentType: 'application/pdf',
      Metadata: options.metadata,
    }),
  );
}

export function getR2BucketName(): string {
  return getR2Config().bucketName;
}

/**
 * Stable public URL when `CLOUDFLARE_R2_PUBLIC_BASE_URL` (or `R2_PUBLIC_BASE_URL`) is set.
 * Returns null for private buckets — signed download URLs are generated on demand elsewhere.
 */
export function getStablePublicR2Url(objectKey: string): string | null {
  const baseUrl = readEnv('CLOUDFLARE_R2_PUBLIC_BASE_URL', 'R2_PUBLIC_BASE_URL');
  if (!baseUrl) {
    return null;
  }

  const normalizedBase = baseUrl.replace(/\/$/, '');
  const normalizedKey = objectKey.replace(/^\//, '');
  return `${normalizedBase}/${normalizedKey}`;
}

async function readableToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function downloadPdfFromR2(
  bucket: string,
  key: string,
): Promise<Buffer> {
  const client = createR2Client();
  const response = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );

  if (!response.Body) {
    throw new Error(`R2 object has no body: ${bucket}/${key}`);
  }

  return readableToBuffer(response.Body as Readable);
}
