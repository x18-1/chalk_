import { afterEach, describe, expect, it } from 'vitest';

import { s3ClassroomObjectStorage } from '../../src/storage/s3';

describe('S3 classroom object storage', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('keeps an owned Classroom Artifact media URL valid for a four-hour lesson', async () => {
    process.env.S3_ENDPOINT = 'http://localhost:9220';
    process.env.S3_REGION = 'us-east-1';
    process.env.S3_ACCESS_KEY_ID = 'test-access-key';
    process.env.S3_SECRET_ACCESS_KEY = 'test-secret-key';
    process.env.S3_BUCKET_UPLOADS = 'chalk-uploads';

    const url = new URL(await s3ClassroomObjectStorage.createDownloadUrl(
      'classrooms/user/classroom/artifacts/artifact/media/lesson.mp4',
    ));

    expect(url.searchParams.get('X-Amz-Expires')).toBe('14400');
  });
});
