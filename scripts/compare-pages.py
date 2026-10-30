"""Compare user-provided Hancom and Pwh renderings of the same source document.

Inputs are read-only.  A new output directory receives colour overlays and a
provenance report.  This utility does not launch Hancom or claim that either
rendering was generated from the supplied source: that provenance is supplied
by the operator and should be recorded at export time.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def open_pages(path: Path):
    if path.suffix.lower() == '.pdf':
        try:
            import pypdfium2 as pdfium
        except ImportError as exc:
            raise RuntimeError('PDF 비교에는 pypdfium2가 필요합니다.') from exc
        pdf = pdfium.PdfDocument(str(path))
        def render(index, target_width=None):
            page = pdf[index]
            try:
                width, height = page.get_size()
                scale = target_width / width if target_width else 2.0
                bitmap = page.render(scale=scale, rotation=0)
                try:
                    return bitmap.to_pil().convert('RGB'), (width, height)
                finally:
                    bitmap.close()
            finally:
                page.close()
        return len(pdf), render, pdf.close
    image = Image.open(path)
    count = getattr(image, 'n_frames', 1)
    def render(index, target_width=None):
        image.seek(index)
        rendered = image.convert('RGB')
        # The reference may be rasterized to the candidate's width only if its
        # aspect ratio agrees; scaling is reported and never used to conceal
        # different paper dimensions.
        if target_width and target_width != rendered.width:
            height = round(rendered.height * target_width / rendered.width)
            rendered = rendered.resize((target_width, height), Image.Resampling.LANCZOS)
        return rendered, None
    return count, render, image.close


def selected_pages(value: str, maximum: int) -> list[int]:
    if value == 'all':
        return list(range(1, maximum + 1))
    selected = set()
    for part in value.split(','):
        part = part.strip()
        if not part:
            raise ValueError('쪽 범위를 확인해 주세요.')
        bounds = part.split('-')
        if len(bounds) > 2 or not all(x.isdecimal() for x in bounds):
            raise ValueError('쪽 범위는 1,3,5-7 형식으로 입력해 주세요.')
        start, end = int(bounds[0]), int(bounds[-1])
        if start < 1 or end < start or end > maximum:
            raise ValueError(f'쪽 범위는 1~{maximum}이어야 합니다.')
        selected.update(range(start, end + 1))
    return sorted(selected)


def compare(reference: Image.Image, candidate: Image.Image, threshold: int, tolerance: int):
    # A one-pixel rasterization rounding discrepancy is padded, not scaled.
    if abs(reference.width - candidate.width) > 2 or abs(reference.height - candidate.height) > 2:
        raise ValueError(f'쪽 크기/비율이 다릅니다: 기준 {reference.size}, Pwh {candidate.size}')
    size = (max(reference.width, candidate.width), max(reference.height, candidate.height))
    def pad(im):
        canvas = Image.new('RGB', size, 'white')
        canvas.paste(im, (0, 0))
        return canvas
    reference, candidate = pad(reference), pad(candidate)
    ref = np.asarray(reference.convert('L')) < threshold
    actual = np.asarray(candidate.convert('L')) < threshold
    shared = ref & actual
    ref_only, actual_only = ref & ~actual, actual & ~ref
    if tolerance:
        kernel = 2 * tolerance + 1
        near_ref = np.asarray(Image.fromarray(ref.astype('uint8') * 255).filter(ImageFilter.MaxFilter(kernel))) > 0
        near_actual = np.asarray(Image.fromarray(actual.astype('uint8') * 255).filter(ImageFilter.MaxFilter(kernel))) > 0
        near = (ref_only & near_actual) | (actual_only & near_ref)
    else:
        near = np.zeros_like(ref)
    rgba = np.full((*ref.shape, 3), 255, dtype=np.uint8)
    rgba[shared] = (125, 125, 125)
    rgba[ref_only] = (211, 65, 65)
    rgba[actual_only] = (42, 100, 202)
    rgba[near] = (231, 142, 37)
    union = int((ref | actual).sum())
    diff = int((ref ^ actual).sum())
    return Image.fromarray(rgba), {
        'width': size[0], 'height': size[1], 'referenceInkPixels': int(ref.sum()),
        'pwhInkPixels': int(actual.sum()), 'exactCommonPixels': int(shared.sum()),
        'differentPixels': diff, 'nearbyDifferencePixels': int(near.sum()),
        'contentIoU': round(int(shared.sum()) / union, 6) if union else 1.0,
        'pagePixelDifferenceFraction': round(diff / (size[0] * size[1]), 6),
    }


def main():
    parser = argparse.ArgumentParser(description='같은 원본의 한글/Pwh 출력 쪽을 겹쳐 비교합니다.')
    parser.add_argument('--source', required=True, type=Path, help='비교에 사용한 원본 HWP/HWPX')
    parser.add_argument('--hancom', required=True, type=Path, help='한글에서 출력한 기준 PDF 또는 이미지')
    parser.add_argument('--pwh', required=True, type=Path, help='Pwh에서 출력한 PDF 또는 이미지')
    parser.add_argument('--out', required=True, type=Path, help='아직 없는 결과 폴더')
    parser.add_argument('--pages', default='all', help='비교할 쪽: all 또는 1,3,5-7')
    parser.add_argument('--threshold', type=int, default=245)
    parser.add_argument('--tolerance', type=int, default=2)
    args = parser.parse_args()
    if not 1 <= args.threshold <= 255 or not 0 <= args.tolerance <= 5:
        parser.error('threshold는 1~255, tolerance는 0~5여야 합니다.')
    source, reference, candidate, out = (p.resolve() for p in (args.source, args.hancom, args.pwh, args.out))
    if source.suffix.lower() not in ('.hwp', '.hwpx') or not all(p.is_file() for p in (source, reference, candidate)):
        parser.error('원본 HWP/HWPX와 두 출력 파일을 지정해 주세요.')
    if out.exists():
        parser.error('기존 파일을 보존하기 위해 아직 없는 결과 폴더를 지정해 주세요.')
    hashes = {key: sha256(value) for key, value in [('source', source), ('hancom', reference), ('pwh', candidate)]}
    ref_count, get_ref, close_ref = open_pages(reference)
    try:
        cand_count, get_cand, close_cand = open_pages(candidate)
        try:
            pages = selected_pages(args.pages, min(ref_count, cand_count))
            out.mkdir(parents=False, exist_ok=False)
            records = []
            for number in pages:
                image, candidate_size = get_cand(number - 1)
                ref, reference_size = get_ref(number - 1, image.width)
                if candidate_size and reference_size and any(abs(a-b) > 0.1 for a,b in zip(candidate_size, reference_size)):
                    records.append({'page': number, 'status': 'paper-size-mismatch', 'hancomPoints': reference_size, 'pwhPoints': candidate_size})
                    continue
                try:
                    overlay, metrics = compare(ref, image, args.threshold, args.tolerance)
                except ValueError as error:
                    records.append({'page': number, 'status': 'size-mismatch', 'message': str(error)})
                    continue
                name = f'page-{number:04d}-overlay.png'
                overlay.save(out / name)
                records.append({'page': number, 'status': 'compared', 'overlay': name, **metrics})
            if any(sha256(value) != hashes[key] for key, value in [('source', source), ('hancom', reference), ('pwh', candidate)]):
                raise RuntimeError('비교 중 입력 파일이 변경되어 결과를 확정할 수 없습니다.')
            result = {'source': str(source), 'hancom': str(reference), 'pwh': str(candidate), 'sha256': hashes,
                'provenance': '두 출력물이 이 원본에서 만들어졌는지는 작업자가 확인해야 합니다.',
                'pageCounts': {'hancom': ref_count, 'pwh': cand_count}, 'threshold': args.threshold,
                'tolerancePixels': args.tolerance, 'legend': {'hancomOnly': 'red', 'pwhOnly': 'blue', 'nearbyDifference': 'orange', 'exactMatch': 'gray'},
                'pages': records}
            (out / 'report.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            print(json.dumps({'output': str(out), 'compared': sum(r['status'] == 'compared' for r in records), 'requested': len(records), 'pageCountsMatch': ref_count == cand_count}, ensure_ascii=False))
        finally:
            close_cand()
    finally:
        close_ref()


if __name__ == '__main__':
    main()
