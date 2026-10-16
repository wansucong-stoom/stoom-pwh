const LOCAL_FONT_TIMEOUT_MS=1000;
function cssQuoted(value){
 let escaped='';
 for(const char of value){
  const code=char.codePointAt(0);
  if(char==='"'||char==='\\')escaped+='\\'+char;
  else if(code<=0x1f||code===0x7f||(code>=0xd800&&code<=0xdfff))escaped+='\\'+code.toString(16)+' ';
  else escaped+=char;
 }
 return '"'+escaped+'"';
}

/** Use exact OS face names before transferring font bytes. The catalog owner
 * must exclude names shared by different faces; this helper cannot prove byte
 * identity or infer whether a catalog name is ambiguous. Never search family. */
export async function tryLoadExactLocalFont(alias,face,FontFaceClass=globalThis.FontFace){
 if(typeof FontFaceClass!=='function'||typeof alias!=='string'||!alias||!face)return null;
 const names=[...new Set([face.fullName,face.postscriptName].filter(name=>typeof name==='string'&&name.trim()&&name.length<=1024))];
 if(!names.length)return null;
 const weight=face.weight??400,slant=face.slant??'normal';
 if(!Number.isFinite(weight)||weight<1||weight>1000||!['normal','italic','oblique'].includes(slant))return null;
 let timer;
 try{
  const font=new FontFaceClass(alias,names.map(name=>'local('+cssQuoted(name)+')').join(', '),{weight:String(weight),style:slant});
  const loaded=Promise.resolve().then(()=>font.load()).then(()=>font.status==='loaded'?font:null);
  return await Promise.race([loaded,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),LOCAL_FONT_TIMEOUT_MS);})]);
 }catch{return null;}
 finally{if(timer!==undefined)clearTimeout(timer);}
}
