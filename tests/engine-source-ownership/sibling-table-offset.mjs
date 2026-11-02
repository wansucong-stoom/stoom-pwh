import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {loadEngineSource,sourceBlock,runRustTests} from './harness.mjs';
const {root}=await loadEngineSource();
const source=await fs.readFile(path.join(root,'src/renderer/float_placement.rs'),'utf8');
const budget=await fs.readFile(path.join(root,'src/renderer/typeset/table/continuation/fragment/budget.rs'),'utf8');
const paint=await fs.readFile(path.join(root,'src/renderer/layout/table_partial.rs'),'utf8');
assert.ok(budget.includes('sibling_table_anchor_offset_already_spent('));assert.ok(paint.includes('sibling_table_anchor_offset_already_spent('));
assert.ok(paint.includes('&& !anchor_offset_already_spent'));assert.ok(!budget.includes('let has_earlier_sibling_table'));
const code=`
enum Control{Table(()),Other}
struct Paragraph{controls:Vec<Control>}
${sourceBlock(source,'pub(crate) fn sibling_table_anchor_offset_already_spent(')}
fn host()->Paragraph{Paragraph{controls:vec![Control::Other,Control::Table(()),Control::Other,Control::Table(())]}}
#[test]fn later_source_table_on_fresh_page_has_consumed_the_anchor(){assert!(sibling_table_anchor_offset_already_spent(&host(),3,false,true,0.0));}
#[test]fn first_source_table_keeps_its_positive_offset(){assert!(!sibling_table_anchor_offset_already_spent(&host(),1,false,true,0.0));}
#[test]fn occupied_current_page_keeps_ordinary_positive_offset(){assert!(!sibling_table_anchor_offset_already_spent(&host(),3,false,false,0.0));}
#[test]fn positive_current_flow_origin_keeps_ordinary_offset(){assert!(!sibling_table_anchor_offset_already_spent(&host(),3,false,true,18.0));}
#[test]fn continuation_retains_its_separate_existing_offset_rule(){assert!(!sibling_table_anchor_offset_already_spent(&host(),3,true,true,0.0));}
#[test]fn preceding_metadata_or_shape_is_not_a_consuming_table(){let p=Paragraph{controls:vec![Control::Other,Control::Other,Control::Table(())]};assert!(!sibling_table_anchor_offset_already_spent(&p,2,false,true,0.0));}
#[test]fn later_table_does_not_consume_an_earlier_tables_anchor(){let p=Paragraph{controls:vec![Control::Table(()),Control::Table(())]};assert!(!sibling_table_anchor_offset_already_spent(&p,0,false,true,0.0));}
#[test]fn existing_budget_subpixel_boundary_is_preserved(){assert!(sibling_table_anchor_offset_already_spent(&host(),3,false,true,0.999));assert!(!sibling_table_anchor_offset_already_spent(&host(),3,false,true,1.0));}
#[test]fn predicate_is_identical_to_existing_budget_for_all_input_combinations(){let p=host();for index in 0..p.controls.len(){for continuation in [false,true]{for empty in [false,true]{for height in [0.0,0.5,0.999,1.0,2.0]{let old=!continuation&&empty&&height<1.0&&p.controls.iter().take(index).any(|c|matches!(c,Control::Table(_)));assert_eq!(sibling_table_anchor_offset_already_spent(&p,index,continuation,empty,height),old);}}}}}
`;
await runRustTests({name:'sibling-offset-owner',sourceSha256:createHash('sha256').update(source).digest('hex'),code});
