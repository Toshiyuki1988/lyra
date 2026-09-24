# LYRA — 開発メモ

CONSTELLATION(美術鑑賞記録アプリ)の姉妹アプリ。DTMプラグイン/実楽器/ジャンル/舞台のマニュアル・文献を
読解・分解・体系化し、Cubase Pro 15 + Max 9での作曲作業を後押しする個人用Webアプリ。
**仕様の正本は `LYRA_handoff.md`**(claude.aiでの構想フェーズからの引き継ぎ)。このファイルは実装上の
約束事と、実装が進むにつれて判明した経緯を記録する。

- リポジトリ: https://github.com/Toshiyuki1988/lyra (Public、GitHub Pagesのため)
- 公開URL: https://toshiyuki1988.github.io/lyra/
- CONSTELLATION本体: `C:\Users\Toshiyuki\Desktop\constellation`(共通基盤のコピー元。LYRAの作業中にそちらを編集しない)

---

## 絶対条件

- **完全無料運用**。Gemini APIキーのプロジェクトには請求先アカウントを絶対に紐付けない
  (無料枠超過時は課金でなく429エラーになるようにする)
- **GCPプロジェクト・OAuthクライアントはCONSTELLATIONと分ける**(2026-09-24決定)。
  理由は README.md「CONSTELLATIONとの分離」参照(Gemini無料枠の取り合い防止/`drive.file`の
  アクセス範囲をOAuthクライアント単位で分離)。**LYRAのコードからCONSTELLATIONのDriveファイルや
  localStorage(`constellation.`で始まるキー)に触れる設計は作らない**
- **Driveのファイルをアプリ側から削除・上書きしない**。`js/drive.js`に削除関数は意図的に持たせていない
  (CONSTELLATIONで、完全削除と分かりにくい確認ダイアログが重なり、実機で二度と戻せない写真を失った
  事故があったため)。「使わなくする」時はカード側の参照を外すだけにする
- **著作権ゲート**(ハンドオフ8節): 出典・テキストカードに共有/公開/エクスポート機能を作らない。
  出典の抜粋には長さ上限、ソウルの提案は構造化データ+短い説明に留め、原文を丸ごと出さない
- **Geminiモデルは `gemini-3.5-flash-lite`**(無料枠1日250回、2026-09-24ユーザー決定)。
  Liteは込み入った構造化抽出で精度が落ちることがCONSTELLATIONで実機確認されているため、
  解体パイプラインは (1) 1回に詰め込まず「構造把握→モジュール単位の詳細抽出」に分ける、
  (2) `responseSchema`(`askGeminiJson()`)で出力形式を固定する、(3) 抽出結果は「未確認(点線)」
  として入れ、人が「確認済み(実線)」にする、の3つで補う。フル版モデルへ戻すのは無料枠が小さすぎる
  ため選択肢に入れない
- **検索グラウンディング(`google_search`ツール)は使わない**。請求先非紐付けの無料キーでは即429になる
  ことがCONSTELLATIONで実機確認済み。`askGemini()`は`tools`引数自体を受け付けない作りにしてある

## 開発方針(CONSTELLATIONから引き継ぐもの)

- **根本原因への到達を早期に検証する**: 不具合調査では、仮説の延長で対策(パラメータ緩和・当たり判定の
  拡大等)を重ねる前に、無条件の診断ログ(`?debug`付きURLで表示される`debugLog()`)や実機再現で
  「本当にそこで起きているか」を事実で確認してから修正する
- **A/B二択に`window.confirm()`を使わない**。`showChoiceDialog()`(`js/app.js`)でラベル付きの対等な
  ボタンにし、元に戻せない側は`danger: true`で赤くする
- **背景タップで閉じるオーバーレイは`attachBackgroundTapToClose()`を使う**(単純なclick判定は
  スマホで誤って閉じやすい)
- **JS/CSSを編集したら、`index.html`の対応タグの`?v=YYYYMMDDx`を必ず更新する**(キャッシュで古い
  JSが読まれ続け「実装したはずの機能が出ない」事故がCONSTELLATIONで実際にあった)
- **全JSファイルはグローバルスコープを共有する**。トップレベルの`const`/`let`/関数名が衝突すると
  そのスクリプトごと読み込みエラーで死ぬ。大きな機能を別ファイルに切り出す時は
  `(function () { ... })();`で包む
- **保存系の最終防波堤**: `js/app.js`の`dataLoaded`がfalseの間(Driveから読み込む前)は保存処理
  自体を実行しない。読み込み前の空stateでDriveを上書きする事故を防ぐため。起動シーケンスを分割・遅延
  させる変更をする時も、この防波堤を外さない
- **高頻度イベント(pointermove)から「全部を引き直す」関数を呼ばない**。Asterism線はドラッグ中は
  `updateAsterismLinesForCard()`の軽量パス、フル再構築は指を離した時だけ
- **キャンバス上の写真は`background-image`ではなく`<img>`で表示する**(`transform: scale()`の
  ズーム下で`background-image`の実解像度が追従しないモバイルの既知の制約)。`<img>`には
  `-webkit-user-drag: none`を最初から付ける(ネイティブドラッグがカードの複製に見える不具合の予防)
- **重要な操作の入口をジェスチャーだけに頼らない**。確実に押せるボタンを必ず併設する
- モックアップを作る場合は単体HTMLで検証してから本実装する(CONSTELLATIONと同じ運用)

## 共通基盤(2026-09-24、CONSTELLATIONからコピー)

| ファイル | 由来 | 変更点 |
|---|---|---|
| `js/auth.js` | そのままコピー | なし |
| `js/drive.js` | コピー | ヘッダーコメント、`moveFile()`(移行専用)を削除、`loadData()`の初期値をnullに |
| `js/canvas.js` | コピー | Flight Engineer/Star Pencil/座談会など、CONSTELLATIONのモジュール固有のガードを除去 |
| `js/sound.js` | 先頭の共通部分のみ | 編集ガイド・ASTR・カード移動の4音だけ残した |
| `js/gemini.js` | `askGemini()`のみ流用し書き換え | `files`(PDF/画像のインライン入力)・`responseSchema`対応、`askGeminiJson()`追加、タイムアウト90秒、`tools`撤去 |
| `js/config.js` | 新規 | `lyra.`始まりのlocalStorageキー、スコープは`drive.file`のみ、フォルダ名`LYRA` |
| `js/app.js` | 新規(必要な関数だけ移植) | 設定・サインイン・保存・テキストカード・ASTR手動接続・`showChoiceDialog()` |

- **LYRAのAsterismは手動接続のみ**(自動の「見た順」線は持たない、ハンドオフ4.2/4.3節)
- キャンバス背景は五線譜風の薄い罫線(ハンドオフ4.3節)。ドット格子ではない

## 現在の状態

- 共通基盤の土台のみ(テキストカード1種類を置いて線で結べる最小構成)
- GCPプロジェクト`LYRA`・OAuthクライアント・Gemini APIキーの発行は**ユーザー側の手作業待ち**(README.md手順1〜6)
- 次に着手するもの: ハンドオフ4.1節の入口画面(全ソウルを星として自由配置で俯瞰)から、優先順位をユーザーと相談して決める
