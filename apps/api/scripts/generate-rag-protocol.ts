import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { z } from 'zod';

import {
  ragIndexRequestSchema,
  ragIndexResponseSchema,
  ragQueryRequestSchema,
  ragQueryResponseSchema,
} from '../src/modules/knowledge-bases/protocol';

const output = resolve(process.cwd(), '../rag-sidecar/protocol/schema.json');
const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Chalk RAG sidecar protocol',
  type: 'object',
  properties: {
    indexRequest: z.toJSONSchema(ragIndexRequestSchema),
    indexResponse: z.toJSONSchema(ragIndexResponseSchema),
    queryRequest: z.toJSONSchema(ragQueryRequestSchema),
    queryResponse: z.toJSONSchema(ragQueryResponseSchema),
  },
  required: ['indexRequest', 'indexResponse', 'queryRequest', 'queryResponse'],
  additionalProperties: false,
};

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(schema, null, 2)}\n`, 'utf8');
console.log(`Wrote ${output}`);
