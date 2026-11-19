import {createAppServer} from './host.mjs';
import {randomUUID} from 'node:crypto';

const port=Number(process.argv[2]),initialPath=process.argv[3]||undefined,imported=process.argv[4]==='imported';
const chooseFile=process.connected?options=>new Promise((resolve,reject)=>{
 const id=randomUUID();
 const finish=(error,result)=>{
  clearTimeout(timer);
  process.off('message',onMessage);
  process.off('disconnect',onDisconnect);
  if(error)reject(error);else resolve(result);
 };
 const onMessage=message=>{if(message?.id===id)finish(message.error?Error(message.error):null,message.result);};
 const onDisconnect=()=>finish(Error('Pwh 창 연결이 종료되었습니다.'));
 const timer=setTimeout(()=>finish(Error('파일 선택 시간이 초과되었습니다.')),300000);
 timer.unref();
 process.on('message',onMessage);
 process.once('disconnect',onDisconnect);
 process.send({type:'choose-file',id,options},error=>{if(error)finish(error);});
}):undefined;
try{
 const {server,url}=await createAppServer({initialPath,imported,port,chooseFile,idleTimeoutMs:24*60*60*1000});
 process.stdout.write(JSON.stringify({url})+'\n');
 process.stdin.on('end',()=>{server.close();server.closeAllConnections?.();if(process.connected)process.disconnect();});
 process.stdin.resume();
}catch(error){process.stdout.write(JSON.stringify({errorCode:error.code||'START_FAILED'})+'\n');process.exitCode=1;}
