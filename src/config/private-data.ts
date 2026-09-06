import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { dataDirectory } from './local-config';
const keyPath = join(dataDirectory, '.workspace-encryption-key');
if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 });
const key = readFileSync(keyPath);
export function encryptPrivateData(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return 'enc:v1:' + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}
export const privateDataTransformer = {
  to: encryptPrivateData,
  from(value: string) {
    if (!value.startsWith('enc:v1:')) return JSON.parse(value);
    const bytes = Buffer.from(value.slice(7), 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0,12));
    decipher.setAuthTag(bytes.subarray(12,28));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
  }
};
