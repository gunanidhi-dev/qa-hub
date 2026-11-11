import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const APP_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const appPath = (...parts) => resolve(APP_ROOT, ...parts);
