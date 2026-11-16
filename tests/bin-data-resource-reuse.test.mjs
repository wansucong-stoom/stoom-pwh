import test from 'node:test';import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
import {runRustTests} from './engine-source-ownership/harness.mjs';
test('the actual container cache preserves owner identity, bounds and lazy reads',{skip:!process.env.PWH_ENGINE_SOURCE?'Requires PWH_ENGINE_SOURCE':false},async()=>{
 const source=await fs.readFile(path.join(process.env.PWH_ENGINE_SOURCE,'src/model/bin_data.rs'),'utf8'),start=source.indexOf('// Pwh bounded container resource cache.'),end=source.indexOf('// End Pwh bounded container resource cache.');
 if(start<0||end<start)throw Error('Missing actual bounded container cache source');
 const code=`use std::sync::{Arc,atomic::{AtomicUsize,Ordering}};
 trait BinDataResolver:std::fmt::Debug+Send+Sync {fn resolve_shared(&self,key:&str)->Arc<[u8]>;fn resolve_limited_shared(&self,key:&str,max:usize)->Option<Arc<[u8]>>;fn cache_immutable_bytes(&self)->bool{false}}
 ${source.slice(start,end)}
 #[derive(Debug)]struct Source{calls:Arc<AtomicUsize>,size:usize,byte:u8}
 impl BinDataResolver for Source{
 fn cache_immutable_bytes(&self)->bool{true}
 fn resolve_shared(&self,_:&str)->Arc<[u8]>{self.calls.fetch_add(1,Ordering::Relaxed);vec![self.byte;self.size].into()}
 fn resolve_limited_shared(&self,key:&str,max:usize)->Option<Arc<[u8]>>{if self.size>max{self.calls.fetch_add(1,Ordering::Relaxed);None}else{Some(self.resolve_shared(key))}}}
 fn owner(size:usize,byte:u8)->(Arc<dyn BinDataResolver>,Arc<AtomicUsize>){let calls=Arc::new(AtomicUsize::new(0));(Arc::new(Source{calls:Arc::clone(&calls),size,byte}),calls)}
 fn reset(){BIN_RESOURCE_CACHE.with(|cache|cache.borrow_mut().clear());}
 #[test]fn same_owner_and_key_share_one_inflate_and_allocation(){reset();let(r,c)=owner(4,1);let a=cached_resolve_shared(&r,"image",Some(4)).unwrap();let b=cached_resolve_shared(&Arc::clone(&r),"image",None).unwrap();assert!(Arc::ptr_eq(&a,&b));assert_eq!(c.load(Ordering::Relaxed),1);}
 #[test]fn same_resource_key_from_other_documents_never_reuses_stale_bytes(){reset();let(a,_)=owner(4,1);let(b,c)=owner(4,2);assert_eq!(&*cached_resolve_shared(&a,"image",None).unwrap(),&[1;4]);assert_eq!(&*cached_resolve_shared(&b,"image",None).unwrap(),&[2;4]);assert_eq!(c.load(Ordering::Relaxed),1);}
 #[test]fn every_bounded_hit_checks_its_own_limit_without_reinflation(){reset();let(r,c)=owner(4,1);cached_resolve_shared(&r,"image",Some(4)).unwrap();assert!(cached_resolve_shared(&r,"image",Some(3)).is_none());assert_eq!(c.load(Ordering::Relaxed),1);}
 #[test]fn a_failed_small_read_does_not_poison_a_larger_read(){reset();let(r,c)=owner(4,1);assert!(cached_resolve_shared(&r,"image",Some(3)).is_none());assert!(cached_resolve_shared(&r,"image",Some(4)).is_some());assert_eq!(c.load(Ordering::Relaxed),2);}
 #[test]fn closing_a_document_releases_its_container_owner(){reset();let(r,_)=owner(4,1);let weak=Arc::downgrade(&r);cached_resolve_shared(&r,"image",None).unwrap();drop(r);assert!(weak.upgrade().is_none());let(next,_)=owner(4,2);cached_resolve_shared(&next,"image",None).unwrap();BIN_RESOURCE_CACHE.with(|cache|assert_eq!(cache.borrow().len(),1));}
 #[test]fn entry_budget_evicts_the_least_recent_resource(){reset();let(r,c)=owner(1,1);for i in 0..=BIN_CACHE_ENTRIES{cached_resolve_shared(&r,&i.to_string(),None).unwrap();}BIN_RESOURCE_CACHE.with(|cache|assert_eq!(cache.borrow().len(),BIN_CACHE_ENTRIES));let before=c.load(Ordering::Relaxed);cached_resolve_shared(&r,"0",None).unwrap();assert_eq!(c.load(Ordering::Relaxed),before+1);}
 #[test]fn byte_budget_is_independent_of_entry_budget(){reset();let(r,c)=owner(24*1024*1024,1);for key in ["a","b","c"]{cached_resolve_shared(&r,key,None).unwrap();}BIN_RESOURCE_CACHE.with(|cache|{let entries=cache.borrow();assert_eq!(entries.len(),2);assert!(entries.iter().map(|e|e.bytes.len()).sum::<usize>()<=BIN_CACHE_BYTES);});cached_resolve_shared(&r,"a",None).unwrap();assert_eq!(c.load(Ordering::Relaxed),4);}
 #[test]fn custom_resolvers_retain_live_reads_unless_they_opt_in(){reset();#[derive(Debug)]struct Live(AtomicUsize);impl BinDataResolver for Live{fn resolve_shared(&self,_:&str)->Arc<[u8]>{vec![self.0.fetch_add(1,Ordering::Relaxed) as u8].into()}fn resolve_limited_shared(&self,k:&str,max:usize)->Option<Arc<[u8]>>{(max>=1).then(||self.resolve_shared(k))}}let r:Arc<dyn BinDataResolver>=Arc::new(Live(AtomicUsize::new(0)));assert_eq!(&*cached_resolve_shared(&r,"x",None).unwrap(),&[0]);assert_eq!(&*cached_resolve_shared(&r,"x",Some(1)).unwrap(),&[1]);}
 `;
 await runRustTests({name:'bin-data-resource-reuse',sourceSha256:createHash('sha256').update(source).digest('hex'),code});
});
