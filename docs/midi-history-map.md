# 音楽史MIDI生成モデルマップ — 他の開発チャットへの紹介

LYRA(ブラウザーのアプリ。https://github.com/Toshiyuki1988/lyra)で作っている、**音楽史の順に並べた MIDI 生成モデルの地図**の紹介。
LYRA の外のアプリ(C++ の音楽ソフトなど)から、このモデルを呼び出して使いたい時の入口になる文書。
(2026-11-06 時点の状態。作業の経緯と計画は `docs/duo/task-midi-history-map.md`)

## 1. これは何か
- 「モデル」= 音楽の作り方の型。コード進行の定番・リズムの型・伴奏型・形式・作曲家の技法・アルゴリズムなど。**旋律の引用は含まない**(手順・構造だけ)
- 地図 = そのモデルを時代順に並べた目録。**212件・16の時代区分**(伝統・民族/中世/ルネサンス/バロック/古典派/ロマン派/近代/戦後の前衛/ジャズ/ポピュラー/ラテン・アフロ/電子音楽/ヒップホップ/日本/アルゴリズム/伸ばす)
- 今の進み具合: **作成済み95件・未作成117件**(解説あり49・お手本あり49。2026-11-06 に spectral・micropolyphony・messiaen・fractal・bartok、2026-11-07 に中世〜バロックの10件と近代・戦後の10件を追加)。未作成のものを、波ごとに順次作っていく
- 各モデルは「プリセット(設定データ)・子どもの解説・お手本(手書きの設計図)」の3点そろいで作る

## 2. どこにあるか(LYRA のリポジトリ)
| もの | 場所 | 中身 |
|---|---|---|
| 地図(目録) | `models/history-map.json` | 時代の区分と212件の `id`・名前・説明・種類(`kind`)・難しさ(`tier`)。**C++ からそのまま読める JSON** |
| プリセット | `js/midi/presets.js`(`window.LyraPresets`) | モデルの設定。`byId(id)` で引く。`kids`(子どもの解説)を持つ |
| お手本 | `js/midi/demos.js`(`window.LyraDemos`) | 手で書いた設計図。`has(id)`・`listen(id)`(聴きどころ)・`render(id)` |
| ビート帳 | `js/midi/beatbook.js`(`window.LyraBeatbook`) | ドラムのビート34種(ジャンル別)。`byId(id)`・`MODELS` |
| 生成の中心 | `js/midi/theory.js` `engine.js` `generators.js` `design.js` | 設計図 → 音符を作るエンジン |
| 地図の画面 | `js/midi/historymap.js` | LYRA 内の「音楽史マップ」の窓(外部からは使わない) |

`kind` は `preset`(プリセット)/`beat`(ビート帳)/`response`(応答)/`extend`(伸ばす)。`tier` は未作成のものを作るのに要るもの
(P=プリセットだけ/G=生成器を足す/M=微分音などの仕組み)。**既存かどうか・解説・お手本の有無は JSON には書かない**。
`id` で `LyraPresets.byId()`・`LyraDemos.has()`・`LyraBeatbook.byId()` から引く(モデルを足せば自動で反映される)

## 3. 仕組み
- 生成の流れ: **設計図(JSON)+シード → エンジンが音符を作る**。同じ設計図・同じシードなら同じ結果になる(お手本はシード7で固定)
- 設計図は、普段は LYRA が Gemini に書かせる。お手本は、人が手で書いた設計図(Gemini を呼ばない)
- 生成の中心の7ファイルは、`document`・`AudioContext`・`localStorage`・IndexedDB を使っていない(2026-11-06 に確認)。
  画面・再生・書き出し・Gemini の呼び出しは別のファイル(`play.js` `export.js` `compose.js` `editor.js`)にあり、外部からは要らない

## 4. C++ のアプリから呼び出す方法(ユーザー決定: 案 (a))
**C++ 側に小さな JS 実行系(QuickJS など)を組み込み、LYRA の `js/midi/` をそのまま読み込む**。生成の中身が1つのまま、LYRA を開かなくても動く。
LYRA 側は依存なしの素の JS のまま。呼び出すアプリが複数あるので、特定のアプリに寄せない汎用の形にする。

読み込む手順(Node の `vm` で確かめた形。QuickJS でも同じ考え方):
1. グローバルに `window` を作る(`globalThis.window = globalThis`)
2. 次の順に、ファイルをそのまま評価する: `theory.js` → `engine.js` → `generators.js` → `beatbook.js` → `design.js` → `presets.js` → `demos.js`
3. `window.LyraPresets` `window.LyraDemos` `window.LyraBeatbook` が使えるようになる
4. 地図は `models/history-map.json` を読み、各行の `id` で上のものを引く

確認済み: 上の手順で、Node の `vm` に7ファイルを読み込み、`LyraPresets`・`LyraDemos`・`LyraBeatbook` が使えること、
地図の212件との照合ができること(`mockups` の確認と同じ照合)。`docs/midi.md` には、お手本24個がNodeで音を出すことの確認の記録もある。

## 5. これから(まだ無いもの)
- **画面を使わない入口 `LYRA.midiApi`**(予定。親のタスクの「段階0」): `listModels()`(地図)・`demo(modelId)`(お手本の設計図)・
  `render(design, { seed })`(音符のJSON)・`toMidi(rendered)`(.mid のバイト列)。同じ設計図・同じシードで、ブラウザーでも C++ でも同じ音符になることを条件にする。
  **まだ作っていない**ので、今は上の「読み込む手順」で `LyraDemos.render(id)` などを自分で呼ぶ形になる
- 未作成117件のモデル(波ごとに順次)。ビート帳34件への解説・お手本(波1b)
- Gemini に設計図を書かせる所は外部には出さない(C++ 側で Gemini を使いたい時は、キーは C++ 側で持つ。LYRA のキーは渡さない)

## 6. 守ってほしい決まり
- **LYRA のリポジトリは公開**(GitHub Pages)。秘密の情報・個人情報・非公開のアプリの名前を、LYRA のファイル・コミットに書かない
- モデルの解説・お手本を足す時は、既存の書き方に合わせる(`docs/midi.md`「小学生向けの解説」「お手本の演奏」)
- 著作権: 手順・コード進行・リズムの型・作曲家の技法は使ってよいが、**個別の曲の旋律は引用しない**(`docs/midi.md`「生成と著作権の線引き」)
- モデルを足す時は、プリセット・`kids`・お手本を1つずつ書く。地図の JSON の行も足す
- 音を出す時は、LYRA ではリミッターを通す決まり(`safeOut`)。WAV・.mid の書き出しには入れない

## 7. 質問・相談の宛先
LYRA 側の変更が要る時(`LYRA.midiApi` の関数の形、`id` の追加など)は、LYRA のチャットに頼む。
地図の `id` は、足すことはあっても変えない・消さない前提にしてよい(呼び出す側が `id` で引くため)【推測: 今後の方針。確定したら更新】

## 8. 微分音(cents)の扱い(2026-11-06 追加)
- `render()` が返す音符 `{ pitch, start, duration, velocity, part }` は、微分音の音だけ **`cents`(-50〜50。平均律の `pitch` からのずれ)** を持つ。無ければ0
- .mid への書き出しでは、cents のある音ごとにピッチベンド(±2半音の幅で 8192 + cents×40.96)を付け、同時に鳴る微分音がぶつからないよう、使っていないチャンネルを順に回す。C++ 側で .mid でなく音符を使う時は、`pitch + cents/100` の半音で周波数を決める
