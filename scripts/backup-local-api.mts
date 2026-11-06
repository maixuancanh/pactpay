import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {embedded} from '../server/db/database.ts';
// Stop the API first. Never migrate before taking this recovery snapshot.
const db=embedded(resolve('server/.local-data'));
try{
 const folder=join(homedir(),'.pactpay-backups');await mkdir(folder,{recursive:true});
 await db.query('SELECT 1');const snapshot=await db.backup();await writeFile(join(folder,`before-relay-${Date.now()}.tar.gz`),Buffer.from(await snapshot.arrayBuffer()),{flag:'wx',mode:0o600});
 console.log('Private API recovery snapshot written outside the project.');
}finally{await db.close();}
