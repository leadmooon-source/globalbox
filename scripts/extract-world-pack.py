"""Extract the selected official PNGs with system libarchive (RAR5); no third-party Python packages."""
import ctypes as c
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent
archive = root / 'Farm RPG FREE 16x16 - Tiny Asset Pack.rar'
selected = {
    'Objects/Maple Tree.png': 'maple.png',
    'Objects/Spring Crops.png': 'crops.png',
    'Tileset/Tileset Grass Spring.png': 'grass.png',
    'Farm Animals/Baby Chicken Yellow.png': 'chick.png',
    'Farm Animals/Chicken Blonde  Green.png': 'chicken-blonde.png',
    'Farm Animals/Chicken Red.png': 'chicken-red.png',
    'Farm Animals/Female Cow Brown.png': 'cow-female.png',
    'Farm Animals/Male Cow Brown.png': 'cow-male.png',
}
lib = c.CDLL('libarchive.so.13')
lib.archive_read_new.restype = c.c_void_p
for name in ['archive_read_support_format_all', 'archive_read_support_filter_all', 'archive_read_free']:
    getattr(lib, name).argtypes = [c.c_void_p]
lib.archive_read_open_filename.argtypes = [c.c_void_p, c.c_char_p, c.c_size_t]
lib.archive_read_next_header.argtypes = [c.c_void_p, c.POINTER(c.c_void_p)]
lib.archive_entry_pathname.argtypes = [c.c_void_p]
lib.archive_entry_pathname.restype = c.c_char_p
lib.archive_entry_size.argtypes = [c.c_void_p]
lib.archive_entry_size.restype = c.c_longlong
lib.archive_read_data.argtypes = [c.c_void_p, c.c_void_p, c.c_size_t]
lib.archive_read_data.restype = c.c_longlong
h = lib.archive_read_new()
records = []
try:
    lib.archive_read_support_format_all(h)
    lib.archive_read_support_filter_all(h)
    if lib.archive_read_open_filename(h, str(archive).encode(), 10240) != 0:
        raise RuntimeError('Cannot open official RAR')
    entry = c.c_void_p()
    while True:
        status = lib.archive_read_next_header(h, c.byref(entry))
        if status == 1:
            break
        if status != 0:
            raise RuntimeError('Cannot read RAR header')
        source = lib.archive_entry_pathname(entry).decode()
        relative = source.split('/', 1)[-1]
        if relative not in selected:
            continue
        size = lib.archive_entry_size(entry)
        if not 0 < size < 1024 * 1024:
            raise RuntimeError('Unexpected PNG size')
        buffer = c.create_string_buffer(size)
        offset = 0
        while offset < size:
            count = lib.archive_read_data(h, c.byref(buffer, offset), size - offset)
            if count <= 0:
                raise RuntimeError('Truncated RAR entry')
            offset += count
        data = buffer.raw
        destination = root / 'data/world-pack' / selected[relative]
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
        records.append({'source': source, 'file': selected[relative], 'sha256': hashlib.sha256(data).hexdigest()})
finally:
    lib.archive_read_free(h)
if len(records) != len(selected):
    raise RuntimeError('Official pack is incomplete')
(root / 'data/world-pack/source.json').write_text(json.dumps({
    'archive': archive.name, 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
    'files': records,
}, indent=2) + '\n')
print(f'Extracted {len(records)} official sheets')
