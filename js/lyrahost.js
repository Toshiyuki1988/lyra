// LYRA — LYRA Host(1トラックのVSTホスト、別リポジトリ Toshiyuki1988/lyra-host)との連携(2026-10-01)。
// 形は lyra-host の PROTOCOL.md(版 1)。LYRA 側はこのファイルが接続を受け持つ:
//   1. クリックの中で lyrahost://open?session=S&port=P を開く(ホストが起動する/前面に出る)
//   2. ws://127.0.0.1:P/ へ 0.5 秒おきに 20 秒ほど接続を試し直す → hello(同じセッション)→ welcome
//   3. request(): "id" を付けて送り、同じ "id" の返事で解決する(error なら失敗)
//   4. ホストの「LYRA へ送る」: テキストの result の**すぐ次のバイナリが WAV**。受け取ったら onResult の処理に渡し、ack を返す
// 受け取った音(WAV)はこの端末の IndexedDB(lyra-hostaudio、キーはカードの ID)に置く。Drive には上げない
// (大きく、Drive のファイルは消さない決まりのため、送り返すたびに増え続けてしまう)。
//
// 実機で最初に関門になること(PROTOCOL.md 7 節): Chrome の「ローカル ネットワークへのアクセス」の許可(初回に「許可」)/
// lyrahost:// の登録(ホストの「ファイル → LYRA 連携 → lyrahost:// を Windows に登録する」)。
//
// window.LyraHost = { launchAndConnect(), request(msg), isConnected(), capabilities(), onResult(fn), putAudio, getAudio, deleteAudio }

(function () {
  const PORT = 47650;
  const PROTOCOL_V = 1;
  const RETRY_MS = 500;
  const CONNECT_SECONDS = 20;
  const REQUEST_TIMEOUT_MS = 30000;
  const session = (crypto.randomUUID ? crypto.randomUUID() : `s${Date.now()}${Math.random().toString(36).slice(2)}`).replace(/[^\w.-]/g, '');

  let ws = null;
  let welcome = null;
  let connecting = null; // 接続中の Promise(同時に何度も押されても1本にまとめる)
  let seq = 0;
  const pending = new Map(); // id → { resolve, reject, timer }
  let resultWaiting = null; // result のテキストを受け取って、次のバイナリ(WAV)を待っている
  let resultHandler = null;

  const isConnected = () => Boolean(ws && ws.readyState === WebSocket.OPEN && welcome);

  /**
   * ホストを起動して(または前面に出して)つなぐ。**クリックなどのユーザー操作の中で、await より前に呼ぶこと**
   * (lyrahost:// を開くのはユーザー操作の中でないとブラウザに止められることがある)。つながっていれば起動し直さない
   */
  function launchAndConnect() {
    if (isConnected()) return Promise.resolve(welcome);
    if (connecting) return connecting;
    try {
      location.href = `lyrahost://open?session=${encodeURIComponent(session)}&port=${PORT}`;
    } catch (err) {
      console.error(err);
    }
    connecting = connectWithRetry().finally(() => {
      connecting = null;
    });
    return connecting;
  }

  async function connectWithRetry() {
    const until = Date.now() + CONNECT_SECONDS * 1000;
    let lastError = null;
    setStatus('LYRA Host につないでいます…(初めての時は、ブラウザの許可の画面が出たら「許可」を押してください)', { busy: true });
    while (Date.now() < until) {
      try {
        const w = await tryConnect();
        setStatus(`LYRA Host(${w.hostVersion || ''})につながりました`);
        return w;
      } catch (err) {
        lastError = err;
        if (err && err.fatal) break; // セッションを知らないなど、試し直しても変わらない
        await new Promise((r) => setTimeout(r, RETRY_MS));
      }
    }
    const msg = lastError && lastError.fatal ? lastError.message
      : 'LYRA Host につながりませんでした。ホストが起動しない時は、ホストの「ファイル → LYRA 連携 → lyrahost:// を Windows に登録する」を押してください。' +
        '起動しているのにつながらない時は、アドレスバーの鍵のマーク → サイトの設定で「ローカル ネットワーク」(または「デバイス上のアプリ」)を「許可」にしてください';
    if (typeof debugLog === 'function') debugLog(`LYRA Host: 接続できず(${lastError ? lastError.message : '不明'})`);
    throw new Error(msg);
  }

  /** 1回だけ接続を試す。welcome まで行けば解決 */
  function tryConnect() {
    return new Promise((resolve, reject) => {
      let settled = false;
      let sock;
      try {
        sock = new WebSocket(`ws://127.0.0.1:${PORT}/`);
      } catch (err) {
        reject(err);
        return;
      }
      sock.binaryType = 'arraybuffer';
      const fail = (err) => {
        if (settled) return;
        settled = true;
        try {
          sock.close();
        } catch (e) {
          /* 閉じている */
        }
        reject(err);
      };
      const timer = setTimeout(() => fail(new Error('返事がありません')), 4000);
      sock.onerror = () => fail(new Error('接続できません'));
      sock.onclose = () => {
        if (!settled) fail(new Error('切断されました'));
        if (ws === sock) {
          ws = null;
          welcome = null;
          rejectAll(new Error('LYRA Host との接続が切れました'));
        }
      };
      sock.onopen = () => {
        sock.send(JSON.stringify({ type: 'hello', v: PROTOCOL_V, id: 'hello', session, app: 'lyra', appVersion: 'web' }));
      };
      sock.onmessage = (event) => {
        if (!settled) {
          let msg = null;
          try {
            msg = JSON.parse(event.data);
          } catch (e) {
            return;
          }
          if (msg.type === 'welcome') {
            settled = true;
            clearTimeout(timer);
            ws = sock;
            welcome = msg;
            sock.onmessage = onMessage;
            resolve(msg);
          } else if (msg.type === 'error') {
            clearTimeout(timer);
            const err = new Error(msg.code === 'unknown_session'
              ? 'LYRA Host が、このページのセッションを知りませんでした。もう一度「ホスト」を押してください'
              : msg.message || msg.code);
            err.fatal = msg.code === 'unknown_session' || msg.code === 'unsupported_version';
            fail(err);
          }
        }
      };
    });
  }

  function rejectAll(err) {
    pending.forEach((p) => {
      clearTimeout(p.timer);
      p.reject(err);
    });
    pending.clear();
    resultWaiting = null;
  }

  function onMessage(event) {
    // バイナリ = 直前の result の WAV
    if (typeof event.data !== 'string') {
      const r = resultWaiting;
      resultWaiting = null;
      if (!r) return;
      deliverResult(r, event.data);
      return;
    }
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (err) {
      return;
    }
    if (msg.type === 'result') {
      resultWaiting = msg;
      if (!msg.wav || !msg.wav.bytes) {
        resultWaiting = null;
        deliverResult(msg, null);
      }
      return;
    }
    const p = msg.id != null && pending.get(String(msg.id));
    if (!p) return;
    pending.delete(String(msg.id));
    clearTimeout(p.timer);
    if (msg.type === 'error') {
      const err = new Error(msg.message || msg.code || 'LYRA Host のエラー');
      err.code = msg.code;
      p.reject(err);
    } else p.resolve(msg);
  }

  async function deliverResult(result, wav) {
    try {
      if (resultHandler) await resultHandler(result, wav);
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ack', v: PROTOCOL_V, cardId: result.cardId }));
    } catch (err) {
      console.error(err);
      setStatus(`LYRA Host から届いた音を受け取れませんでした: ${err.message}`, { important: true });
    }
  }

  /** 問いを送り、同じ id の返事を待つ(open は音源の読み込みで数秒かかることがある) */
  function request(msg, timeoutMs) {
    if (!isConnected()) return Promise.reject(new Error('LYRA Host につながっていません'));
    const id = `r${++seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('LYRA Host から返事がありません'));
      }, timeoutMs || REQUEST_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ ...msg, v: PROTOCOL_V, id }));
    });
  }

  /**
   * LYRA Host を、LYRA のブラウザの窓の上に浮かぶ小窓として出す(2026-10-01、ユーザー要望「別ウィンドウとのやり取りを抑えたい。埋め込みではなく、
   * ウィンドウの操作の工夫で」)。ホストが capabilities に "window" を載せている時だけ。位置はブラウザの窓の画面上の位置(CSS の px と拡大率)を渡し、
   * ホストが覚えた位置があればホストがそちらを優先する。失敗しても開く流れは止めない
   */
  async function floatWindow(place) {
    if (!isConnected() || !(welcome.capabilities || []).includes('window')) return null;
    try {
      return await request({
        type: 'window', action: 'float', place: place || 'bottom-right',
        anchor: { screenX: window.screenX, screenY: window.screenY, width: window.outerWidth, height: window.outerHeight, devicePixelRatio: window.devicePixelRatio || 1 },
      }, 8000);
    } catch (err) {
      if (typeof debugLog === 'function') debugLog(`LYRA Host の小窓: ${err.message}`);
      return null;
    }
  }

  /* ---------- 受け取った音の置き場(この端末の IndexedDB) ---------- */
  const DB = 'lyra-hostaudio';
  const STORE = 'wav';
  function db() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function tx(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
    });
  }
  const putAudio = (key, arrayBuffer) => tx('readwrite', (s) => s.put(new Blob([arrayBuffer], { type: 'audio/wav' }), key));
  const getAudio = async (key) => {
    const blob = await tx('readonly', (s) => s.get(key));
    return blob ? blob.arrayBuffer() : null;
  };
  const deleteAudio = (key) => tx('readwrite', (s) => s.delete(key));

  window.LyraHost = {
    launchAndConnect,
    request,
    floatWindow,
    isConnected,
    capabilities: () => (welcome && welcome.capabilities) || [],
    onResult: (fn) => { resultHandler = fn; },
    putAudio,
    getAudio,
    deleteAudio,
    _test: { session, onMessage: (data) => onMessage({ data }) },
  };
})();
