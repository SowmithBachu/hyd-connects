"""Pack the CC0 surface textures into two texture-array layer sets.

    python -P tools/textures/pack.py      then      node tools/textures/encode.mjs

Sources (ambientCG, CC0 1.0) live in assets/source/textures/<id>/ (git-ignored).
For every layer this writes two 512x512 RGBA PNGs to assets/source/textures/out/:

  c<i>.png  colour; alpha = cut-out (leaves, manhole), 255 elsewhere.
            "tint" layers are divided by their average colour (stored at 50% grey)
            so the shader can paint them any colour: one plaster texture serves
            every wall colour in the city.
  n<i>.png  R,G = normal (OpenGL convention), B = roughness, A = ambient occlusion.

Keep LAYERS in sync with src/surfaces.js.
"""
import os
from PIL import Image, ImageOps

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'assets', 'source', 'textures')
OUT = os.path.join(SRC, 'out')
S = 512

# (asset id, tint?)  -- index = layer number
LAYERS = [
    ('Plaster001', True),          # 0 painted plaster walls, trims, compound walls
    ('Concrete034', True),         # 1 grey concrete: plinths, kerbs, towers, planters
    ('Bricks105', False),          # 2 exposed brick
    ('Asphalt031', False),         # 3 road surface
    ('PavingStones150', False),    # 4 footpath pavers
    ('CorrugatedSteel005', True),  # 5 rolling shutters, metal boxes, railings
    ('Bark001', False),            # 6 tree trunks
    ('LeafSet024', False),         # 7 leaf cards (alpha)
    ('ManholeCover007', False),    # 8 manhole cover decal (alpha)
]


def find(asset, kind):
    d = os.path.join(SRC, asset)
    for f in os.listdir(d):
        if f.endswith(f'_{kind}.jpg'):
            return os.path.join(d, f)
    return None


def neutral(im):
    small = im.resize((32, 32))
    px = list(small.getdata())
    avg = [sum(c) / len(px) for c in zip(*px)]
    lut = []
    for ch in range(3):
        lut += [min(255, int(v / max(1, avg[ch]) * 128)) for v in range(256)]
    return im.point(lut)


def main():
    os.makedirs(OUT, exist_ok=True)
    for i, (asset, tint) in enumerate(LAYERS):
        col = Image.open(find(asset, 'Color')).convert('RGB').resize((S, S), Image.LANCZOS)
        if tint:
            col = neutral(col)
        op = find(asset, 'Opacity')
        alpha = Image.open(op).convert('L').resize((S, S), Image.LANCZOS) if op else Image.new('L', (S, S), 255)
        c = col.convert('RGBA'); c.putalpha(alpha)
        # every layer must carry an alpha channel: phone GPUs (ETC2/ASTC) transcode
        # RGB and RGBA Basis files to different formats, and a texture array needs
        # one format for all its layers. One pixel at 254 makes the encoder keep alpha.
        if not op:
            c.putpixel((0, 0), c.getpixel((0, 0))[:3] + (254,))
        c.save(os.path.join(OUT, f'c{i}.png'))

        nrm = Image.open(find(asset, 'NormalGL')).convert('RGB').resize((S, S), Image.LANCZOS)
        r, g, _ = nrm.split()
        rough = find(asset, 'Roughness')
        rough = Image.open(rough).convert('L').resize((S, S), Image.LANCZOS) if rough else Image.new('L', (S, S), 200)
        ao = find(asset, 'AmbientOcclusion')
        ao = Image.open(ao).convert('L').resize((S, S), Image.LANCZOS) if ao else Image.new('L', (S, S), 255)
        Image.merge('RGBA', (r, g, rough, ao)).save(os.path.join(OUT, f'n{i}.png'))
        print(i, asset, 'tint' if tint else '', 'alpha' if op else '')


if __name__ == '__main__':
    main()
