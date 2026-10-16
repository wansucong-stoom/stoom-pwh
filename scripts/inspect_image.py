import json, sys
from replace_image import image_info
try:
    data = sys.stdin.buffer.read(8 * 1024 * 1024 + 1)
    if not data or len(data) > 8 * 1024 * 1024:
        raise ValueError('Image must be at most 8 MiB')
    result = image_info(data)
    if result['width'] * result['height'] > 16 * 1024 * 1024:
        raise ValueError('Image exceeds 16 Mpixels')
    print(json.dumps(result))
except Exception as error:
    print(json.dumps({'error': str(error)}))
    sys.exit(1)
