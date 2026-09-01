import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const CLASSROOM_MEDIA_DOWNLOAD_URL_TTL_SECONDS = 4 * 60 * 60;

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

export async function inspectUploadedObject(fileKey: string) {
  const object = await confirmUploadedObject(fileKey);
  return {
    size: object.ContentLength ?? 0,
    ...(object.ETag ? { etag: object.ETag } : {}),
    ...(object.LastModified ? { lastModified: object.LastModified.getTime() } : {}),
    contentType: object.ContentType ?? 'application/octet-stream',
  };
}

export async function readUploadedObjectRange(fileKey: string, startByte: number, maxBytes: number) {
  if (!Number.isSafeInteger(startByte) || startByte < 0) throw new Error('Object range start must be a non-negative integer');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 32_768) throw new Error('Object range size is outside the allowed limit');
  const response = await client().send(new GetObjectCommand({
    Bucket: bucket(),
    Key: fileKey,
    Range: `bytes=${startByte}-${startByte + maxBytes - 1}`,
  }));
  if (!response.Body) throw new Error('Uploaded object has no body');
  return Buffer.from(await response.Body.transformToByteArray());
}

export const s3UploadObjectStorage = {
  publicUrl: publicObjectUrl,
  createUploadUrl,
  async inspectObject(fileKey: string) {
    const object = await confirmUploadedObject(fileKey);
    return {
      ...(object.ContentLength !== undefined ? { size: object.ContentLength } : {}),
      ...(object.ContentType ? { contentType: object.ContentType } : {}),
    };
  },
  async readObject(fileKey: string) {
    return readUploadedObject(fileKey);
  },
};

export const s3ClassroomObjectStorage = {
  async putObject(input: { fileKey: string; body: Buffer; contentType: string }) {
    await client().send(new PutObjectCommand({
      Bucket: bucket(),
      Key: input.fileKey,
      Body: input.body,
      ContentType: input.contentType,
      ContentLength: input.body.byteLength,
    }));
  },
  createDownloadUrl(fileKey: string) {
    return getSignedUrl(
      client(),
      new GetObjectCommand({ Bucket: bucket(), Key: fileKey }),
      { expiresIn: CLASSROOM_MEDIA_DOWNLOAD_URL_TTL_SECONDS },
    );
  },
  async copyObject(input: { sourceKey: string; targetKey: string }) {
    const copySource = [bucket(), ...input.sourceKey.split('/')].map(encodeURIComponent).join('/');
    await client().send(new CopyObjectCommand({
      Bucket: bucket(),
      Key: input.targetKey,
      CopySource: copySource,
    }));
  },
  async deleteObject(fileKey: string) {
    await client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: fileKey }));
  },
};

export async function readUploadedObject(fileKey: string) {
  const response = await client().send(new GetObjectCommand({ Bucket: bucket(), Key: fileKey }));
  if (!response.Body) throw new Error('Uploaded object has no body');
  const bytes = await response.Body.transformToByteArray();
  return Buffer.from(bytes);
}
