import {createServer} from 'node:net';
import {randomBytes} from 'node:crypto';

// Windows GUI processes do not reliably retain console stdin. Use a private,
// authenticated local named pipe for this app's own window lifecycle instead.
export async function createElectronController({onReady=()=>{},onFailure=()=>{}}={}){
 if(process.platform!=='win32')throw Error('Pwh Desktop은 Windows x64에서 실행됩니다.');
 const pipe='\\\\.\\pipe\\stoom-pwh-'+process.pid+'-'+randomBytes(16).toString('hex'),token=randomBytes(32).toString('hex');
 let socket=null,sequence=0,closed=false;const pending=new Map();
 const fail=error=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(error);}pending.clear();if(!closed)onFailure(error);};
 const server=createServer(connection=>{
  if(socket||closed){connection.destroy();return;}
  let buffer='',authenticated=false;const handshake=setTimeout(()=>connection.destroy(),5000);handshake.unref?.();
  connection.on('data',chunk=>{buffer+=chunk.toString('utf8');if(buffer.length>1024*1024){connection.destroy();return;}
   for(let i;(i=buffer.indexOf('\n'))>=0;){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);let message;try{message=JSON.parse(line);}catch{connection.destroy();return;}
    if(!authenticated){if(message.type!=='hello'||message.token!==token){connection.destroy();return;}authenticated=true;clearTimeout(handshake);socket=connection;continue;}
    if(message.type==='ready'){onReady();continue;}
    const request=pending.get(message.id);if(!request)continue;pending.delete(message.id);clearTimeout(request.timer);message.error?request.reject(Error(message.error)):request.resolve(message.result);
   }
  });
  connection.on('error',error=>{if(authenticated)fail(error);});connection.on('close',()=>{clearTimeout(handshake);if(socket===connection){socket=null;fail(Error('Pwh 앱 창 연결이 종료되었습니다.'));}});
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(pipe,resolve);});
 const send=(method,params={})=>new Promise((resolve,reject)=>{
  if(closed||!socket)return reject(Error('Pwh 앱 창이 준비되지 않았습니다.'));
  const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('Pwh 앱 창 응답 시간이 초과되었습니다.'));},10000);timer.unref?.();pending.set(id,{resolve,reject,timer});
  socket.write(JSON.stringify({id,method,params})+'\n',error=>{if(error&&pending.has(id)){clearTimeout(timer);pending.delete(id);reject(error);}});
 });
 const close=()=>{if(closed)return;closed=true;fail(Error('Pwh 앱 창 연결이 종료되었습니다.'));socket?.end();server.close();};
 return {pipe,token,close,attachProcess(child){child.once('error',fail);child.once('exit',close);},requestClose:()=>void send('close').catch(onFailure),resolveDroppedFiles:(_url,id,count)=>send('resolve-drop',{id,count})};
}
