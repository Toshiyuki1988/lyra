# LYRA

CONSTELLATIONの姉妹アプリ。DTMプラグイン/実楽器/ジャンル/舞台のマニュアル・文献を読解・分解・体系化し、
Cubaseでの作曲作業を後押しする個人用Webアプリ。GitHub Pages(静的サイト)+ ブラウザ完結の
Google Drive API / Gemini API で、バックエンドなし・完全無料で動かす。

仕様の全体像は `LYRA_handoff.md`、開発上の約束事は `CLAUDE.md` を参照。

## 構成

| 役割 | 技術 |
|---|---|
| ホスティング | GitHub Pages(`https://toshiyuki1988.github.io/lyra/`) |
| キャンバス操作 | interact.js(ドラッグ・リサイズ・ピンチズーム) |
| データ保存 | Google Drive API v3(ブラウザから直接、OAuth、`drive.file`スコープ) |
| 文献解体・ソウル | Gemini API(ブラウザから直接、APIキー、`gemini-3.5-flash-lite`) |

## ファイル構成

```
lyra/
├── index.html
├── privacy.html        … OAuth同意画面の「プライバシーポリシー」リンク先
├── css/style.css
└── js/
    ├── config.js        … アプリの既定設定(秘密情報は含まない)
    ├── auth.js          … Google Identity Services によるOAuth(CONSTELLATIONから流用)
    ├── drive.js         … Drive API v3 ラッパー(CONSTELLATIONから流用)
    ├── gemini.js        … Gemini API ラッパー(PDF入力・Files API・responseSchema対応)
    ├── sound.js         … 操作音(CONSTELLATIONから共通部分のみ流用)
    ├── canvas.js        … キャンバス操作・編集ガイド・ASTRジェスチャー(CONSTELLATIONから流用)
    ├── app.js           … 中核(データ・画面切り替え・カードとASTRの共通処理・ダイアログ)
    ├── decompose.js     … 資料の解体パイプライン
    ├── scales.js        … 音階の一覧とリスケーリング
    ├── midi/            … MIDI生成一式(仕組みは models/README.md)
    │   ├── theory.js / engine.js / generators.js … 音楽理論・軸と合成・層の生成器
    │   ├── design.js / presets.js / compose.js   … 設計図の形・モデル(プリセット)・Geminiとの流れ
    │   └── play.js / export.js / editor.js / card.js / feedback.js … 試聴とWAV・.midとフォルダへの保存・編集画面・カード・★評価
    ├── imagesearch.js   … 画像カードの画像検索(Pixabay API)
    ├── audio.js         … オーディオの圧縮・保存・再生
    ├── daily.js         … 日次課題
    └── screens/
        ├── home.js      … 入口画面(ソウルの星図)
        ├── soul.js      … ソウル画面(モジュール・パラメータ)
        └── ensemble.js  … アンサンブル画面
```

データは各ユーザー自身のGoogle Driveのマイドライブ直下に作成される `LYRA` フォルダに保存される
(`lyra-data.json` と、`screenshots/`・`sources/`・`audio/` サブフォルダ)。

## CONSTELLATIONとの分離(重要)

LYRAは **GCPプロジェクトもOAuthクライアントもCONSTELLATIONと分けて** 作る。

- **Geminiの無料枠を取り合わないため**: 無料枠は「GCPプロジェクト×モデル」単位で数えられる。
  同じプロジェクトのキーだと、LYRAの文献解体とCONSTELLATIONの現地OCRが1日250回の枠を共有してしまう。
- **LYRAからCONSTELLATIONのDriveファイルに触れないため**: `drive.file`スコープの
  「アプリが作成したファイル」はOAuthクライアント単位で判定される。クライアントを分けておけば、
  LYRAのコードからCONSTELLATIONの写真・JSONは構造的に見えない。
- ブラウザの`localStorage`のキー名も`lyra.`始まりにしてあり、同じオリジン
  (`toshiyuki1988.github.io`)で動くCONSTELLATIONの設定とは混ざらない。

---

## セットアップ手順

### 1. 新しいGCPプロジェクトを作る

1. https://console.cloud.google.com/ を開く
2. 上部のプロジェクト選択 →「新しいプロジェクト」→ 名前 `LYRA` で作成
3. 以降の手順は、**プロジェクト選択が `LYRA` になっていることを毎回確認してから**行う
   (CONSTELLATIONのプロジェクトで作業してしまうと分離の意味がなくなる)

### 2. 課金を有効化しない(最重要)

「お支払い」メニューで、**このプロジェクトに請求先アカウントがリンクされていないこと**を確認する。
リンクされていなければ、無料枠を超えたリクエストは課金されずにエラー(429)になるだけになる。

### 3. 必要なAPIを有効化

「APIとサービス」→「ライブラリ」から以下を有効化:

- **Google Drive API**
- **Generative Language API**(Gemini API)

### 4. OAuth同意画面(Google Auth Platform)の設定

1. User Type は **外部**
2. アプリ名 `LYRA`、サポートメール(自分のアドレス)を入力
3. **「アプリケーションのホームページ」と「プライバシーポリシーへのリンク」も必ず埋める**
   - ホームページ: `https://toshiyuki1988.github.io/lyra/`
   - プライバシーポリシー: `https://toshiyuki1988.github.io/lyra/privacy.html`
   - ※CONSTELLATIONのとき、この2つが未入力だと構成が完了せず、テストユーザーの追加が
     保存されない(リロードで消える)不具合にハマった
4. 承認済みドメインに `toshiyuki1988.github.io`
5. 「対象」で **「アプリを公開」して公開ステータスを「本番環境」にする**
   - LYRA(2026-09-25)では「テスト」のままだとテストユーザーを追加しても保存されず、
     サインインが `エラー 403: access_denied`(審査プロセスを完了していません)になった。
     確認したところCONSTELLATIONも実は「本番環境」で運用されていた
   - スコープが`drive.file`(非機密)のみなので、本番にしてもGoogleの審査は不要。
     サインイン時に「確認されていないアプリ」の警告が出たら「詳細」→「移動」で進む
   - `drive.file`以外のスコープを足す場合は審査が必要になるので、その時は改めて検討する

### 5. OAuthクライアントIDの作成(LYRA専用)

「APIとサービス」→「認証情報」→「認証情報を作成」→「OAuthクライアントID」

1. アプリケーションの種類: **ウェブアプリケーション**
2. 名前: `lyra-web`
3. **承認済みのJavaScript生成元**: `https://toshiyuki1988.github.io`(パスなし)
   - ローカルで確認する場合は `http://localhost:8000` なども追加
4. 表示された **クライアントID** を控える

### 6. Gemini APIキー(Auth Key)の作成

1. https://aistudio.google.com/api-keys を開く
2. **プロジェクト `LYRA` を選択した状態で**「Create API key」
3. 表示されたキー(`AQ.`で始まる)を控える
4. AI Studioのダッシュボードで、`gemini-3.5-flash-lite` の無料枠が1日何リクエストか確認しておく
   (CONSTELLATIONのプロジェクトでは250だった)

### 7. GitHub Pagesへのデプロイ

1. GitHubで `lyra` という名前のリポジトリを作成(Public。無料アカウントのPagesはPublic必須)
2. このフォルダをpush
   ```bash
   git remote add origin https://github.com/Toshiyuki1988/lyra.git
   git push -u origin main
   ```
3. リポジトリの「Settings」→「Pages」→ Source を **Deploy from a branch**、Branch を **main / (root)**
4. `https://toshiyuki1988.github.io/lyra/` で公開される

### 8. 初期設定と動作確認

1. 公開URLを開くと「初期設定」ダイアログが出る
2. 手順5のクライアントIDと手順6のAPIキーを入力して「保存」(このブラウザのlocalStorageにのみ保存)
3. 「Googleでサインイン」→ 同意
4. 下部の「テキスト」でカードを作成。長押しで編集ガイド、ASTRを長押ししたまま別のカードへドラッグで接続
5. Driveの `LYRA` フォルダに `lyra-data.json` が作られていれば成功

### 9. Pixabay APIキー(任意。画像カードの画像検索に使う)

アンサンブル画面の画像カードは、アプリの中でPixabayの画像を検索して入れられる。キーが無くても、PCのファイル・
ドロップ・貼り付けで画像カードは使える。

1. https://pixabay.com/ にログインする
2. https://pixabay.com/api/docs/ を開く
3. ページ中ほどの「Parameters」の `key (required)` の欄に、自分のAPIキー(`12345678-` のような数字と英数字の文字列)が
   表示されているのでコピーする(ログインしていないと表示されない)
4. LYRAの右上の⚙(設定)→「Pixabay APIキー」に貼り付けて「保存」(このブラウザのlocalStorageにのみ保存。
   Driveやリポジトリには書かない)
5. アンサンブル画面の道具バー「画像」→ 検索窓で検索し、サムネイルをクリックして画像カードが置かれれば成功

- 無料。上限は1分あたり100回(超えると少し待てば戻る)。同じ検索はアプリが24時間キャッシュするので、APIを呼び直さない
- 画像はPixabayのコンテンツライセンス(商用利用可・クレジット表記不要)。アプリは選んだ画像を長辺512pxに縮めて
  このブラウザの中(IndexedDB)にだけ置き、Driveには上げない
- 検索パネルには規約どおり出どころ(「画像: Pixabay」)を表示している
