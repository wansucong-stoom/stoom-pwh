// Desktop's agent and editor communicate asynchronously. Give the editor time
// to finish an already queued operation before returning its result to Codex.
export async function waitForEditorResult(read, {timeoutMs=30000, intervalMs=200, signal}={}) {
 const deadline=Date.now()+timeoutMs;
 for (;;) {
  const result=read();
  if (result.status!=='pending' || Date.now()>=deadline || signal?.aborted) return result;
  await new Promise(resolve=>{
   const timer=setTimeout(done,Math.min(intervalMs,Math.max(0,deadline-Date.now())));
   function done(){clearTimeout(timer);signal?.removeEventListener('abort',done);resolve();}
   signal?.addEventListener('abort',done,{once:true});
   if(signal?.aborted)done();
  });
 }
}
