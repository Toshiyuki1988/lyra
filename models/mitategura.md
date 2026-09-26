# 自然物由来・無階調MIDI生成メソッド

> **2026-09-26 作り直し**: LYRAでの実装(§11)は `js/midi/` に移り、プリセット `mitategura`・生成器 `gesture` になった(身振りの手順は同じ。日本音階の巡回は音高供給の `rotate`)。§11の関数名とファイルは旧実装のもの。今の対応は `models/README.md`。

見立て蔵（和の香水アルバム制作支援ツール）で確立した、写真・印象・テキストのような「自然物・具体的モチーフ」の入力から、固定のメロディテンプレートや単純な音階ループに頼らず、**モチーフごとに異なる身振り（gesture）を重ね合わせて1本の演奏パートを紡ぐ**MIDI生成メソッドの技術仕様。他の作曲支援アプリに移植することを前提に、思想・データモデル・アルゴリズムをまとめる。

---

## 1. 何が「無階調」なのか

一般的な自動作曲エンジンは「コード進行→アルペジオパターン」のように、少数のテンプレートを機械的に敷き詰める。これだと入力が変わっても出力の"型"は同じで、単に音高だけが移調される。

このメソッドは逆に、**入力に含まれる具体的なモチーフ（「お寺」「満月」「すすき」のような名詞単位）を、そのまま3〜6個の独立した要素として保持し、それぞれに専用の生成ロジック（gesture_type）を割り当てる**。1つの入力から生まれる演奏パートは、要素の組み合わせ・音域・現れ方（occurrence）がその都度違う10種前後の身振りを重ねたものになるため、同じ「型」を使い回しても、要素の組み合わせと乱数的揺らぎによって毎回異なる具体的な音形になる。これが「無階調」（固定の音階・パターン格子に縛られない）という設計思想の核。

**コード進行への圧縮を経由しない**のも重要な点。「お寺」を単なる和音記号に翻訳してしまうと、寺という具体的なイメージが持つ質感（低く構える・遠く響く・止まっている）が消える。このメソッドでは、和音進行（ハーモニーの器）とは別レイヤーに「身振り」の層を持ち、要素ごとの固有性をその身振りの中に温存する。

---

## 2. データモデル

1回の生成入力（写真・テキスト・印象等）から、以下の構造化データを組み立てる。ここがAI（LLM）に生成させる部分で、以降の音イベント生成は完全にローカルな決定的関数が担当する。

```json
{
  "harmonic_mode": "japanese" | "western" | "hybrid",
  "japanese_scale": "in" | "ritsu",
  "japanese_root": "E",
  "gesture_elements": [
    {
      "element": "金木犀",
      "gesture_type": "grace_ornament",
      "register": "high",
      "occurrence": "sparse",
      "is_primary": true,
      "timbre": "flute",
      "note": "なぜこの身振りにしたかの一言"
    }
  ]
}
```

| フィールド | 役割 |
|---|---|
| `harmonic_mode` | 音高供給層の種類（§4） |
| `gesture_elements` | 入力から分解した要素の配列。1要素＝1つの独立した身振りジェネレーターの呼び出し単位 |
| `element` | 表示用ラベル（生成ロジックには使わない、人間が把握するための名前） |
| `gesture_type` | 固定語彙（§3.1）。**リストにない値は安全側に無視される**（クラッシュせず、その要素だけ発音しない） |
| `register` | `low` / `mid` / `high`。音域レンジの選択 |
| `occurrence` | `continuous` / `periodic` / `sparse` / `once`。曲中での現れ方 |
| `is_primary` | 主役フラグ（§6）。1〜2個限定。情報配分（生成AI側のnoteの深さ、UI表示の強調）を左右する |
| `timbre` | プレビュー再生時の音色（本番音源とは独立） |

**設計上の要点**：この構造をAIに直接出力させ、「要素の数だけ独立したロジックを呼ぶ」という設計にすることで、1テーマ→1つのholistic要約→全要素に同じ説明文を配る、という劣化パターン（詳細は生成アプリ開発マニュアルの「holistic要約の罠」参照）を避けている。

---

## 3. 語彙定義

### 3.1 gesture_type（身振りの型）— 10種

周期性・音域・輪郭の掛け合わせで空間をまんべんなくカバーするよう設計している。「地となる要素」（continuous/periodic向き）と「図となる要素」（sparse/once向き）に大別される。

| gesture_type | 性格 | 向いているモチーフ |
|---|---|---|
| `bell` | 低音・単音、周期的に打ってゆっくり減衰 | 鐘・遠い太鼓・構造の基準点 |
| `sustained_open` | 開いた音程（5度/オクターブ中心）の静かな持続和音 | 広がり・光・空間 |
| `tremolo` | 2音を一定間隔で往復する揺らぎ | 風・水・振動するもの |
| `grace_ornament` | 高音域中心の疎らな装飾音 | 香り・光の粒子・無形のもの |
| `staccato_hop` | 短く軽快に跳ねる動機 | 小動物・軽やかな動き |
| `arpeggio_flow` | 和音構成音を流れるように分散 | 水の流れ・連続的な動き |
| `chromatic_flourish` | 和声と無関係な半音階の駆け上がり/下がり/山型 | 閃光・突発性・異物感 |
| `drone_pulse` | 低音域で一定ピッチのまま規則的に打つ・膨らむ脈動 | 心拍のような継続的な下地。地となる要素向き |
| `breath_swell` | ゆっくり膨らんで消える、息のような起伏を持つ持続音 | 香りの揮発・気配の満ち引きなど輪郭の曖昧なもの |
| `scatter_stab` | ごく短く鋭い単発の刺し音がまばらに孤立 | 雷光・火花・虫の音。図となる要素向き |

### 3.2 register（音域）— 3種

```
low:  MIDI 36–55
mid:  MIDI 55–74
high: MIDI 74–93
```

### 3.3 occurrence（現れ方）— 4種

| 値 | 意味 |
|---|---|
| `continuous` | 曲全体を通してずっと存在する（地となる要素向け） |
| `periodic` | 一定間隔で繰り返し現れる（間隔にも揺らぎを持たせ、機械的な反復を避ける） |
| `sparse` | 曲中に数回、まばらに現れる |
| `once` | 曲中に一度だけ現れる |

### 3.4 バランス原則

全要素が`continuous`だと騒がしく、全要素が`once`だと空虚になる。「地となる要素（continuous 1〜2個、bell/sustained_open/drone_pulse向き）」と「図となる要素（sparse/once、chromatic_flourish/grace_ornament/scatter_stab向き）」を必ず混在させることを、AIへの生成指示レベルで明記する。

---

## 4. Pitch Source（音高供給層）

和音進行とは独立して、「今この拍で使える音高の集合（ピッチクラス）」を返す抽象層。`harmonic_mode`によって2つのモードに分岐する。

### 4.1 western モード（コード進行ベース）
```
pitchClassesAtBeat(beat):
  idx = clamp(floor(beat / BEATS_PER_CHORD), 0, chords.length - 1)
  chord = chords[idx]
  return chord.intervals.map(iv => (chord.rootPc + iv) % 12)
```
その拍が属する小節のコードの構成音をそのまま返す。

### 4.2 japanese / hybrid モード（日本音階ベース）

固定の5音音階から選ぶ（自己流の音階を作らせない）:

```
in（陰音階・都節音階）: 根音から半音単位で [0, 1, 5, 7, 8]
  → 半音を含む。艶っぽく、密やか、もの寂しい。静けさ・夜・月・秋向き
ritsu（律音階）:         根音から半音単位で [0, 2, 5, 7, 9]
  → 半音を含まない。雅楽的で晴れやか。儀礼的・清澄な情景向き
```

**展開のための区間シフト機構**：日本音階モードは和音進行を持たないため、放っておくと曲を通してずっと同じ主音に聞こえてしまう。これを避けるため、曲を2〜3区間に分割し、各区間で音階内のシフト量（1〜4）をランダムに変えることで「起→転→結」のような主音移動を作る（最終区間は必ずシフト0＝主音に戻す）。

```
sectionCount = 2 or 3（ランダム）
shifts[0] = 0
shifts[i] = 前の値と異なる1〜4のいずれか（i = 1..sectionCount-1）
shifts[sectionCount - 1] = 0  // 最後は主音に戻る

pitchClassesAtBeat(beat):
  sectionIdx = floor(beat / (totalBeats / sectionCount))
  shift = shifts[sectionIdx]
  return pcs.slice(shift).concat(pcs.slice(0, shift))  // 音階を巡回シフト
```

`hybrid`は`japanese_scale`が指定されていれば日本音階側のロジックを使う（つまり和音進行と日本音階の並存ではなく、どちらを主として使うかの二択）。

---

## 5. occurrence → 実際の発生タイミングへの変換

```
occurrenceBeats(occurrence, totalBeats, spacing):
  if occurrence == 'once':
    return [totalBeats * (0.25 + random() * 0.5)]  // 中盤あたりに1回

  if occurrence == 'sparse':
    count = 2〜4（ランダム）
    positions = count個のランダムな拍位置、ソート済み
    return positions

  # periodic
  step = spacing (デフォルト4拍)
  positions = []
  b = 0
  while b < totalBeats:
    positions.push(b)
    b += step * (0.8 + random() * 0.4)  // 間隔にも±20%の揺らぎ
  return positions
```

**機械的な反復を避ける工夫**：`periodic`の間隔に毎回±20%程度の揺らぎを入れることで、メトロノーム的な均等反復を避ける。これは全gesture_typeの生成関数に共通するパターン。

---

## 6. 各gesture_typeの生成アルゴリズム

共通シグネチャ：`gen(pitchSource, chords, register, occurrence, totalBeats) → [{ pitch, startBeat, durationBeats, velocity }]`

### bell（鐘打ち）
`occurrence`が`continuous`の場合は`periodic`にフォールバックさせた上で、6〜10拍間隔で発生位置を取り、各位置でその瞬間のピッチクラスの根音を選ぶ。持続は4〜7拍、減衰は再生側のenvelopeに委ねる。

### sustained_open（持続和音・開離）
拍を「セクション長」（日本音階モードなら区間長、それ以外はコード長）で区切り、各区間の頭で根音・5度・オクターブ上の3音を同時に鳴らす。日本音階モードでも区間ごとに張り直すことで、和声モードと同様に「静止しない持続」を作る。

### tremolo（揺らぎ）
`continuous`なら曲全体を1区間として扱い、そうでなければ`occurrenceBeats`で得た位置ごとに2〜4拍の区間を作る。区間ごとにピッチクラスから2音をランダムに選び（毎回固定のペアにしない）、0.18〜0.32拍間隔で交互に鳴らす。

### grace_ornament（装飾粒）
`continuous`は`sparse`にフォールバック。各発生位置で2〜4音を、基準音から半音〜全音刻みで上下どちらかに連続して鳴らす（装飾音的な短い連符）。

### staccato_hop（跳躍）
`continuous`は`periodic`にフォールバック。各発生位置で2〜5音の跳躍列を作り、直前の音から最も近い同ピッチクラスの音を選びながら（`closestPitchInRange`）跳ねていく。音間隔にも揺らぎを持たせる。

### arpeggio_flow（分散流）
区間ごとにピッチクラスをスタック化し、上行/下行/往復/一部間引きの4パターンからランダムに選んで0.2〜0.3拍刻みで流す。

### chromatic_flourish（半音の閃き）
`continuous`は`sparse`にフォールバック。各発生位置で、和声とは無関係な半音階を上行/下行/山型のいずれかで5〜10音、短時間（0.375〜0.875拍）で駆け抜ける。高音域/低音域はランダムに選択（registerが指定されていれば固定）。

### drone_pulse（脈動・低音）※新規
`register`は`low`をデフォルトに使う。0.9〜1.3拍間隔のパルスグループを作り、各グループ内で「強拍＋やや弱い後打ち」の2打1組を、心拍のように一定ピッチで反復させる。bellと異なり、単発の減衰音ではなく継続的な鼓動として機能する。

### breath_swell（息の起伏）※新規
`continuous`なら曲全体、そうでなければ3〜6拍の区間を作る。各区間で1音を選び、「前半（弱→中）」「後半（中→強、やや遅れて開始）」の2枚を重ねることで、ビロード的にゆっくり膨らんで消える起伏をシンプルなノートイベントの重畳だけで近似する。

### scatter_stab（散在する刺し）※新規
`continuous`は`sparse`にフォールバック。各発生位置で、高音域/低音域のどちらかをランダムに選び（registerが未指定の場合）、0.09〜0.14拍というごく短い単発音を1つだけ鋭く鳴らす。chromatic_flourishより粒立ちを短くし、孤立した瞬間的現象を表現する。

---

## 7. 全体の合成

```
buildImagePart(gestureState, chords):
  totalBeats = chords.length * BEATS_PER_CHORD  // 1コード=4拍と仮定
  pitchSource = getPitchSource(gestureState, totalBeats)
  merged = []
  byElement = []

  for el in gestureState.gesture_elements:
    gen = GESTURE_GENERATORS[el.gesture_type]
    if gen is undefined: continue  // 未知の語彙は安全側に無視（クラッシュしない）

    register = el.register が有効な値なら使用、そうでなければ 'mid'
    occurrence = el.occurrence が有効な値なら使用、そうでなければ 'sparse'
    events = gen(pitchSource, chords, register, occurrence, totalBeats)
    merged += events
    byElement.push({ name: el.element, events: events })  // 要素別トラック用に保持

  merged.sort(by startBeat)
  return { merged, byElement }
```

`merged`（全要素を時系列でマージした1本）は単一トラックMIDI・プレビュー再生に、`byElement`（要素ごとに独立したイベント列）は複数トラックMIDI書き出し（§8）に使う。同じ生成結果を2つの形で保持しておくことで、出力フォーマットの追加が生成ロジックに触れずに済む。

---

## 8. MIDI書き出し

### 8.1 単一トラック（SMF Format 0）
全要素をマージしたイベント列を、デルタタイムでエンコードした単一トラックとして書き出す。ノートオン/オフのペア化はこの層で行う（`durationBeats * 0.92`をゲート時間として、次のノートと詰まりすぎないようにする）。

### 8.2 複数トラック（SMF Format 1）
`byElement`の各グループを独立したMTrkチャンクにし、先頭にトラック名メタイベント（要素名、UTF-8）を埋め込む。トラック0はテンポのみのコンダクタートラックとする。空のイベント列を持つ要素（未知のgesture_typeで無視された等）は自動的に除外する。

```
buildMultiTrackMidi(tracks, bpm, ticksPerBeat):
  tempoTrack = [テンポメタイベントのみ]
  chunks = [wrapTrackChunk(tempoTrack)]
  for track in tracks (非空のもののみ):
    trackBytes = trackNameMeta(track.name) + noteEvents(track.events)
    chunks.push(wrapTrackChunk(trackBytes))
  numTracks = tracks.length + 1
  return header(format=1, numTracks, ticksPerBeat) + chunks
```

これにより、DAW側で要素ごとに音源・エフェクトを個別に割り当てられる（例：「金木犀」トラックだけ専用リバーブに送る）。

---

## 9. 主役要素フラグ（is_primary）による情報配分

全要素を均等な詳細度で扱うと、「本当に伝えたい核」が埋もれる。そのため`gesture_elements`のうち**1〜2個だけ**（3個以上は禁止し、AI生成時にもUI編集時にも上限を強制する）に`is_primary: true`を付け、次の情報配分ルールを適用する。

- 主役要素の`note`（なぜその身振りにしたかの理由）は具体的・詳細に書かせる
- 脇役要素の`note`は簡潔でよい
- 音色提案（instrument_sources）の奏法・エフェクト・空間設計も、対応する要素が主役かどうかで書き込みの深さを変える
- UI編集画面では主役要素の行を視覚的に強調表示し、編集中に見失わないようにする

これは「全出力単位に均等な詳細さを与えず、重要度に応じた情報配分をする」という一般原則の具体的な実装であり、gesture engine自体とは独立して他の出力（音色レシピ、アレンジ指示等）にも横展開できる。

---

## 10. 他アプリへの移植ガイド

**そのまま持っていける部分（ドメイン非依存）**
- §4のPitch Source抽象層（western/japanese二層構造、区間シフトによる展開ロジック）
- §5のoccurrence→タイミング変換（揺らぎの入れ方）
- §7の合成ロジック（merged/byElementの二重保持）
- §8のMIDI書き出し（Format 0/1双方）
- 未知語彙を安全に無視する設計（`if gen is undefined: continue`）

**ドメインに応じて再設計する部分**
- gesture_typeの語彙セット自体（今回の10種は「和の香水」というテーマに寄せた選定。別ジャンルなら別の身振り語彙を7〜10種程度、地/図のバランスを意識して設計し直す）
- 各generatorの内部パラメータ（拍間隔、音数レンジ、ベロシティ幅）は音楽ジャンルの密度感に応じて調整
- 日本音階（in/ritsu）は和物専用。西洋音楽アプリなら教会旋法・ペンタトニック等に差し替え可能だが、「区間シフトで主音を動かし単調さを避ける」という設計自体は音階を問わず有効

**実装コスト試算**：新しいドメインでgesture_type 1種を追加するコストは、生成関数1つ（15〜40行程度）＋レジストリへの登録＋AIプロンプトへの語彙説明追記、の3点セット。既存の7〜10種の実装パターンをテンプレートにすればコピー改造で足りることが多い。

---

## 11. LYRAでの実装(第二のMIDI生成モデル `mitategura`、2026-09-26)

上の§1〜§10は、見立て蔵で書かれた元の仕様をそのまま残したもの。LYRAではこれを「見立て蔵モデル」として移植し、
「基本の楽典モデル」(`models/gakuten.md`)と並べて選べるようにした。

### 11.1 入口とGeminiの回数

- 課題カード・画像カードの「鳴らす」と、発言の「MIDIにする」を押すと、モデルを選ぶポップアップが出る
  (前回選んだモデルに「(前回)」が付く。`chooseMidiModel()`)。「ビート」はリズム専用なのでモデルを選ばない
- Geminiは**1回**だけ呼ぶ。書かせるのは§2のデータ(要素の分解と音高の器)とテンポ・名前・コンセプト・解説だけ
  (`GESTURE_SCHEMA`)。旋律を書かせないので、楽典モデルのような主旋律の反芻は無い
- 渡すもの: 画像(画像カード)、光景・言葉(つないだ気づき・課題・画像の印象が初期値)、つないだカード、
  ソウルの知識(アーティスト名・曲名の項目は外す)、追加の注文
- 生成前に聞くこと: 長さ(小節数、4/4)、音高の器(おまかせ/陰音階/律音階/コード進行)、光景・言葉、追加の注文

### 11.2 ファイルと関数

| 役割 | 場所 |
|---|---|
| 音づくり(§4〜§7。Geminiを使わない決定的な手順) | `js/gesture.js` の `LyraGesture.render()` |
| Geminiの出力を整える(未知の型は残して生成時に無視、主役は2個まで) | `LyraGesture.sanitize()` |
| 生成の流れ・プロンプト・カード・パネル・作り直し | `js/midi.js` の「MIDI生成モデル」の節(`createGesture()` / `runGesture()` / `reviseGesture()` / `rerollGesture()`) |

### 11.3 元の仕様から変えた点

| 箇所 | 元の仕様 | LYRA |
|---|---|---|
| 乱数 | `random()` | シード付き(mulberry32)。シードは `midi.gesture.seed` に残し、同じシードなら同じ音 |
| 揺らぎの振り直し | — | パネルの「揺らぎを振り直す」: 設計図はそのまま、シードだけ変えて同じカードに上書き(Geminiを使わない)。手で編集していたら確認する |
| 日本音階の区間数(§4.2) | 2〜3をランダム。2区間だと shifts=[0,0] になり主音が動かない | 16拍以上は3区間(主音→移る→主音)、短い時は2区間(移る→主音) |
| 区間の境目(§4.2) | `totalBeats / 区間数`(小節の途中になりうる) | 小節線にそろえる。最後の区間は曲の終わりまで |
| western の音高(§4.1) | `chord.intervals` | コードネームをLYRAの解析(`parseLayers()`)で読み、全構成音。読めないコードは除き、1つも読めなければ日本音階(陰)に落とす |
| sustained_open と occurrence(§6) | 区間ごとに必ず張り直す | ずっと/繰り返し=全区間、まばら/一度=発生位置を含む区間だけ |
| breath_swell(§6) | 同じ音を2枚重ねる | 同じ高さを同じチャンネルで重ねると.midで音が途切れるため、弱い前半を後半の頭で切り、強さの違う2枚を続けて並べる。continuous は曲全体でなく、音高の器の区間ごとに1つ |
| tremolo・drone_pulse・breath_swell の区間(periodic) | 間隔4拍、区間の長さ2〜8拍(重なって continuous と変わらない) | 間隔を区間の最長+3拍に広げ、重なった区間は次の頭で切る |
| ゲート(§8.1) | 書き出し時に `duration × 0.92` | ノートの長さに直接掛けて持つ(試聴・編集画面・書き出しで同じ) |
| 書き出し(§8) | Format 0 / Format 1 | LYRAの書き出しに合流: 「1トラックで」(ch1)/「パート別」(要素の名前のトラック、ch1〜。10chは飛ばす)/要素1つずつ。コンダクタートラックには区間のマーカーも入る |
| timbre(§2) | プレビュー再生の音色 | 要素ごとの音色の名前(Cubaseで音源を選ぶ手がかり)として残す。試聴は1カード1音色なので、主役の timbre から近い音色(フルート・ビブラフォン・ギター・弦・パッド等)を選ぶ |
| instrument_sources(§9) | 音色提案の深さを主役で変える | 未実装(LYRAでは timbre に主役だけ奏法・エフェクトまで一言添えさせる) |
| 長さ | コードの数×4拍 | ダイアログの小節数×4拍(4/4のみ) |

### 11.4 カードのデータ

```
card.midi = {
  kind: 'gesture', model: 'mitategura', tempo, beatsPerBar: 4, meters,
  notes: [{ part: 'g1'…'g6', pitch, start, duration, velocity }],
  partNames: { g1: 'お寺の鐘', … },          // パート(要素)の表示名・トラック名
  markers: [{ beat, label: '区間1: 主音 E' }],
  gesture: { harmonic_mode, japanese_scale, japanese_root, chords: [...], gesture_elements: [...], bars, seed }
}
```

作り直しは、そのカードを作ったモデルのまま(`reviseMidi()` → `reviseGesture()`)。前回の設計図・コメント・つないだカードを
渡してGeminiを1回呼び、改善版(`_v2.mid`…)を右隣に線でつないで置く。
