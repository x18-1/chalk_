import { randomUUID } from 'node:crypto';

import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createReadResourceTool, createResourceReader } from '../../src/agent/tools/read/read-resource';
import { createUploadedFileResourceAdapterFromDatabase } from '../../src/agent/tools/read/uploaded-file-reader';
import { closeDb, getDb } from '../../src/db/client';
import { authUsers, attachments, conversations } from '../../src/db/schema';

const hasObjectStorage = Boolean(
  process.env.S3_ENDPOINT
  && process.env.S3_ACCESS_KEY_ID
  && process.env.S3_SECRET_ACCESS_KEY
  && process.env.S3_BUCKET_UPLOADS,
);

const describeStorage = hasObjectStorage ? describe : describe.skip;

describeStorage('read_resource MinIO integration', () => {
  const suffix = randomUUID();
  const objectKey = `read-test/${suffix}.txt`;
  const email = `read-storage-${suffix}@chalk.local`;
  const content = '第一行：三角形\n第二行：先找已知条件\n第三行：再选择定理\n';
  const client = new S3Client({
    region: process.env.S3_REGION ?? 'us-east-1',
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
  });
  let userId: string;
  let conversationId: string;
  let attachmentId: string;

  beforeAll(async () => {
    const db = getDb();
    const user = (await db.insert(authUsers).values({ email }).returning())[0]!;
    userId = user.id;
    const conversation = (await db.insert(conversations).values({
      userId,
      sessionId: `read-storage-${suffix}`,
      sessionFilePath: `/tmp/read-storage-${suffix}.jsonl`,
    }).returning())[0]!;
    conversationId = conversation.id;
    const attachment = (await db.insert(attachments).values({
      userId,
      conversationId,
      fileKey: objectKey,
      filename: 'lesson.txt',
      contentType: 'text/plain',
      size: Buffer.byteLength(content),
      status: 'ready',
    }).returning())[0]!;
    attachmentId = attachment.id;
    await client.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_UPLOADS!,
      Key: objectKey,
      Body: content,
      ContentType: 'text/plain',
    }));
  });

  afterAll(async () => {
    await client.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET_UPLOADS!, Key: objectKey }));
    if (userId) await getDb().delete(authUsers).where(eq(authUsers.id, userId));
    await client.destroy();
    await closeDb();
  });

  it('reads a real MinIO object in pages and resumes with the returned cursor', async () => {
    const reader = createResourceReader([createUploadedFileResourceAdapterFromDatabase(getDb())]);
    const tool = createReadResourceTool(reader, process.env.CREDENTIAL_ENCRYPTION_KEY!);
    const context = { ownerId: userId, sessionId: `read-storage-${suffix}`, conversationId };

    const first = await tool.execute({
      resource: { kind: 'upload', id: attachmentId },
      maxLines: 2,
      maxBytes: 1_024,
    }, context);
    expect(first.content).toEqual([{ type: 'text', text: '第一行：三角形\n第二行：先找已知条件' }]);
    expect(first.details).toMatchObject({ resource: { kind: 'upload', id: attachmentId }, hasMore: true });

    const cursor = (first.details as { continuation: { cursor: string } }).continuation.cursor;
    const second = await tool.execute({
      resource: { kind: 'upload', id: attachmentId },
      cursor,
      maxLines: 2,
      maxBytes: 1_024,
    }, context);
    expect(second.content).toEqual([{ type: 'text', text: '第三行：再选择定理' }]);
    expect(second.details).toMatchObject({ hasMore: false, startLine: 3 });
  });

  it('detects a changed object before continuing a previous read', async () => {
    const reader = createResourceReader([createUploadedFileResourceAdapterFromDatabase(getDb())]);
    const tool = createReadResourceTool(reader, process.env.CREDENTIAL_ENCRYPTION_KEY!);
    const context = { ownerId: userId, sessionId: `read-storage-${suffix}`, conversationId };
    const first = await tool.execute({ resource: { kind: 'upload', id: attachmentId }, maxLines: 1, maxBytes: 1_024 }, context);
    const cursor = (first.details as { continuation: { cursor: string } }).continuation.cursor;

    await client.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_UPLOADS!,
      Key: objectKey,
      Body: `${content}对象已变化\n`,
      ContentType: 'text/plain',
    }));

    await expect(tool.execute({ resource: { kind: 'upload', id: attachmentId }, cursor }, context))
      .rejects.toMatchObject({ code: 'read_snapshot_changed' });
  });
});
