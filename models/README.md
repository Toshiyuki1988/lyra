# MIDI生成の仕組み(軸 × 層の生成器 × プリセット)

2026-09-26に、MIDI生成周りを0から作り直した(ユーザー要望「midi-generation-models-and-style-architecture.md を読んで
MIDI生成モデルの補充、またMIDIエディター含めてMIDI生成周りを最も効率が良い形に0から作り直して」)。
設計の元は同じフォルダの `midi-generation-models-and-style-architecture.md`(§4「軸分解 × プリセット合成」)。
このファイルは、その指針をLYRAでどう実装したかの記録。

- 実装: `js/midi/`(下の表)。旧 `js/midi.js`・`js/gesture.js`・`js/process.js`・`js/mini.js` は廃止した
- 個々のモデルの考え方は `gakuten.md`(基本の楽典)・`mitategura.md`(見立て蔵)・`process.md`(漸進プロセス)。
  それらのファイルの関数名は作り直し前のもの。今の対応は §7

---

## 1. 考え方

1つのMIDIは、**共通の軸**(音高供給・拍節・マクロ構造)の上に、**層**(layer)を重ねたもの。
層ごとに**生成器**を1つ選び、パラメータを与える。「モデル」や「〇〇風」は、軸の値と使ってよい生成器を並べた
**プリセット**(設定データ)にすぎない。様式を1つ増やすコストは「プリセットを1つ書く」ことに収束し、
必要な生成器が無い時だけ生成器を足す。

- Geminiが書くのは**設計図(design)だけ**。音はエンジンがシード付きの乱数から**決定的に**作る(同じシードなら同じ音)
- Geminiの呼び出しは**全モデルで1回**。Geminiが主旋律(`line` の層・role `melody`)を書いた時だけ、反芻でもう1回
  (既存曲の旋律に似ていないかの点検。2026-09-25からの決まり)
- プロンプトとスキーマは、そのプリセットが使ってよい生成器の分だけに絞る(実測で約3,700字・スキーマ約2,400字)
- 設計図はカードに残るので、**振り直し**(全体・層ごと)と**消音**はGeminiを使わずにできる。作り直しは設計図でやり取りし、
  **モデルを替えて作り直す**こともできる(前の設計図を素材として別のモデルの形に移させる)

## 2. 軸

| 軸 | 設計図の欄 | 値 |
|---|---|---|
| 音高供給 | `pitch` | `chords`(コード進行。ポリコード「C\|F#」可)/ `scale`(主音+音階。72種の内蔵音階と、たずねて足した音階から。`modulations` で転調、`rotate` で見立て蔵式の主音の巡回)/ `row`(十二音列)/ `free`(12音)。層ごとに `root`・`scale` を変えると複調 |
| 拍節 | `meters` / `meterMode` / `swing` | 固定(4/4)/ Geminiが書く拍子の変化 / アプリが作る変拍子(`changing`)。ハネ |
| マクロ構造 | `arc` / 層の `active` | 時間の設計図(区間・緊張度0〜10・頂点・転)。緊張曲線は強弱・確率過程の密度と音域・現れ方の間隔・対話の割り込みに効く。層の `active` で鳴る区間を分ける(ブロックの並置) |
| 層の生成器 | 層の `generator` とパラメータ | §3 |
| ゲージ | カードの `gauges` | 粒度(規則・確率過程・オートマトン・ソニフィケーションの刻みを伸縮)・跳躍・つんのめり(和音とベースの食いとこだま)・感情(強弱の幅と緊張曲線の効き) |

## 3. 層の生成器(`js/midi/generators.js`)

| id | 名前 | 由来 | 何をするか |
|---|---|---|---|
| `chords` | 和音 | 楽典 | コードを伴奏の型(伸ばす・刻む・裏拍・8分・分散・アルベルティ)で鳴らす。積み方は声部進行の近さで選ぶ。`parallel` はプラーニング。コード進行が無い時は音階の度数から和音を作る |
| `bass` | ベース | 楽典 | ルート・ルートと5度・オクターブ・持続・ウォーキング |
| `line` | 旋律 | 楽典 | Geminiが音名で書いた旋律をそのまま(主旋律は反芻する) |
| `drums` | ドラム | 楽典(ビート) | 楽器ごとのリズム譜の文字列を区間ごとに展開(GMドラム・10ch) |
| `gesture` | 身振り | 見立て蔵 | 10種の身振り × 4つの現れ方 |
| `process` | 規則 | 漸進プロセス | フェイズ(Reich型フェイズシフト)・加算減算・イソリズム・カノン・ティンティナブリ・転調鳴鐘・ドローン |
| `stochastic` | 確率過程 | Xenakis型 | ポアソン過程の出現 × ブラウン運動の音高。密度と音域の広がりが緊張曲線に追従 |
| `automaton` | セルオートマトン/L-system | 生成文法 | Wolframの1次元CA(生き続けるセルは音を伸ばす)か、L-systemの亀の歩み |
| `markov` | マルコフ連鎖 | コーパス | Geminiが書いた語法らしいお手本の句から、音程の動きとリズムの遷移確率を学んで歩く |
| `counterpoint` | 対位法 | 制約充足 | 強拍の協和・連続/並達の5度8度の禁止・交差なし・跳躍後の反行などを満たす声部をビームサーチで探す。相手が無ければ定旋律を作る |
| `sonify` | ソニフィケーション | 直接ソニフィケーション | 画像の明るさ・色相・輪郭(左→右。アプリが端末内で計算して設計図に残す)か時系列を、高さ・密度・強さに写す |
| `dialogue` | 対話 | マルチエージェント | 奏者ごとの気質(模倣・反行・応答・対比・こだま・沈黙)で直前の句に応える。緊張が高いほど割り込む |
| `motif` | 動機変容 | 動機労作 | 移高・反行・逆行・拡大・縮小・断片化・解消の鎖 |
| `serial` | 十二音列 | セリエル | P・I・R・RI とその移高。旋律・和音・点描 |
| `ostinato` | オスティナート | ストラヴィンスキー | 音型の反復。アクセントの周期をずらせる。`active` と組み合わせてブロックの並置 |

生成器を足す時は `register(id, { label, text, params, paramText, roles, render })`。`params` の名前は
`js/midi/design.js` の `PARAM_SCHEMA` と `sanitizeLayer()` に同じ名前で足す。乱数を使わない生成器は `fixed: true`
(パネルの「振り直す」を出さない)。ほかの層の音を聴く生成器は `listens: true`(後から描かれる)。

## 4. プリセット(`js/midi/presets.js`)

| 見出し | id | 名前 | 生成器 | 軸 |
|---|---|---|---|---|
| 基本 | `gakuten` | 基本の楽典モデル | chords・bass・line | コード進行、拍子の変化、時間の設計図、反芻 |
| 基本 | `mitategura` | 見立て蔵モデル | gesture | 日本音階(主音の巡回)かコード進行、4/4 |
| 基本 | `process` | 漸進プロセスモデル(Reich型フェイズシフトを含む) | process | 音階、4/4 |
| 生成モデル | `stochastic` | 確率過程モデル(Xenakis型) | stochastic・gesture | 音階か12音、時間の設計図 |
| 生成モデル | `automaton` | 生成文法・セルオートマトンモデル | automaton・gesture | 音階 |
| 生成モデル | `markov` | コーパスモデル(マルコフ連鎖) | markov・chords・bass・gesture | 語法の音階 |
| 生成モデル | `counterpoint` | 制約充足モデル(対位法) | line・counterpoint・bass | 音階、反芻 |
| 生成モデル | `sonify` | 直接ソニフィケーションモデル | sonify・gesture | 音階 |
| 生成モデル | `tension` | 緊張曲線モデル(出力目標駆動) | stochastic・gesture・chords・process | 時間の設計図が主役 |
| 生成モデル | `dialogue` | マルチエージェント対話モデル | dialogue・gesture | 時間の設計図 |
| 生成モデル | `motif` | 動機変容モデル | motif・chords・bass | 時間の設計図 |
| 生成モデル | `serial` | 十二音列モデル | serial | 音列、拍子の変化 |
| 作曲家様式 | `bach` | バッハ風 | line・counterpoint・bass・chords | 機能和声+対位法、反芻 |
| 作曲家様式 | `mozart` | モーツァルト風 | line・chords(アルベルティ)・bass | 楽節構造、反芻 |
| 作曲家様式 | `beethoven` | ベートーヴェン風 | motif・chords・bass | 動機労作、緊張の落差 |
| 作曲家様式 | `debussy` | ドビュッシー風 | chords(平行)・line・gesture | 全音音階・旋法、反芻 |
| 作曲家様式 | `stravinsky` | ストラヴィンスキー風 | ostinato・chords・line | 八音音階、アプリが作る変拍子、ブロック並置、複調 |
| 作曲家様式 | `schoenberg` | シェーンベルク風 | serial | 十二音 |
| 作曲家様式 | `part` | ペルト風 | process(ティンティナブリ)・gesture | 短調/長調 |
| (入口専用) | `beat` | ビート | drums | 「ビート」の入口だけ。ピッカーには出さない |

「フェイズシフトモデル(Reich型)」は独立させず、漸進プロセスモデルの規則 `phase` として持つ(ユーザー確認済み、2026-09-26)。

## 5. 流れ(`js/midi/compose.js`)

1. 入口: 課題カード・画像カードの「鳴らす」(`createSketch`)/ 発言の「MIDIにする」(`createFromSpeech`。プラグインのソウルがあればCCオートメーションも)/
   「ビート」(`createBeat`。モデルを選ばない)/ MIDIカードの「作り直す」(`reviseMidi`。モデルを替えてもよい)
2. モデルのピッカー(`pickModel`。見出しごとに説明つき。前回の選択に「前回」)
3. 生成前の質問(APIなし。`presetFields`): 型・光景/物語・小節数・音階/音高の器・主役の規則・作曲家や技法・参照曲・
   つないだMIDIから使うパート・ゲージ・注文。プリセットの `fields` で出す欄が決まる
4. Geminiに設計図を1回書かせる(`buildPrompt` と `buildSchema`)→ `sanitizeDesign()` で整える
5. ユーザーの指定(音高の器・主役の規則)とつないだMIDIのテンポ・拍子を設計図に反映。ソニフィケーションの画像の列を計算
6. 主旋律があれば反芻(`ruminate`。失敗したらカードを作らない)
7. エンジンが音にする(`LyraEngine.render`)→ つないだMIDIのパートを差し替える(`applyFixed`)→ カードを置き、生んだカードから線を結ぶ

振り直し(`rerender`): 全体=シードを替える / 層=その層の `reroll` を1つ増やす / 消音=`muted` を切り替える。
手で編集したカードは上書きの確認を出す。つないだMIDIから使った音(`midi.fixed`)は振り直しても差し替え直す。

## 5.1 ★評価をそのままフィードバックにする(`js/midi/feedback.js`、2026-09-26)

ユーザー要望「カードに最大5個の星ボタンを実装して、ユーザーが評価できるようにして。星をつけたらそれがそのままフィードバックになるよう設計して」。
コメントを書かなくても、星を付けるだけで次の生成が変わる。Geminiの呼び出しは増やさない。

- MIDIカード(BEATも)とパネルに ★1〜5。同じ星をもう一度押すと評価を外す(`card.rating`)
- 星を付けた時点で、そのカードの設計図の要約(モデル・テンポ・拍子・音高・層と生成器のパラメータ・時間の設計図の緊張の並び・ゲージ・コンセプト)を
  `state.prefs.midiRatings`(Driveに保存、最大80件)に記録する。カードを消しても記録は残る
- 次に**同じモデル**で作る時、★4〜5の要約(最大3件)を「寄せる傾向」、★1〜2(最大2件)を「避ける傾向」としてプロンプトに入れる。
  設計図は写さず、今回の入力・注文を優先させる。同じモデルの評価が無ければ、ほかのモデルの★5(最大2件)を好みの手がかりとして渡す
- 生成前の質問のゲージの初期値は、そのモデルで★4以上を付けたMIDIのゲージの平均(前回の値があればそちらが優先)
- モデルのピッカーに、モデルごとの平均の星と件数。作り直しでは、元のカードの星もGeminiに伝える(★4〜5は良い所を保って磨く、★1〜2は思い切って変える)
- アンサンブルへの説明(`describe`)にも評価を添える

## 6. データ

カードの `midi`: `{ tempo, beatsPerBar, meters, notes:[{part, pitch, start, duration, velocity}], cc, markers, tempoChanges,
partNames, partRoles, partLayers, model, design, seed, gauges, rumination?, fixed?, fixedFrom?, edited?, rescaledTo? }`。カードの `rating`(1〜5)。
パートは `p1`〜(層の声部ごと)と `f1…`(つないだMIDIから使った音)。役割(`partRoles`)が `drums` のパートは .mid で10ch、
ほかは1chから順(10chを飛ばす)。

2026-09-26より前のカード(`midi.sketch` / `gesture` / `process` / `beat`)は、`fromLegacy()` で設計図に変換して
表示・振り直し・作り直しをする(振り直すと新しい形で上書きされる)。設計図の無い古い形(旋律だけ・コード進行・ドローン)は、
作り直しの時に実際の音をGeminiに渡す。

## 7. 作り直し前の関数との対応

| 旧(`js/midi.js` など) | 今 |
|---|---|
| `chooseMidiModel()` | `pickModel()`(compose.js) |
| `runSketch()` / `renderSketch()` / `sketchRules()` | `generate()` + プリセット `gakuten` + 生成器 `chords`・`bass`・`line`(engine.js・generators.js) |
| `runBeat()` / `renderBeat()` / `beatRules()` | `generate()` + プリセット `beat` + 生成器 `drums` |
| `runGesture()` / `LyraGesture.render()` | プリセット `mitategura` + 生成器 `gesture` |
| `runProcess()` / `LyraProcess.render()` | プリセット `process` + 生成器 `process` |
| `rerollGesture()` | `rerender()`(全モデル共通。層ごとも) |
| `ruminateMelody()` | `ruminate()` |
| `applyFixedParts()` / `alignToSource()` | `applyFixed()` / `generate()` の中 |
| `openMidiEditor()`(SVG) | `openMidiEditor()`(canvas、editor.js) |
| 小窓(`js/mini.js`) | 廃止。カードの「⇩ 保存」とパネルのチップで書き出し先フォルダへ(export.js)。書き出し先は設定画面 |
| 「MIDIにする」の旋律だけ・コード進行・ドローン(音番号を直接書かせる形) | 廃止。モデルを選んで作る(ドローンは見立て蔵・漸進プロセス・確率過程などで) |

## 8. 検証の状況

- エンジン: Nodeで全19プリセットの模擬設計図を描画し、音の範囲・決定性(同じシードで同じ音)・設計図の往復
  (`designForPrompt` → `sanitizeDesign`)・対位法の強拍の協和・複調の層の音・変拍子の自動生成・旧形式の変換を確認
- 画面: Geminiを模擬したローカルのテストページで、全モデルの「鳴らす」・作り直し(モデルの変更)・ビート・発言から・
  振り直し/消音・フォルダへの保存(同名は「(2)」)・編集画面(囲んで選ぶ・まとめて移動・キー操作・複製・保存時の書き戻し・
  試聴と再生位置)・設定画面の書き出し先を確認
- **実機のGeminiではまだ確認していない**(Liteモデルが層の生成器とパラメータを正しく選べるか、特に新しい生成器)
