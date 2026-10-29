import {createAppServer} from './host.mjs';

const initialPath=process.argv[2]||undefined;
const {server,url}=await createAppServer({initialPath,idleTimeoutMs:24*60*60*1000});
process.stdout.write(JSON.stringify({url})+'\n');
process.stdin.on('end',()=>{server.close();server.closeAllConnections?.();});
process.stdin.resume();
