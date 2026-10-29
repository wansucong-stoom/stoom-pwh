import {createAppServer} from './host.mjs';

const port=Number(process.argv[2]),initialPath=process.argv[3]||undefined;
try{
 const {server,url}=await createAppServer({initialPath,port,idleTimeoutMs:24*60*60*1000});
 process.stdout.write(JSON.stringify({url})+'\n');
 process.stdin.on('end',()=>{server.close();server.closeAllConnections?.();});
 process.stdin.resume();
}catch(error){process.stdout.write(JSON.stringify({errorCode:error.code||'START_FAILED'})+'\n');process.exitCode=1;}
