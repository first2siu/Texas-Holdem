import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const webDist = resolve('../../web/dist');
const serverPublic = resolve('./public');
if (existsSync(webDist)) {
  mkdirSync(serverPublic, { recursive: true });
  cpSync(webDist, serverPublic, { recursive: true });
}
