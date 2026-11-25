import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const source = join(scriptDir, '..', 'src', 'db', 'migrations');
const destination = join(scriptDir, '..', 'dist', 'db', 'migrations');

mkdirSync(dirname(destination), { recursive: true });
cpSync(source, destination, { recursive: true });
