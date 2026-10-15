import {previewDocument} from '../src/engine.mjs';
const input=process.argv[2];
if (!input) throw new Error('Usage: node scripts/reference-preview.mjs /absolute/document.hwpx');
const result=await previewDocument(input,{maxDimension:1600});
console.log(JSON.stringify({...result,pages:result.pages.map(({dataUrl,...p})=>p)},null,2));
