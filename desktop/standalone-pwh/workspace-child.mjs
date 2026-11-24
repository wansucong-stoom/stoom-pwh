import {createAppServer} from './host.mjs';
import {childAuthMethods} from './chatgpt-auth.mjs';
import {randomUUID} from 'node:crypto';

const port=Number(process.argv[2]),initialPath=process.argv[3]||undefined,report=process.argv[4]==='report',imported=report||process.argv[4]==='imported';
const hasParent=process.connected;
const requestParent=(message,timeout,timeoutMessage)=>new Promise((resolve,reject)=>{
 const id=randomUUID();
 const finish=(error,result)=>{
  clearTimeout(timer);
  process.off('message',onMessage);
  process.off('disconnect',onDisconnect);
  if(error)reject(error);else resolve(result);
 };
 const onMessage=message=>{if(message?.id===id)finish(message.error?Error(message.error):null,message.result);};
 const onDisconnect=()=>finish(Error('Pwh 창 연결이 종료되었습니다.'));
 const timer=setTimeout(()=>finish(Error(timeoutMessage)),timeout);
 timer.unref();
 process.on('message',onMessage);
 process.once('disconnect',onDisconnect);
 process.send({id,...message},error=>{if(error)finish(error);});
});
const chooseFile=hasParent?options=>requestParent({type:'choose-file',options},300000,'파일 선택 시간이 초과되었습니다.'):undefined;
const chatgptAuth=hasParent?{
 ...Object.fromEntries(childAuthMethods.map(method=>[
  method,accountId=>requestParent({type:'chatgpt-auth',method,accountId},120000,'ChatGPT 계정 연결 시간이 초과되었습니다.'),
 ])),
 close(){},
}:undefined;
try{
 const {server,url}=await createAppServer({initialPath,imported,report,port,chooseFile,chatgptAuth,idleTimeoutMs:24*60*60*1000});
 process.stdout.write(JSON.stringify({url})+'\n');
 process.stdin.on('end',()=>{server.close();server.closeAllConnections?.();if(process.connected)process.disconnect();});
 process.stdin.resume();
}catch(error){process.stdout.write(JSON.stringify({errorCode:error.code||'START_FAILED'})+'\n');process.exitCode=1;}
