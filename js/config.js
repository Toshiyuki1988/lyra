// LYRA 設定ファイル
//
// OAuthクライアントID・Gemini APIキーはこのファイルにも、Gitリポジトリのどこにも
// 書き込まない。初回アクセス時に画面の「設定」ダイアログで入力してもらい、
// このブラウザの localStorage にのみ保存する(バックエンドを持たないため)。
//
// **CONSTELLATIONとはGCPプロジェクトもOAuthクライアントも分けている**(README.md参照)。
// - Gemini の無料枠は「プロジェクト×モデル」単位のため、プロジェクトを分けることで
//   CONSTELLATIONの現地OCRとLYRAの文献解体が1日の枠を取り合わない。
// - drive.file スコープの「このアプリが作成したファイル」はOAuthクライアント単位で判定される
//   ため、クライアントを分けることでLYRAからCONSTELLATIONのDriveファイルには一切触れない。
// localStorageのキー名も`lyra.`で始め、同じオリジン(toshiyuki1988.github.io)で動く
// CONSTELLATIONの設定(`constellation.`)と混ざらないようにしている。

const CONFIG_STORAGE_KEYS = {
  clientId: 'lyra.googleClientId',
  apiKey: 'lyra.geminiApiKey',
  pixabayKey: 'lyra.pixabayApiKey',
};

const CONFIG = {
  GOOGLE_CLIENT_ID: localStorage.getItem(CONFIG_STORAGE_KEYS.clientId) || '',
  GEMINI_API_KEY: localStorage.getItem(CONFIG_STORAGE_KEYS.apiKey) || '',
  // 画像カードの画像検索(Pixabay API、2026-09-26)。任意。無くても画像カードはPCのファイルから使える
  PIXABAY_API_KEY: localStorage.getItem(CONFIG_STORAGE_KEYS.pixabayKey) || '',

  // 使用する Gemini モデル名。CONSTELLATIONと同じく、無料枠が1日250リクエストある
  // Liteモデルを使う(2026-09決定)。Liteは込み入った構造化抽出で精度が落ちることが
  // CONSTELLATIONで実機確認されているため、解体パイプラインは「構造把握→モジュール単位の
  // 詳細抽出」の複数回呼び出しに分け、responseSchemaで出力形式を固定して補う。
  GEMINI_MODEL: 'gemini-3.5-flash-lite',

  // OAuthスコープ。アプリが作成/開いたファイルのみにアクセスする最小権限スコープ。
  OAUTH_SCOPES: 'https://www.googleapis.com/auth/drive.file',

  // データの保存先フォルダ名(ユーザーのマイドライブ直下に作成される)
  APP_FOLDER_NAME: 'LYRA',

  // ソウル一覧などの構造データを保存する JSON ファイル名(APP_FOLDER_NAME直下)
  DATA_FILE_NAME: 'lyra-data.json',
};

/** クライアントIDとAPIキーが両方入力済みか */
function isConfigured() {
  return Boolean(CONFIG.GOOGLE_CLIENT_ID && CONFIG.GEMINI_API_KEY);
}

/** 設定ダイアログの保存ボタンから呼ぶ。localStorageに書き込み、CONFIGにも反映する。 */
function saveUserConfig({ clientId, apiKey, pixabayKey }) {
  CONFIG.GOOGLE_CLIENT_ID = clientId.trim();
  CONFIG.GEMINI_API_KEY = apiKey.trim();
  CONFIG.PIXABAY_API_KEY = String(pixabayKey || '').trim();
  localStorage.setItem(CONFIG_STORAGE_KEYS.clientId, CONFIG.GOOGLE_CLIENT_ID);
  localStorage.setItem(CONFIG_STORAGE_KEYS.apiKey, CONFIG.GEMINI_API_KEY);
  localStorage.setItem(CONFIG_STORAGE_KEYS.pixabayKey, CONFIG.PIXABAY_API_KEY);
}
