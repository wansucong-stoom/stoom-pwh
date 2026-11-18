import fs from 'node:fs/promises';
import path from 'node:path';
import {Buffer} from 'node:buffer';

// Preparing an existing file never needs the configured output/runtime folder.
// The host owns opening the panel; this result must not claim that it loaded.
export async function prepareDocumentOpen(input) {
  if (typeof input !== 'string' || !path.isAbsolute(input)) throw Error('열 문서의 실제 절대 경로가 필요합니다. 첨부 파일 경로를 확인하세요.');
  const source = await fs.realpath(input);
  const file = await fs.open(source, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw Error('일반 HWPX 문서 파일을 지정하세요.');
    if (!/\.hwpx$/i.test(source)) throw Error('HWPX 파일을 지정하세요. HWP는 원본을 보존해 HWPX로 변환한 뒤 엽니다.');
    const signature = Buffer.alloc(4);
    const {bytesRead} = await file.read(signature, 0, 4, 0);
    if (bytesRead !== 4 || !signature.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) throw Error('HWPX ZIP 파일의 시작 서명이 아닙니다. 빈 문서를 대신 만들지 말고 원본 파일을 확인하세요.');
    return {
      intent: 'open-existing', path: source, name: path.basename(source), bytes: stat.size,
      validation: 'regular-file-and-zip-signature', documentLoaded: false,
      nextAction: {
        tool: 'open_in_codex', arguments: {target: {type: 'file', path: source}, placement: 'right'},
        instruction: '이 기존 파일을 우측에 열고 실제 Pwh state의 source·ready를 확인하세요. 패널 열기가 실패해도 빈 문서를 만들거나 원본을 수정하지 마세요.',
        awaitingHostOpen: true,
      },
    };
  } finally { await file.close(); }
}
