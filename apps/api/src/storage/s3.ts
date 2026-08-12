import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Object storage is not configured: ${name}`);
  return value;
}

function client() {
  const endpoint = process.env.S3_ENDPOINT;
  return new S3Client({
    region: process.env.S3_REGION ?? 'us-east-1',
    ...(endpoint ? { endpoint, forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false' } : {}),
    credentials: {
      accessKeyId: required('S3_ACCESS_KEY_ID'),
      secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    },
  });
}

function bucket() {
  return required('S3_BUCKET_UPLOADS');
}

export function publicObjectUrl(fileKey: string) {
  const configured = process.env.S3_PUBLIC_URL;
  return configured
    ? `${configured.replace(/\/$/, '')}/${bucket()}/${fileKey}`
    : undefined;
}

export async function createUploadUrl(input: { fileKey: string; contentType: string; size: number }) {
  return getSignedUrl(
    client(),
    new PutObjectCommand({ Bucket: bucket(), Key: input.fileKey, ContentType: input.contentType, ContentLength: input.size }),
    { expiresIn: 600 },
  );
}

export async function confirmUploadedObject(fileKey: string) {
  return client().send(new HeadObjectCommand({ Bucket: bucket(), Key: fileKey }));
}

export async function readUploadedObject(fileKey: string) {
  const response = await client().send(new GetObjectCommand({ Bucket: bucket(), Key: fileKey }));
  if (!response.Body) throw new Error('Uploaded object has no body');
  const bytes = await response.Body.transformToByteArray();
  return Buffer.from(bytes);
}
