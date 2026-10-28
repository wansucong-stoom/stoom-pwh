import {zipEntries} from '../../scripts/setup.mjs';

const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}

// Store-only ZIP is sufficient for small, fully synthetic HWPX fixtures.
export function mapHwpxMember(bytes,member,transform){
 const entries=zipEntries(Buffer.from(bytes)).map(entry=>[entry.name,entry.name===member?Buffer.from(transform(entry.read().toString('utf8'))):entry.read()]);
 const locals=[],central=[];let offset=0,size=0;
 for(const[name,data]of entries){const file=Buffer.from(name),local=Buffer.alloc(30),record=Buffer.alloc(46),crc=crc32(data);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(file.length,26);record.writeUInt32LE(0x02014b50);record.writeUInt16LE(20,4);record.writeUInt16LE(20,6);record.writeUInt16LE(0x800,8);record.writeUInt32LE(crc,16);record.writeUInt32LE(data.length,20);record.writeUInt32LE(data.length,24);record.writeUInt16LE(file.length,28);record.writeUInt32LE(offset,42);locals.push(local,file,data);central.push(record,file);offset+=local.length+file.length+data.length;size+=record.length+file.length;}
 const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(size,12);end.writeUInt32LE(offset,16);return Buffer.concat([...locals,...central,end]);
}

// Fixture markup is emitted by this test's engine. This narrow scanner keeps
// direct paragraph children distinct from paragraphs inside its nested table.
export function setSyntheticHostVpos(xml,marker,vpos){
 const nodes=[],stack=[];
 for(const token of xml.matchAll(/<\/?([\w:]+)\b[^>]*>/g)){
  const raw=token[0],name=token[1];
  if(raw.startsWith('</')){const node=stack.pop();if(!node||node.name!==name)throw Error('Unbalanced synthetic XML');node.close=token.index;node.end=token.index+raw.length;continue;}
  const node={name,start:token.index,openEnd:token.index+raw.length,parent:stack.at(-1),children:[]};node.parent?.children.push(node);nodes.push(node);
  if(raw.endsWith('/>')){node.close=node.openEnd;node.end=node.openEnd;}else stack.push(node);
 }
 const text=nodes.find(n=>n.name==='hp:t'&&xml.slice(n.openEnd,n.close)===marker);if(!text)throw Error('Synthetic marker missing');
 let paragraph=text.parent;while(paragraph&&paragraph.name!=='hp:p')paragraph=paragraph.parent;
 const array=paragraph?.children.find(n=>n.name==='hp:linesegarray'),line=array?.children.find(n=>n.name==='hp:lineseg');if(!line)throw Error('Synthetic host line segment missing');
 const tag=xml.slice(line.start,line.end);if(!/\bvertpos="[^"]*"/.test(tag))throw Error('Synthetic host vpos missing');
 return xml.slice(0,line.start)+tag.replace(/\bvertpos="[^"]*"/,`vertpos="${vpos}"`)+xml.slice(line.end);
}
