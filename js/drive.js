// Google Drive API v3 をブラウザから直接叩くラッパー(CONSTELLATIONのjs/drive.jsから流用)。
// drive.file スコープのため、このアプリ(=LYRA専用のOAuthクライアント)が作成したファイル/
// フォルダにのみアクセス可能。CONSTELLATIONとはOAuthクライアントを分けているので、
// LYRAからCONSTELLATIONのDriveファイルは見えない。
//
// **アプリ側からDrive上のファイルを削除する関数は意図的に持たない**(CONSTELLATIONで、
// 完全削除(files.delete)と分かりにくい確認ダイアログが重なり、実機で二度と戻せない写真を
// 失った事故があったため)。ファイルを「使わなくする」場合は、カード側の参照を外すだけに留め、
// Drive上の実体には触れない。

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

async function driveFetch(path, options = {}) {
  const token = await ensureAccessToken();
  const res = await fetch(`${DRIVE_API}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    throw new Error(`Drive API error ${res.status}: ${await res.text()}`);
  }
  return res;
}

/** Googleアカウント全体のストレージ使用量を取得する(drive.fileスコープでも呼べる)。
 *  無料アカウント15GBの制約を意識するため(ハンドオフ8節)。 */
async function getDriveStorageQuota() {
  const res = await driveFetch('/about?fields=storageQuota');
  const data = await res.json();
  return data.storageQuota || {};
}

/** アプリ専用フォルダ(CONFIG.APP_FOLDER_NAME)を探し、なければ作成してIDを返す */
async function findOrCreateAppFolder() {
  const q = encodeURIComponent(
    `name='${CONFIG.APP_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const res = await driveFetch(`/files?q=${q}&fields=files(id,name)&spaces=drive`);
  const { files } = await res.json();
  if (files && files.length > 0) return files[0].id;

  const createRes = await driveFetch('/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: CONFIG.APP_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  });
  const created = await createRes.json();
  return created.id;
}

/** 指定した親フォルダの直下から、名前が一致するサブフォルダを探し、無ければ作成してIDを返す */
async function findOrCreateSubfolder(name, parentId) {
  const escaped = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const q = encodeURIComponent(
    `name='${escaped}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
  );
  const res = await driveFetch(`/files?q=${q}&fields=files(id,name)&spaces=drive`);
  const { files } = await res.json();
  if (files && files.length > 0) return files[0].id;

  const createRes = await driveFetch('/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    }),
  });
  const created = await createRes.json();
  return created.id;
}

/** Drive上のフォルダの表示名を変更する */
async function renameDriveFolder(folderId, newName) {
  await driveFetch(`/files/${folderId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName }),
  });
}

async function findDataFile(folderId) {
  const q = encodeURIComponent(
    `name='${CONFIG.DATA_FILE_NAME}' and '${folderId}' in parents and trashed=false`
  );
  const res = await driveFetch(`/files?q=${q}&fields=files(id,name)`);
  const { files } = await res.json();
  return files && files[0] ? files[0].id : null;
}

/** @returns {Promise<{fileId: string|null, data: object|null}>} ファイルが無ければdataはnull
 *  (初期値は呼び出し側(js/app.js)が決める) */
async function loadData(folderId) {
  const fileId = await findDataFile(folderId);
  if (!fileId) return { fileId: null, data: null };
  const res = await driveFetch(`/files/${fileId}?alt=media`);
  const data = await res.json();
  return { fileId, data };
}

/**
 * データJSONを作成 or 上書き保存する。
 * @returns {Promise<string>} 保存後のファイルID
 */
async function saveData(folderId, fileId, data) {
  return saveNamedData(folderId, fileId, data, CONFIG.DATA_FILE_NAME);
}

/** 任意のファイル名でJSONを探す(APP_FOLDER_NAME直下)。saveData/loadDataが暗黙に
 *  CONFIG.DATA_FILE_NAMEを対象にしているのに対し、こちらはソウルごとの本体ファイルのように、
 *  メインのデータファイルとは独立して読み書きしたいものに使う。 */
async function findFileByName(folderId, fileName) {
  const q = encodeURIComponent(
    `name='${fileName}' and '${folderId}' in parents and trashed=false`
  );
  const res = await driveFetch(`/files?q=${q}&fields=files(id,name)`);
  const { files } = await res.json();
  return files && files[0] ? files[0].id : null;
}

/** loadData()の汎用版。ファイルが無ければ{fileId:null, data:null}を返す(呼び出し側で
 *  初期値・移行処理を判断できるよう、loadData()のような既定値は持たせない)。 */
async function loadNamedData(folderId, fileName) {
  const fileId = await findFileByName(folderId, fileName);
  if (!fileId) return { fileId: null, data: null };
  const res = await driveFetch(`/files/${fileId}?alt=media`);
  const data = await res.json();
  return { fileId, data };
}

/** 既に分かっているfileIdからJSONを直接取得する(名前検索を1回省ける)。 */
async function loadFileContentById(fileId) {
  const res = await driveFetch(`/files/${fileId}?alt=media`);
  return res.json();
}

/** saveData()の汎用版。任意のファイル名でJSONを作成/上書き保存する。
 *  @returns {Promise<string>} 保存後のファイルID */
async function saveNamedData(folderId, fileId, data, fileName) {
  const token = await ensureAccessToken();
  const metadata = fileId
    ? { name: fileName }
    : { name: fileName, parents: [folderId] };

  const boundary = 'lyra-boundary';
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(data)}\r\n` +
    `--${boundary}--`;

  const url = fileId
    ? `${DRIVE_UPLOAD_API}/files/${fileId}?uploadType=multipart`
    : `${DRIVE_UPLOAD_API}/files?uploadType=multipart`;

  const res = await fetch(url, {
    method: fileId ? 'PATCH' : 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) throw new Error(`Drive save error ${res.status}: ${await res.text()}`);
  const saved = await res.json();
  return saved.id;
}

/** ファイル(PDF・画像・音声など)をフォルダにアップロードし、そのファイルIDを返す。
 *  @param {AbortSignal} [signal] 渡すと、進行中のアップロードを外部から中断できる */
async function uploadFile(folderId, blob, filename, signal) {
  const token = await ensureAccessToken();
  const metadata = { name: filename, parents: [folderId] };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);

  const res = await fetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal,
  });
  if (!res.ok) throw new Error(`Drive upload error ${res.status}: ${await res.text()}`);
  const created = await res.json();
  return created.id;
}

/**
 * ファイルを認証付きで取得し、表示用の blob URL を返す。
 * (drive.file のファイルは既定で非公開のため、Authorization ヘッダ付きで取得する)
 */
async function fetchFileBlobUrl(fileId) {
  const res = await driveFetch(`/files/${fileId}?alt=media`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
