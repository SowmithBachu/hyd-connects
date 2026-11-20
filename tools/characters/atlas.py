"""Build the shared character texture atlas from the Quaternius sources.

    python tools/characters/atlas.py

Layout (must match RECT in build.mjs), 2048 x 1280:
    [ male body 1024 | female body 1024 ]
    [ eye 256 | hair1 256 | hair2 256 | unused ]

Colour atlas: the body textures are divided by their average skin colour, so the
shader can multiply by any skin tone (one texture, every skin tone). Hair textures
are grey already and get tinted the same way.
Normal atlas: the matching OpenGL-convention normal maps.
"""
import json
import os
from PIL import Image, ImageStat

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
UBC = os.path.join(ROOT, 'assets', 'source', 'ubc', 'x', 'Universal Base Characters[Standard]')
TEX = os.path.join(UBC, 'Base Characters', 'Textures')
GUE = os.path.join(UBC, 'Base Characters', 'Godot - UE')
OUT = os.path.join(ROOT, 'public', 'characters')
W, H = 2048, 1280
CELLS = {
    'male': (0, 0, 1024), 'female': (1024, 0, 1024),
    'eye': (0, 1024, 256), 'hair1': (256, 1024, 256), 'hair2': (512, 1024, 256),
}
COLOR = {
    'male': os.path.join(TEX, 'T_Superhero_Male_Ligh.png'),
    'female': os.path.join(TEX, 'T_Superhero_Female_Light_BaseColor.png'),
    'eye': os.path.join(TEX, 'T_Eye_Brown.png'),
    'hair1': os.path.join(TEX, 'T_Hair_1_BaseColor.png'),
    'hair2': os.path.join(TEX, 'T_Hair_2_BaseColor.png'),
}
NORMAL = {
    'male': os.path.join(GUE, 'T_Superhero_Male_Normal.png'),
    'female': os.path.join(GUE, 'T_Superhero_Female_Normal.png'),
    'eye': os.path.join(GUE, 'T_Eye_Normal.png'),
    'hair1': os.path.join(GUE, 'T_Hair_1_Normal.png'),
    'hair2': os.path.join(GUE, 'T_Hair_2_Normal.png'),
}


AVG = {}


def neutralise(im, key=None):
    """Divide by the average skin/hair colour so the texture carries only detail.
    Stored at half brightness (0.5 = average) so the shader can brighten too."""
    im = im.convert('RGB')
    small = im.resize((64, 64))
    px = [p for p in small.getdata() if sum(p) > 180]  # ignore the black underwear
    avg = [sum(c) / len(px) for c in zip(*px)]
    if key:
        AVG[key] = [round(a) for a in avg]
    lut = []
    for ch in range(3):
        lut += [min(255, int(v / avg[ch] * 128)) for v in range(256)]
    return im.point(lut)


def main():
    os.makedirs(OUT, exist_ok=True)
    col = Image.new('RGB', (W, H), (128, 128, 128))
    nrm = Image.new('RGB', (W, H), (128, 128, 255))
    for key, (x, y, s) in CELLS.items():
        c = Image.open(COLOR[key])
        c = c.convert('RGB') if key == 'eye' else neutralise(c, key)
        col.paste(c.resize((s, s), Image.LANCZOS), (x, y))
        n = Image.open(NORMAL[key]).convert('RGB')
        nrm.paste(n.resize((s, s), Image.LANCZOS), (x, y))
    col.save(os.path.join(OUT, 'atlas.webp'), 'WEBP', quality=86, method=6)
    nrm.save(os.path.join(OUT, 'atlas_n.webp'), 'WEBP', quality=90, method=6)
    # average source colours, so a tool can reproduce the original look exactly
    with open(os.path.join(OUT, 'atlas.json'), 'w') as f:
        json.dump({'size': [W, H], 'cells': CELLS, 'average': AVG}, f, indent=1)
    for f in ('atlas.webp', 'atlas_n.webp'):
        print(f, os.path.getsize(os.path.join(OUT, f)) // 1024, 'KB')


if __name__ == '__main__':
    main()
