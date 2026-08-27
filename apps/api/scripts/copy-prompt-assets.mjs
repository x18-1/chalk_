import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDirectory = resolve(apiDirectory, 'src/prompts');
const outputDirectory = resolve(apiDirectory, 'dist');

await mkdir(outputDirectory, { recursive: true });
for (const directory of ['templates', 'snippets']) {
  const target = resolve(outputDirectory, directory);
  await rm(target, { recursive: true, force: true });
  await cp(resolve(sourceDirectory, directory), target, { recursive: true });
}
