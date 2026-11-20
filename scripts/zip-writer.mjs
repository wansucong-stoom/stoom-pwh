import {crc32,deflateRawSync} from 'node:zlib';

export function writeZipMembers(members) {
 if(members.length>65535)throw Error('Too many ZIP members.');
 const local=[],central=[];
 let offset=0,centralBytes=0;
 for(const {name,bytes,stored,raw} of members){
  const filename=Buffer.from(name,'utf8'),directory=name.endsWith('/');
  const method=raw?.method??(stored||directory?0:8);
  const encoded=raw?.data??(method===0?bytes:deflateRawSync(bytes,{level:9}));
  const size=raw?.size??bytes.length,crc=raw?.crc??crc32(bytes);
  if(filename.length>65535||offset+30+filename.length+encoded.length>=0xffffffff)throw Error('ZIP member is too large.');
  const header=Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);
  header.writeUInt16LE(0x800,6);header.writeUInt16LE(method,8);header.writeUInt16LE(0x21,12);
  header.writeUInt32LE(crc,14);header.writeUInt32LE(encoded.length,18);header.writeUInt32LE(size,22);
  header.writeUInt16LE(filename.length,26);
  local.push(header,filename,encoded);
  const record=Buffer.alloc(46);
  record.writeUInt32LE(0x02014b50,0);record.writeUInt16LE(0x0314,4);record.writeUInt16LE(20,6);
  record.writeUInt16LE(0x800,8);record.writeUInt16LE(method,10);record.writeUInt16LE(0x21,14);
  record.writeUInt32LE(crc,16);record.writeUInt32LE(encoded.length,20);record.writeUInt32LE(size,24);
  record.writeUInt16LE(filename.length,28);
  record.writeUInt32LE(directory?((0o40755<<16)|0x10)>>>0:(0o100644<<16)>>>0,38);
  record.writeUInt32LE(offset,42);
  central.push(record,filename);
  centralBytes+=record.length+filename.length;
  offset+=header.length+filename.length+encoded.length;
 }
 const end=Buffer.alloc(22);
 end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(members.length,8);end.writeUInt16LE(members.length,10);
 end.writeUInt32LE(centralBytes,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...local,...central,end]);
}
