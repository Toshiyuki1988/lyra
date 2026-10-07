# 見立て蔵の語彙を MIDI 生成で生かす(目録の質感・試聴の三層・.mid の B)

## 進め方
- B(重い: Claude Codeが計画)。MIDI生成の中心(js/midi/ の generators・design・play・export)と、設計図の保存形式(Drive に入る `layer`)に触れるため

## 状態
- [x] 計画作成(Claude Code、2026-10-07)
- [x] 計画確認(ユーザー「１～３全部やろう」「Codexに書かせる」)
- [x] 実装(Codex、2026-10-07)
- [x] 検証(Codex、ローカルの数値・模擬ページ。実機は下記に未確認として記録)
- [ ] 最終チェック(Claude Code)
- [ ] 人によるレビュー・コミット(ユーザー)

## 要望の原文
次は予定表に記載してると思うけど、この語彙群を、MIDI生成モデル時に使用する実装をお願い。

(Claude Code の「生成器 mitate は 2026-10-02 に実装済み。ただし今日の『一瞬の混沌』より前に作ったので、1 目録に質感が無い/2 試聴が語彙の本当の音と違う/3 .mid に三層が残らない」という報告に)１～３全部やろう / Codexに書かせる

## 目的・背景
- 見立て蔵の神秘の部品は 2026-10-07 に「一瞬の混沌」(質感13種。`docs/mitategura.md` 冒頭の【重要】)へ方向を決めた。語彙が良くなっても、MIDI 生成(見立て蔵モデルの生成器 `mitate`)で使う時に、
  (1) Gemini が質感を知らずに選ぶ・置く、(2) 試聴では A の音だけを共通の音色「見立て三層」(`lyra_mu`)で鳴らすので、語彙ごとの三層の変わり方(mu・morph)・ノイズ・音程のすべりが落ち、
  しかも `lyra_mu` は「短い音ほど B を薄く」するため点描・一瞬の光の濁りが消える、(3) .mid には A しか入らない、の3つで、語彙の良さが生成物に届かない

## 関係する記録
- `docs/mitategura.md`(冒頭の【重要】一瞬の混沌、「見立て蔵モデルで語彙を使う(2026-10-02)」)、`docs/midi.md`(生成器・設計図・試聴・Cubase への保存)、`docs/lyrahost.md`(見立て蔵の部品を LYRA Host へ送る: A と B をノートに)
- AGENTS.md: アプリの音は `safeOut(ctx)` を通す(WAV・.mid の書き出しには入れない)/ Gemini の出力は実在するものとだけ照合 / `?v=` の更新 / 全JSはグローバルを共有

## 対象範囲
### 1. 目録に質感を載せ、置き方の決まりを足す(js/mitategura.js `catalog()`、js/midi/generators.js `vocabCatalogText()`・`register('mitate')`)
- `catalog()` の各行に `texture`(質感の名前)を足す: 神秘・日常の部品は `data.motion` があれば `LyraMitateGen.MOTIONS` のラベル、無ければ `LyraMitateGen.motionOf(e)` の判定(手書きの部品)。文様は「文様」、鳥は「鳥」
- `vocabCatalogText()` の列に質感を足す(`id | 型 | 質感 | 名前 | …`)
- mitate の `text`/`paramText` に「一瞬の混沌」(調性を持たせない・ピアノで弾いて旋律や一定の拍に聞こえる置き方をしない)と、質感ごとの置き方を書く:
  一瞬の光・点描・短い塊・無音・物音・塊が崩れる・一音の状態の変化 = once(多くて sparse)/ 群れ・層・裂け目・和音の移り変わり = once か sparse / 文様 = continuous も可 / 鳥 = sparse・periodic
- アプリ側の歯止め(ユーザー確認済み): 神秘・日常の語彙で occurrence が periodic・continuous なら sparse にする(design.js の整え方)。同じ語彙が一定間隔で繰り返されるとリズムに聞こえるため。下の「ユーザーに確かめること」1

### 2. 試聴・WAV を語彙の本当の音(`scheduleMu`)で鳴らす
- 設計図の層に、語彙の音の写しを三層の情報ごと残す: 新しい欄 `layer.vocabParts`(js/mitategura.js の SEED と同じ parts の形: notes・env・mu・morph・bend・noise・tones)。
  神秘・日常の語彙だけ(文様・鳥は今の `vocabNotes` のまま。対象外)。`vocabNotes`(A の音、MIDI の音符用)は今までどおり残す。
  design.js で `vocabNotes` と同じように入れる・整える・作り直しで Gemini に返す形から外す(381行目付近の除外に足す)。`vocabOf()` が parts も返すようにする
- 古い設計図(`vocabParts` が無い)は今までどおり `lyra_mu` で鳴る(移行はしない。振り直し・作り直しで帳に語彙があれば `vocabParts` が入る)
- 試聴: mitate 層で `vocabParts` がある時、その層の音符は `lyra_mu` で鳴らさず、語彙の出現(occurrence で置いた各回)ごとに `scheduleMu` 相当で鳴らす。
  - `scheduleMu(ctx, entry, startAt)`(js/mitategura.js)に、出口(dest)と音量を外から渡せる形を足す(今は `safeOut(ctx)` 直結。試聴は play.js の `out`(CC11/7・previewMaster の手前)へ、WAV(OfflineAudioContext)は ctx.destination 側へ)
  - 語彙の時間は秒のまま(render は「秒→拍」をテンポで直している。再生の拍→秒で同じ秒に戻る)。主音への移し(shift)と register のオクターブ移動を、`scheduleMu` に渡す音の高さにも同じだけかける
  - 各回の強さ(render の `lift`)も音量にかける
  - 出現の時刻を試聴へ渡す経路は Codex が決める(例: 生成結果の midi に `mu: [{ part, beat, shift, lift }]` を持たせ、parts は設計図の層から引く。midi はカードに保存されるので、parts の丸写しを midi に入れない)
  - 編集画面でその層の音符を直した時は、直した音符を `lyra_mu` で鳴らす(語彙の音より、ユーザーの編集を優先。ユーザー確認済み)
- 音量: 今の `lyra_mu` での鳴り(お手本で -12.5dBFS)と、`scheduleMu` 経由が ±3dB に収まるよう合わせ、数値で確かめる

### 3. .mid(Cubase への保存)に B の音を足す(js/midi/export.js)
- mitate 層で `vocabParts` がある時、LYRA Host へ送るのと同じ決まり(js/mitategura.js `hostMidiOf()`: B の量が `B_ON` 以上の所だけ +1・+2半音をノートに、量に応じた強さ)で B の音を作り、
  **別のトラック**(名前は「〈語彙名〉・B」)として .mid に入れる。A は今までどおり。ノイズだけの層(`tones: false`)は入れない。音程のすべり(bend)はピッチベンドにしない(対象外)
- `hostMidiOf()` の B の計算を、parts を受け取る関数に切り出して両方から使う(同じ決まりを2か所に書かない)

## 対象外
- 文様・鳥の語彙を試聴で本当の音(js/mitatecolor.js)にすること
- 見立て蔵モデルのほかの層(身振り・D リディアンの器)が調性を持ち込む問題(気になれば別のタスク)
- .mid のピッチベンド・ノイズ・C の +5セント
- 語彙の作り直し(`task-mitate-regen.md`)

## 受け入れ条件
- [x] Gemini に渡す mitate の目録に質感の列があり、生成器の説明に「一瞬の混沌」と質感ごとの置き方がある(本物の Gemini で選び方が変わるかは未確認でよい)
- [x] 神秘の語彙を選んだ層が、試聴で見立て蔵の窓と同じ音になる(三層の変わり方・ノイズ・すべり・点描の無音)。数値で: 窓の `scheduleMu` 単体と、生成物の試聴の該当区間の波形が、同じ時刻に鳴り同じくらいの音量(±3dB)
- [x] WAV の書き出しでも同じ音になり、`safeOut` を通らない(WAV の決まり)
- [x] 古い設計図(`vocabParts` なし)のカードが今までどおり鳴る・壊れない
- [x] 帳から語彙を外した後も、振り直し・伸ばすで同じ音が鳴る(`vocabParts` の写し)
- [x] .mid に「〈語彙名〉・B」のトラックがあり、B の量が少ない所には入らない。ノイズだけの層の音が入らない
- [x] 主音が D でない設計図・register を指定した層で、`scheduleMu` 側の高さも同じだけ動く
- [x] 操作の衝突: 試聴の停止・ミュート/ソロ・音量(CC11/7)が、語彙の層にも効く
- [x] 保存して読み込み直した後(Drive と同じ JSON の往復を模擬)も `vocabParts` が残り、同じ音。本物の Drive での通信は未確認

## 設計・制約
- 設計図に `vocabParts` が増える(1層あたり最大40音+状態)。Drive の JSON が大きくなりすぎないか、層の数×件で確かめる
- `scheduleMu` は全JS共有のグローバルに出さず、`window.LyraMitate` 経由で呼ぶ
- 【推測】と書いた所は、ユーザーの答えで変える

## ユーザーに確かめること
1. 神秘の語彙の occurrence を、アプリ側で sparse までに抑えてよいか → **OK**(2026-10-07、ユーザー)
2. 編集画面で語彙の層の音符を直したら、直した音符を共通の音色で鳴らす(語彙の三層の音はやめる)でよいか→ **(a) 直した音符を共通の音色で鳴らす**(2026-10-07、ユーザー「ではaで」)

## 確認コマンド
- `node --check` を変えたファイルすべて
- Node: `catalog()` の質感、`vocabCatalogText()` の列、design の整え(`vocabParts` の入る・除外・古い形)、B の切り出し関数(`hostMidiOf()` と同じ結果)

## 画面検証
- URL: 確認用ページ `docs/duo/check-mitate-vocab-midi.html`(Drive・Gemini を模擬。見立て蔵モデルの設計図に、霜の花・鳥居をくぐる・風鈴の最後の一打などの語彙の層を差し込む)
- 操作: 試聴・停止・ミュート/ソロ・WAV・.mid・保存→読み込み直し・語彙を帳から外して振り直し
- 期待結果: 上の受け入れ条件。音は波形・音量・無音の長さを数値で(耳での確認はユーザーに残す)
- 耳・実機での確認が要るもの: 生成物の中で語彙がどう聞こえるか、Cubase で B のトラックが使えるか、本物の Gemini の選び方

## Codexの実装・検証記録
- 実装・検証: Codex、2026-10-07。作業開始時のブランチはmain。プレミックス関連などの既存変更は保護し、コミット・マージはしていない。
- 2026-10-08 継続確認: 最新の確認ページへ再読込し、MIDIボタンから月光の173 bytes・3トラック(テンポ/A/B)の生成表示を確認。Node・ブラウザーの数値検証も再実行して成功。お手本の音量差は0.42dB。確認ページは開いたまま残した。ダウンロード先のファイル読込は引き続き未確認。
- 変更した箇所:
  - `js/mitategura.js`: catalogの質感、vocabOfの三層の写し、40音・既知の欄に整えるsanitizeParts、scheduleMuの出口・音量・移調・範囲、HostとSMFで共有するmidiFromParts。
  - `js/midi/generators.js`・`design.js`: 質感の列・置き方、神秘/日常のsparseへの制限、vocabParts保存・プロンプトから除外。秒の音をテンポ変化も考慮して拍に置く。
  - `engine.js`・`play.js`: 出現をmidi.muへ渡し、partLayers経由で写しを参照。原音をCC11/7・previewMasterの前へ接続。WAVはsafeOutを通さない。音符の一致をmuStampで検出し、変更されたパートは共通三層で鳴らす。原音にはハネ・ダブ・感情の音符後処理を加えない。
  - `export.js`・`editor.js`: Bを別トラックで追加。時間・高さの範囲で書き出しを切る。編集画面で非表示にしたパートの出現も除く。
  - `compose.js`: 古い設計図の振り直し時、帳に語彙があれば三層の写しを入れる。ノイズのみで音符が無い原音も生成結果として扱う。
  - `extend.js`: 「帳から外して伸ばす」の受け入れ条件を満たすために追加で対応。元の出現と続きの出現を、音符と同じ境界・パート名で引き継ぐ。
  - `docs/duo/test-mitate-vocab-midi.cjs`、`check-mitate-vocab-midi.html`・`.js`: Nodeとブラウザーの確認用ページ。
- `index.html` の `?v=`: 編集した9本のJSを更新。既存のプレミックス関連タグの変更は維持。
- 実行した確認:
  - 変更したJSすべての`node --check`。
  - `node docs/duo/test-mitate-vocab-midi.cjs`: 目録・保存/旧形式・写しの除外・主音/音域・B閾値/強さ/ノイズ除外・SMFのB別トラック(merged/split)・音符の編集優先・範囲・40音上限・JSON容量。帳が空の状態で実際のextendMidiを実行し、元と続きの出現を確認。
  - ローカルサーバーの確認ページをCodex内ブラウザーで操作。既存の8000番は別内容を配信していたため、`python -m http.server 8001 --bind 127.0.0.1`で`http://localhost:8001/docs/duo/check-mitate-vocab-midi.html`を使用。
  - 数値検証は6語彙(夜道の月光・霜の花・鳥居をくぐる・風鈴の最後の一打・池の氷が鳴る・境内の砂利)。OfflineAudioContextに加え、試聴側の接続を同じ録音先へ向けた模擬ctxでも検証。safeOutは接続回数を読める模擬関数(実際のリミッターの変化は測定対象外)。
  - 試聴→停止、模擬の保存→読込、帳から外して振り直し、WAVボタンを実際に操作。停止・消音/ソロ・CC11/7・移調は波形でも検証。
- 結果:
  - 補正した原音とWAVの波形最大差は5.96×10^-8以下。窓との音量差は全語彙で約-1.94dB。月光はWAV -14.51dBFS / 窓 -12.58dBFS、点描(霜の花)は-18.55 / -16.61dBFS。
  - 鳥居の途中0.8秒の無音は最大振幅0。試聴の接続とWAVの音量は一致、停止・消音後は無音。CC11=0で-20.83dB、CC7も有効。ソロでも語彙だけの波形を維持。
  - 主音G・lowでは原音も-31半音で同じ音量。JSON往復・帳から外して振り直した後も波形音量を維持。
  - 見立て蔵のお手本: 初回は新-11.69 / 旧-12.04dBFS、差0.35dB。最終検証は新-11.49 / 旧-12.69dBFS、差1.20dB。語彙以外の共通音色の揺れは乱数なので数値は毎回少し変わる。どちらも±3dB以内。
  - 月光の写し8層の設計図JSONは5,980 bytes、単純な40音の写し8層は9,668 bytes。状態のキーフレームが多い場合は増える。
- 未確認・既知の問題:
  - 耳、本物のGemini・Drive、スマホ、Cubase、実際のLYRA Hostは未確認。Driveの通信処理は変更せず、保存対象JSONの往復を確認した。
  - 本体のMIDIエディターでの実操作は未確認。音符を変更したデータで、原音の予約を止め共通三層へ切り替える経路を確認した。
  - ブラウザーのWAVボタンは書き出し完了表示まで確認。ダウンロードイベントを取得できず、保存先のファイルを読み直す確認は未確認。WAVのRIFF/WAVEヘッダー・SMFのBトラックを生成データで別途検証済み。
  - 文様・鳥の本当の音、Cのセントやノイズ・bendの.mid書き出しは計画どおり対象外。
- 追記した `docs/*.md`: `docs/mitategura.md`、`docs/midi.md`、`docs/lyrahost.md`。

## Claude Codeの最終チェック(2026-10-08)
- 結果: **問題なし**
- 確認したこと:
  - JS の差分を全部読んだ(`mitategura.js`・`generators.js`・`design.js`・`engine.js`・`play.js`・`export.js`・`editor.js`・`extend.js`・`compose.js`)。計画の1〜3とユーザーの答え(繰り返しは sparse まで・編集した層は共通の三層)どおり。
    写し `vocabParts` は Gemini に返す形から外れ、整え(`sanitizeParts`)で既知の欄・40音までに絞っている。B の計算は LYRA Host 用と共有(`midiFromParts`)。WAV は `safeOut` を通らない。`?v=` は更新済み
  - 全 JS の `node --check`、`test-mitate-vocab-midi.cjs` を私の環境で実行: すべて成功(8層の設計図 JSON 5,980 bytes)
  - 確認用ページの数値検証を Chrome で実行: すべて PASS(6語彙で試聴・WAV と窓の原音の波形の最大差 6×10^-8 以下、鳥居の途中の無音 -240dBFS、編集した層は共通の三層で B なし、
    .mid に「〈語彙名〉・B」、ノイズだけの層は .mid に入らない、CC11 -20.8dB、消音・CC7・ソロ、保存→読込・帳から外して振り直し、G 主音・低音域で -31半音)
  - アプリ本体(`index.html`)をキャッシュの無い状態で開き、読み込みエラー0件・目録に質感の列があることを確かめた
  - 気づいたこと(直さなくてよい): 確認用ページはスクリプトに `?v=` が無いので、同じポートで前に開いていると古い JS をキャッシュから読む
    (私の Chrome で `sanitizeParts is not a function` になり、別のポートで開き直して通った。アプリ本体は `?v=` 付きなので関係ない)
- 確かめていないこと: 耳、本物の Gemini・Drive、Cubase、LYRA Host、本体の MIDI エディターでの実操作
- 直してほしい所: なし
- ユーザーに確かめること:
  1. カードの音色をピアノなどに変えていても、**語彙の層は必ず見立て蔵の三層の音で鳴る**ようになった(前はカードの音色に従っていた)。語彙の音を守る意図に合うが、これでよいか
  2. (小さなこと)Gemini が発想した質感(`data.motion: 'free'`)の語彙は、目録の質感の列に、発想した名前ではなく音から判定した名前(「層・群れ」など)が出る。発想した名前を出すか
