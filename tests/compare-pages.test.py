import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'compare-pages.py'
spec = importlib.util.spec_from_file_location('pwh_compare_pages', SCRIPT)
compare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compare)


class ComparePagesTest(unittest.TestCase):
    def test_exact_and_shifted_images_expose_colour_and_metrics(self):
        original = Image.new('RGB', (80, 100), 'white')
        ImageDraw.Draw(original).rectangle((10, 10, 30, 20), fill='black')
        overlay, metrics = compare.compare(original, original, 245, 2)
        self.assertEqual(metrics['contentIoU'], 1)
        self.assertEqual(metrics['differentPixels'], 0)
        self.assertEqual(overlay.getpixel((12, 12)), (125, 125, 125))
        shifted = Image.new('RGB', (80, 100), 'white')
        ImageDraw.Draw(shifted).rectangle((11, 10, 31, 20), fill='black')
        overlay, metrics = compare.compare(original, shifted, 245, 2)
        self.assertGreater(metrics['differentPixels'], 0)
        self.assertGreater(metrics['nearbyDifferencePixels'], 0)
        self.assertEqual(overlay.getpixel((10, 15)), (231, 142, 37))
        with self.assertRaisesRegex(ValueError, '크기/비율'):
            compare.compare(original, Image.new('RGB', (60, 100), 'white'), 245, 2)

    def test_cli_preserves_inputs_and_does_not_overwrite_output(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / 'original.hwpx'
            source.write_bytes(b'PK synthetic source')
            one, two = root / 'hancom.png', root / 'pwh.png'
            Image.new('RGB', (80, 100), 'white').save(one)
            Image.new('RGB', (80, 100), 'white').save(two)
            out = root / 'comparison'
            command = [sys.executable, str(SCRIPT), '--source', str(source), '--hancom', str(one), '--pwh', str(two), '--out', str(out)]
            result = subprocess.run(command, capture_output=True, text=True, check=True, encoding='utf-8')
            self.assertEqual(json.loads(result.stdout)['compared'], 1)
            report = json.loads((out / 'report.json').read_text(encoding='utf-8'))
            self.assertEqual(report['pages'][0]['contentIoU'], 1)
            self.assertIn('작업자가 확인', report['provenance'])
            self.assertTrue((out / 'page-0001-overlay.png').exists())
            self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
            self.assertEqual(source.read_bytes(), b'PK synthetic source')

    def test_page_range_validation(self):
        self.assertEqual(compare.selected_pages('1,3-5,3', 7), [1, 3, 4, 5])
        for value in ('0', '2-1', '1,,2', '8', 'abc'):
            with self.assertRaises(ValueError):
                compare.selected_pages(value, 7)


if __name__ == '__main__':
    unittest.main()
