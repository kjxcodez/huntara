import { loadAndValidateEnv } from '@huntara/core';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const env = loadAndValidateEnv(resolve(__dirname, '../../.env'));

export { env };
