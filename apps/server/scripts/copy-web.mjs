import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webDist = resolve(__dirname, '../../web/dist');
const serverPublic = resolve(__dirname, '../public');
if (existsSync(webDist)) {
  mkdirSync(serverPublic, { recursive: true });
  cpSync(webDist, serverPublic, { recursive: true });
}
