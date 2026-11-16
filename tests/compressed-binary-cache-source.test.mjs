import test from 'node:test';import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
import {runRustTests} from './engine-source-ownership/harness.mjs';
test('actual compressed-entry cache enforces complete identity, LRU and memory bounds',{skip:!process.env.PWH_ENGINE_SOURCE?'Requires PWH_ENGINE_SOURCE':false},async()=>{
 const source=await fs.readFile(path.join(process.env.PWH_ENGINE_SOURCE,'src/serializer/hwpx/writer.rs'),'utf8'),start=source.indexOf('// Pwh bounded compressed-entry reuse.'),end=source.indexOf('// End Pwh bounded compressed-entry reuse.');
 if(start<0||end<start)throw Error('Missing actual compressed-entry cache source');
 const code=`use std::sync::Arc;
 ${source.slice(start,end)}
 fn key(n:u8,name:&str,len:usize)->CompressedEntryKey{CompressedEntryKey{digest:[n;32],len,name:name.into()}}
 fn reset(){COMPRESSED_ENTRY_CACHE.with(|c|c.borrow_mut().clear());}
 #[test]fn identity_and_shared_allocation(){reset();let a:Arc<[u8]>=vec![1;8].into();retain_compressed_entry(key(1,"image1",10),Arc::clone(&a));assert!(Arc::ptr_eq(&a,&compressed_entry(&key(1,"image1",10)).unwrap()));for k in [key(2,"image1",10),key(1,"image2",10),key(1,"image1",11)]{assert!(compressed_entry(&k).is_none());}}
 #[test]fn recently_used_entries_survive_eviction(){reset();for i in 0..COMPRESSED_CACHE_ENTRIES{retain_compressed_entry(key(i as u8,"image",1),vec![i as u8].into());}compressed_entry(&key(0,"image",1)).unwrap();retain_compressed_entry(key(100,"image",1),vec![100].into());assert!(compressed_entry(&key(0,"image",1)).is_some());assert!(compressed_entry(&key(1,"image",1)).is_none());COMPRESSED_ENTRY_CACHE.with(|c|assert_eq!(c.borrow().len(),COMPRESSED_CACHE_ENTRIES));}
 #[test]fn byte_budget_and_oversized_bypass(){reset();let a:Arc<[u8]>=vec![1;COMPRESSED_CACHE_BYTES/2+1].into();retain_compressed_entry(key(1,"image",a.len()),Arc::clone(&a));retain_compressed_entry(key(2,"image",a.len()),Arc::clone(&a));assert!(compressed_entry(&key(1,"image",a.len())).is_none());COMPRESSED_ENTRY_CACHE.with(|c|assert!(c.borrow().iter().map(|e|e.archive.len()).sum::<usize>()<=COMPRESSED_CACHE_BYTES));retain_compressed_entry(key(3,"image",1),vec![3;COMPRESSED_CACHE_BYTES+1].into());assert!(compressed_entry(&key(3,"image",1)).is_none());}
 #[test]fn repeat_insert_replaces_one_entry(){reset();retain_compressed_entry(key(1,"image",1),vec![1].into());retain_compressed_entry(key(1,"image",1),vec![2].into());COMPRESSED_ENTRY_CACHE.with(|c|assert_eq!(c.borrow().len(),1));assert_eq!(&*compressed_entry(&key(1,"image",1)).unwrap(),&[2]);}
 `;
 await runRustTests({name:'compressed-entry-cache',sourceSha256:createHash('sha256').update(source).digest('hex'),code});
});
