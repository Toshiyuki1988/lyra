"""LYRA のプレビュー音源「VSCO-2 CE」の小さな音源パックを作る(2026-11-08)。

元: VSCO-2 Community Edition(https://github.com/sgossner/VSCO-2-CE、CC0 = 自由に使える)。
LYRA のリポジトリにはサンプルを入れない(公開リポジトリで、元は数百 MB)。このスクリプトで、
必要な楽器だけを選び、モノラルの mp3(96 kbps)にして、別の置き場(GitHub Pages など)へ上げる 1 つのフォルダを作る。

    python tools/build-vsco-pack.py OUTDIR [RAWDIR]

  OUTDIR … 出来上がったパックを書くフォルダ(manifest.json と、楽器ごとの mp3)
  RAWDIR … ダウンロードした元の wav を置くフォルダ(省略すると一時フォルダ。2 回目からは再利用)

整え方(ホスト側 docs/pictor/mix-mockup/fetch-vsco.py を参考に): 各音の高さの中くらいの強さを 1 本ずつ選び、頭の無音を落とし、
長さを切ってフェード、楽器ごとに音量をそろえる。ファイル名の音の高さは楽器ごとにオクターブの書き方が違うので、
実際の高さ(自己相関)を測って、楽器ごとのずれ(12 の倍数)を直し、manifest.json に MIDI 番号で書く。
必要なもの: Python 3、numpy、lameenc(pip install lameenc)。
"""
import collections
import json
import os
import re
import sys
import tempfile
import time
import urllib.parse
import urllib.request

import numpy as np

# 音を固定するため版を固定する(ホスト側と同じコミット。master の最新 = 2020-08-05)
VSCO_COMMIT = '440300901dfe9275fd84e0b7763af1f8443ae62e'
BASE = f'https://raw.githubusercontent.com/sgossner/VSCO-2-CE/{VSCO_COMMIT}/'
TREE_URL = f'https://api.github.com/repos/sgossner/VSCO-2-CE/git/trees/{VSCO_COMMIT}?recursive=1'

# id → { label, dir(元のフォルダ), limit(切る長さ 秒), vel(強さの選び方 mid / high), pat(ファイル名の絞り込み。省略可) }
VOICES = {
    'flute': dict(label='フルート', dir='Woodwinds/Flute/susvib/', limit=5.0),
    'oboe': dict(label='オーボエ', dir='Woodwinds/Oboe/Vib/', limit=5.0),
    'clarinet': dict(label='クラリネット', dir='Woodwinds/Clarinet/susLong/', limit=5.0),
    'bassoon': dict(label='ファゴット', dir='Woodwinds/Bassoon/sus/', limit=5.0),
    'horn': dict(label='ホルン', dir='Brass/F Horn/sus/', limit=5.0),
    'trumpet': dict(label='トランペット', dir='Brass/Trumpet/susvib/', limit=5.0),
    'trombone': dict(label='トロンボーン', dir='Brass/Tenor Trombone/sus/', limit=5.0),
    'tuba': dict(label='チューバ', dir='Brass/Tuba/sus/', limit=5.0),
    'violin': dict(label='ヴァイオリン(セクション)', dir='Strings/Violin Section/susVib/', limit=5.0),
    'viola': dict(label='ヴィオラ(セクション)', dir='Strings/Viola Section/susvib/', limit=5.0),
    'cello': dict(label='チェロ(セクション)', dir='Strings/Cello Section/susvib/', limit=5.0),
    'contrabass': dict(label='コントラバス', dir='Strings/Solo Contrabass/SusVib/', limit=5.0),
    'harp': dict(label='ハープ', dir='Strings/Harp/', limit=4.0),
    'piano': dict(label='アップライトピアノ', dir='Keys/Upright Nr1/', limit=5.0, pat=r'_mf_RR1'),
    'marimba': dict(label='マリンバ', dir='Percussion/Marimba/', limit=2.5),
    # 高い音は自己相関が 1500 Hz までしか測れず 1 オクターブ低く誤るので、スペクトルの山で確かめた +12 に固定する
    'glock': dict(label='グロッケンシュピール', dir='Percussion/Glock/', limit=3.0, shift=12),
    'xylo': dict(label='シロフォン', dir='Percussion/Xylo/', limit=1.5),
}

NOTE = re.compile(r'(?:^|_)([A-G]#?-?\d)(?=_|\.)')
VEL = re.compile(r'_v(\d+)')
NAMES = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}


def midi_of(name):
    m = re.match(r'([A-G]#?)(-?\d)', name)
    return NAMES[m.group(1)] + 12 * (int(m.group(2)) + 1)


def pick(files, cfg):
    """音名ごとに 1 本選ぶ: 強さ _vN があれば中くらい、rr(ラウンドロビン)は 1 を優先"""
    d = cfg['dir']
    group = collections.defaultdict(list)
    for p in files:
        rest = p[len(d):]
        if not p.startswith(d) or '/' in rest or not rest.lower().endswith('.wav'):
            continue
        if cfg.get('pat') and not re.search(cfg['pat'], rest):
            continue
        m = NOTE.search(rest)
        if m:
            group[m.group(1)].append(p)
    out = {}
    for note, ps in group.items():
        vs = sorted({int(VEL.search(p).group(1)) for p in ps if VEL.search(p)})
        want = vs[len(vs) // 2] if vs else None

        def key(p):
            v = VEL.search(p)
            dv = abs(int(v.group(1)) - want) if (v and want is not None) else 0
            nm = p.lower()
            rr = 0 if ('rr1' in nm or nm.endswith('_1.wav') or 'rr' not in nm) else 1
            return (dv, rr, p)
        out[note] = min(ps, key=key)
    return out


def download(path, dst):
    if os.path.exists(dst) and os.path.getsize(dst) > 0:
        return
    url = BASE + urllib.parse.quote(path)
    for attempt in range(4):
        try:
            urllib.request.urlretrieve(url, dst + '.part')
            os.replace(dst + '.part', dst)
            return
        except Exception as err:  # ネットワークの一時的な失敗は少し待ってやり直す
            print('  再試行', path, err)
            time.sleep(2 + attempt * 3)
    raise RuntimeError('取得できない: ' + path)


def read_wav(path):
    import struct
    data = open(path, 'rb').read()
    assert data[:4] == b'RIFF' and data[8:12] == b'WAVE', path
    pos, fmt, raw = 12, None, None
    while pos + 8 <= len(data):
        cid, size = data[pos:pos + 4], struct.unpack('<I', data[pos + 4:pos + 8])[0]
        body = data[pos + 8:pos + 8 + size]
        if cid == b'fmt ':
            fmt = struct.unpack('<HHIIHH', body[:16])
            if fmt[0] == 0xFFFE:
                fmt = (struct.unpack('<H', body[24:26])[0],) + fmt[1:]
        elif cid == b'data':
            raw = body
        pos += 8 + size + (size & 1)
    tag, ch, rate, _, _, bits = fmt
    if tag == 3:
        x = np.frombuffer(raw[:len(raw) // (bits // 8) * (bits // 8)], '<f4' if bits == 32 else '<f8').astype(np.float64)
    elif bits == 16:
        x = np.frombuffer(raw[:len(raw) // 2 * 2], '<i2') / 32768.0
    elif bits == 24:
        b = np.frombuffer(raw[:len(raw) // 3 * 3], np.uint8).reshape(-1, 3)
        v = (b[:, 0].astype(np.int32) | (b[:, 1].astype(np.int32) << 8) | (b[:, 2].astype(np.int32) << 16))
        v = np.where(v >= 1 << 23, v - (1 << 24), v)
        x = v / float(1 << 23)
    elif bits == 32:
        x = np.frombuffer(raw[:len(raw) // 4 * 4], '<i4') / float(1 << 31)
    else:
        raise ValueError(f'{path}: {bits} bit')
    x = x[:len(x) // ch * ch].reshape(-1, ch)
    return x.mean(axis=1), rate  # モノラルにする


def detect_midi(x, rate):
    """持続の部分(0.15〜0.65 秒)の自己相関で基本の高さを測る。測れなければ None"""
    seg = x[int(rate * .15):int(rate * .65)]
    if len(seg) < rate * .2 or np.abs(seg).max() < 1e-3:
        return None
    seg = seg - seg.mean()
    n = 1 << int(np.ceil(np.log2(len(seg) * 2)))
    f = np.fft.rfft(seg, n)
    ac = np.fft.irfft(f * np.conj(f))[:len(seg)]
    lo, hi = int(rate / 1500), int(rate / 25)
    lag = lo + int(np.argmax(ac[lo:hi]))
    if ac[lag] < .3 * ac[0]:
        return None
    return 69 + 12 * np.log2(rate / lag / 440)


def trim(x, rate, seconds, fade_s=0.4):
    env = np.abs(x)
    start = int(np.argmax(env > 1e-3)) if env.max() > 1e-3 else 0
    start = max(0, start - int(rate * .002))
    x = x[start:start + int(rate * seconds)].copy()
    fade = min(len(x), int(rate * fade_s))
    x[-fade:] *= np.linspace(1, 0, fade)
    return x


def resample(x, rate, to=44100):
    if rate == to:
        return x
    n = int(len(x) * to / rate)
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x)


def to_mp3(x, rate=44100, kbps=96):
    import lameenc
    enc = lameenc.Encoder()
    enc.set_bit_rate(kbps)
    enc.set_in_sample_rate(rate)
    enc.set_channels(1)
    enc.set_quality(2)
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2').tobytes()
    return enc.encode(pcm) + enc.flush()


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    out = sys.argv[1]
    raw = sys.argv[2] if len(sys.argv) > 2 else os.path.join(tempfile.gettempdir(), 'vsco-raw')
    os.makedirs(out, exist_ok=True)
    os.makedirs(raw, exist_ok=True)
    tree_file = os.path.join(raw, 'tree.json')
    if not os.path.exists(tree_file):
        urllib.request.urlretrieve(TREE_URL, tree_file)
    tree = json.load(open(tree_file, encoding='utf-8'))
    files = [e['path'] for e in tree['tree'] if e['type'] == 'blob']
    manifest = {'license': 'VSCO-2 Community Edition (CC0 1.0) https://github.com/sgossner/VSCO-2-CE',
                'commit': VSCO_COMMIT, 'format': 'mono mp3 96kbps 44.1kHz', 'voices': {}}
    total = 0
    for vid, cfg in VOICES.items():
        chosen = pick(files, cfg)
        if not chosen:
            print('見つからない', vid)
            continue
        print(vid, len(chosen), '本', flush=True)
        loaded = {}
        for note, p in sorted(chosen.items(), key=lambda kv: midi_of(kv[0])):
            dst = os.path.join(raw, vid + '__' + note.replace('#', 's') + '.wav')
            download(p, dst)
            x, rate = read_wav(dst)
            loaded[note] = (x, rate)
        # 楽器ごとのオクターブのずれ: 測れた音の (測った − 名前) を 12 に丸めた最頻値
        diffs = []
        for note, (x, rate) in loaded.items():
            d = detect_midi(x, rate)
            if d is not None:
                diffs.append(int(round((d - midi_of(note)) / 12) * 12))
        shift = cfg['shift'] if 'shift' in cfg else (collections.Counter(diffs).most_common(1)[0][0] if diffs else 0)
        agree = diffs.count(shift) if diffs else 0
        print(f'  音の高さのずれ {shift:+d} 半音(測れた {len(diffs)} 本のうち {agree} 本が一致)')
        peak = max(np.abs(x).max() for x, _ in loaded.values()) or 1
        os.makedirs(os.path.join(out, vid), exist_ok=True)
        entries = []
        for note, (x, rate) in sorted(loaded.items(), key=lambda kv: midi_of(kv[0])):
            y = trim(x / peak * .89, rate, cfg['limit'])
            y = resample(y, rate)
            data = to_mp3(y)
            midi = midi_of(note) + shift
            fn = f'{vid}/{midi}.mp3'
            open(os.path.join(out, fn), 'wb').write(data)
            total += len(data)
            entries.append({'midi': midi, 'file': fn, 'src': chosen[note]})
        manifest['voices'][vid] = {'label': cfg['label'], 'shift': shift, 'files': entries}
    json.dump(manifest, open(os.path.join(out, 'manifest.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    open(os.path.join(out, 'README.md'), 'w', encoding='utf-8').write(
        '# LYRA 用 VSCO-2 CE 音源パック\n\n'
        'LYRA(https://github.com/Toshiyuki1988/lyra)のプレビュー音源用に、VSCO-2 Community Edition(CC0 1.0)から\n'
        '必要な楽器だけを選んで、モノラル mp3 にしたもの。元: https://github.com/sgossner/VSCO-2-CE\n'
        f'(コミット {VSCO_COMMIT})。作り方: LYRA の tools/build-vsco-pack.py\n')
    print(f'できた: {sum(len(v["files"]) for v in manifest["voices"].values())} 本、{total / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
