// Gemini API をブラウザから直接叩くラッパー(CONSTELLATIONのjs/gemini.jsから共通部分を流用)。
// 認証は Google AI Studio 発行の Auth Key(AQ.〜形式)を x-goog-api-key ヘッダーで渡す。
// 課金設定をしないプロジェクトのキーで呼ぶ想定 → 無料枠を超えると課金される代わりに
// エラー(429など)になるだけなので、完全無料運用が保証される。

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';

// fetch()には既定でタイムアウトが無いため、一定時間で必ずエラーとして諦める。
// PDFの解体は画像1枚のOCRより時間がかかるため、CONSTELLATION(30秒)より長めに取っている。
const GEMINI_TIMEOUT_MS = 90000;

/**
 * 外部から渡されたsignal(ユーザーによる明示キャンセル用)と、内部のタイムアウトを
 * 1つのAbortSignalへ合成する。どちらが理由でabortしたかは、fetch失敗時に
 * `signal.aborted`(外部signal)を見て判別する。
 */
function withTimeoutSignal(externalSignal, ms) {
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', onExternalAbort);
  }
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
    },
  };
}

/**
 * @param {{prompt: string, files?: ({base64: string, mimeType: string}|{fileUri: string, mimeType: string})[],
 *   responseSchema?: object, signal?: AbortSignal, maxOutputTokens?: number}} params
 *   files: PDF(application/pdf)・画像などをインラインで添付する。マニュアルPDFの解体は
 *     GeminiのPDFネイティブ入力をそのまま使う(ハンドオフ7節)。
 *   responseSchema: 指定するとJSONモードで呼び、出力の形をスキーマで固定する。
 *     Liteモデルの構造化抽出の精度低下を補うための手段の一つ(js/config.js参照)。
 *   signal: 呼び出し元が明示的にキャンセルしたい場合に渡す。
 *   maxOutputTokens: 長い応答を途中で切らせたくない場合に指定する。
 *   **toolsは受け付けない**: google_search(検索グラウンディング)は請求先アカウント非紐付けの
 *   無料キーだと即429になることがCONSTELLATIONで実機確認済みのため、最初から持たせない。
 * @returns {Promise<string>} 生成されたテキスト(responseSchema指定時はJSON文字列)
 */
async function askGemini({ prompt, files, responseSchema, signal, maxOutputTokens }) {
  const parts = [{ text: prompt }];
  (files || []).forEach((f) => {
    if (f && f.fileUri) parts.push({ file_data: { mime_type: f.mimeType, file_uri: f.fileUri } });
    else if (f && f.base64) parts.push({ inline_data: { mime_type: f.mimeType, data: f.base64 } });
  });

  const body = { contents: [{ parts }] };
  const generationConfig = {};
  if (maxOutputTokens) generationConfig.maxOutputTokens = maxOutputTokens;
  if (responseSchema) {
    generationConfig.responseMimeType = 'application/json';
    generationConfig.responseSchema = responseSchema;
  }
  if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;

  const { signal: fetchSignal, cleanup } = withTimeoutSignal(signal, GEMINI_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${GEMINI_API}/models/${CONFIG.GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': CONFIG.GEMINI_API_KEY,
      },
      body: JSON.stringify(body),
      signal: fetchSignal,
    });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      const wasUserCancel = Boolean(signal && signal.aborted);
      const e = new Error(
        wasUserCancel
          ? 'キャンセルされました'
          : `Gemini APIの応答がありません(${GEMINI_TIMEOUT_MS / 1000}秒でタイムアウトしました)。電波状況をご確認のうえもう一度お試しください`
      );
      e.cancelled = wasUserCancel;
      e.timedOut = !wasUserCancel;
      throw e;
    }
    throw err;
  } finally {
    cleanup();
  }
  if (!res.ok) {
    const bodyText = await res.text();
    // 解体パイプラインのように短時間に複数回呼ぶと、無料枠の分あたりの上限(RPM)に
    // 触れて429になることがある(日あたりの上限とは別の枠)。原因が分かるよう明示する。
    if (res.status === 429) {
      throw new Error(
        `Gemini APIの利用上限(429)に達しました。無料枠は1分あたり・1日あたりそれぞれ上限があるため、` +
        `短時間に連続で呼び出すと起きることがあります。少し間隔を空けてから再試行してください。詳細: ${bodyText}`
      );
    }
    throw new Error(`Gemini API error ${res.status}: ${bodyText}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
}

/**
 * responseSchemaで構造化出力させ、パース済みのオブジェクトを返す。
 * JSONモードでもまれにコードフェンス付きで返ることがあるため、念のため除去してからparseする。
 */
async function askGeminiJson({ prompt, files, responseSchema, signal, maxOutputTokens }) {
  const raw = await askGemini({ prompt, files, responseSchema, signal, maxOutputTokens });
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  return JSON.parse(cleaned);
}

/**
 * Gemini Files APIへファイル(マニュアルPDFなど)をアップロードし、{fileUri, mimeType} を返す。
 * インライン送信(base64)はリクエスト全体でおよそ20MBまでで、解体パイプラインのように同じPDFを
 * 何度も送る(構造把握→モジュールごとの詳細抽出)と通信量も増えるため、一度アップロードして
 * URIを使い回す。アップロードしたファイルはGoogle側で48時間後に自動で消える(無料で使える)。
 * ブラウザからの呼び出しがCORS等で失敗した場合は例外を投げるので、呼び出し側でインライン送信に
 * 切り替えること。
 */
async function uploadGeminiFile(blob, displayName, signal) {
  const mimeType = blob.type || 'application/pdf';
  const startRes = await fetch(`${GEMINI_API.replace('/v1beta', '')}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': CONFIG.GEMINI_API_KEY,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(blob.size),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: displayName } }),
    signal,
  });
  if (!startRes.ok) throw new Error(`Files APIの開始に失敗 ${startRes.status}: ${await startRes.text()}`);
  const uploadUrl = startRes.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('Files APIのアップロード先URLを受け取れませんでした');

  const upRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: blob,
    signal,
  });
  if (!upRes.ok) throw new Error(`Files APIのアップロードに失敗 ${upRes.status}: ${await upRes.text()}`);
  let file = (await upRes.json()).file;

  // PDFはGoogle側の処理が終わる(state: ACTIVE)まで使えないため待つ
  for (let i = 0; i < 30 && file.state === 'PROCESSING'; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(`${GEMINI_API}/${file.name}`, { headers: { 'x-goog-api-key': CONFIG.GEMINI_API_KEY }, signal });
    if (!res.ok) throw new Error(`Files APIの状態確認に失敗 ${res.status}`);
    file = await res.json();
  }
  if (file.state === 'FAILED') throw new Error('Files API側でファイルの処理に失敗しました');
  return { fileUri: file.uri, mimeType: file.mimeType || mimeType, expiresAt: file.expirationTime || null };
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
