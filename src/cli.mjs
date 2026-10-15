import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { engineInfo, inspectDocument, createDocument, editTemplate, previewDocument, exportPdf } from './engine.mjs';

const [command, ...args] = process.argv.slice(2);
try {
  let result;
  if (command === 'status') result = await engineInfo();
  else if (command === 'info') result = await inspectDocument(path.resolve(args[0]));
  else if (command === 'template') result = await (await import('./template.mjs')).inspectTemplate(path.resolve(args[0]), args[1] ? JSON.parse(await readFile(args[1], 'utf8')) : {});
  else if (command === 'fill') result = await (await import('./form.mjs')).fillInstitutionForm(JSON.parse(await readFile(args[0], 'utf8')));
  else if (command === 'create') result = await createDocument(JSON.parse(await readFile(args[0], 'utf8')), args[1] ? path.resolve(args[1]) : undefined);
  else if (command === 'edit') result = await editTemplate(path.resolve(args[0]), args[2] ? path.resolve(args[2]) : undefined, JSON.parse(await readFile(args[1], 'utf8')));
  else if (command === 'preview') {
    result = await previewDocument(path.resolve(args[0]), {pages: args[1] ? args[1].split(',').map(Number) : undefined});
    result = {...result, pages:result.pages.map(({dataUrl,...page})=>page)};
  } else if (command === 'pdf') result = await exportPdf(path.resolve(args[0]), path.resolve(args[1]));
  else if (command === 'serve') {
    const html = await readFile(path.resolve(args[0]));
    const server = createServer((req,res)=>{
      if (req.url !== '/' && req.url !== '/index.html') {res.writeHead(404).end();return;}
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",'Cache-Control':'no-store'}).end(html);
    });
    server.listen(Number(args[1]||0),'127.0.0.1',()=>console.log(JSON.stringify({url:`http://127.0.0.1:${server.address().port}/`})));
  } else throw new Error('사용법: status | info FILE | template FILE [OPTIONS_JSON] | fill SPEC_JSON | create SPEC [OUTPUT] | edit FILE CHANGES [OUTPUT] | preview FILE [1,2] | pdf FILE OUTPUT | serve HTML [PORT]');
  if (result) console.log(JSON.stringify(result,null,2));
} catch (error) {console.error(error.message);process.exitCode=1;}
