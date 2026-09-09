import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

const source = resolve(process.env.DATA_DIR || join(process.cwd(), 'data'));
const destinationRoot = resolve(process.env.BACKUP_DIR || join(process.cwd(), 'backups'));
if (source === destinationRoot || destinationRoot.startsWith(source + '/')) throw new Error('BACKUP_DIR deve ficar fora de DATA_DIR.');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const destination = join(destinationRoot, `astro-builder-${timestamp}`);
await mkdir(destinationRoot, { recursive:true });
await cp(source, destination, { recursive:true, errorOnExist:true, preserveTimestamps:true });

async function files(directory, root=directory){const entries=await readdir(directory,{withFileTypes:true});const result=[];for(const entry of entries){const path=join(directory,entry.name);if(entry.isDirectory())result.push(...await files(path,root));else{const content=await readFile(path);result.push({path:path.slice(root.length+1),bytes:(await stat(path)).size,sha256:createHash('sha256').update(content).digest('hex')});}}return result;}
const manifest={createdAt:new Date().toISOString(),source:basename(source),files:await files(destination)};
await writeFile(join(destination,'backup-manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600});
const retention=Math.max(1,Number(process.env.BACKUP_RETENTION||14));
const backups=(await readdir(destinationRoot,{withFileTypes:true})).filter(entry=>entry.isDirectory()&&entry.name.startsWith('astro-builder-')).sort((a,b)=>b.name.localeCompare(a.name));
for(const old of backups.slice(retention))await rm(join(destinationRoot,old.name),{recursive:true,force:true});
console.log(JSON.stringify({ok:true,destination,files:manifest.files.length,retention}));
