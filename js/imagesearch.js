// LYRA — 画像カードの画像検索(Pixabay API、2026-09-26)
//
// ユーザー要望「いちいちPCに保存もせず、画像検索システムをアプリ内に」「どんどん試しては入れ替え、を繰り返すことに特化」。
// 商用利用可・クレジット表記不要のPixabayを使う(ユーザー判断)。APIキーは設定画面で入れ、このブラウザの
// localStorage(lyra.pixabayApiKey)にだけ置く。
//
// - キャンバスを隠さない浮いたパネル。開いたまま次々にサムネイルをクリックすると、同じ画像カードの画像が
//   その場で入れ替わっていく(最初のクリックでカードが無ければ置き、以後はそのカードを入れ替える)。
//   何をするか(置く・入れ替える)は呼び出し側の onPick が決める
// - 選んだ画像は webformatURL(長辺640px)を取り込み、呼び出し側で長辺512pxにして端末内に置く。Pixabayの規約
//   (画像を相手のサーバーから直接表示し続けない)に合うよう、カードはPixabayのURLを表示に使わない
// - 規約: 検索結果を出す時は出どころ(Pixabay)を示す / 同じ検索は24時間キャッシュする(localStorage に直近10件)
// - PixabayのAPIも画像のCDNも Access-Control-Allow-Origin: * を返す(2026-09-26にcurlで確認)
//
// window.LyraImageSearch = { open({ targetLabel, onPick(file, meta), onPickFile() }), setTarget(label), close(), isOpen() }

(function () {
  const API = 'https://pixabay.com/api/';
  const PER_PAGE = 30;
  const CACHE_KEY = 'lyra.pixabayCache';
  const LAST_KEY = 'lyra.imageSearchLast';
  const CACHE_MS = 24 * 60 * 60 * 1000;
  const CACHE_MAX = 10;

  let panel = null;
  let opts = null;
  let query = { q: '', type: 'photo' };
  let page = 1;
  let totalHits = 0;
  let busy = false;

  /* ---------------- キャッシュ(24時間) ---------------- */

  function readCache() {
    try {
      const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      const now = Date.now();
      Object.keys(all).forEach((k) => { if (!all[k] || now - all[k].at > CACHE_MS) delete all[k]; });
      return all;
    } catch (err) {
      return {};
    }
  }

  function writeCache(key, data) {
    try {
      const all = readCache();
      all[key] = { at: Date.now(), data };
      const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at);
      keys.slice(CACHE_MAX).forEach((k) => delete all[k]);
      localStorage.setItem(CACHE_KEY, JSON.stringify(all));
    } catch (err) {
      // 容量いっぱいなどは諦める(キャッシュは無くても動く)
    }
  }

  async function search(q, type, pageNo) {
    const params = new URLSearchParams({
      q: q.slice(0, 100),
      lang: 'ja',
      image_type: type,
      safesearch: 'true',
      per_page: String(PER_PAGE),
      page: String(pageNo),
    });
    const cacheKey = params.toString();
    const cached = readCache()[cacheKey];
    if (cached) return cached.data;
    params.set('key', CONFIG.PIXABAY_API_KEY);
    const res = await fetch(`${API}?${params}`);
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 429) throw new Error('Pixabayの利用上限(1分あたり)に達しました。少し待ってから検索してください');
      if (/key/i.test(text)) throw new Error('PixabayのAPIキーが正しくないようです(設定で確認してください)');
      throw new Error(`Pixabayの検索に失敗しました(${res.status}: ${text.slice(0, 120)})`);
    }
    const json = await res.json();
    const data = {
      totalHits: json.totalHits || 0,
      hits: (json.hits || []).map((h) => ({
        id: h.id,
        pageURL: h.pageURL,
        tags: h.tags || '',
        user: h.user || '',
        previewURL: h.previewURL,
        previewWidth: h.previewWidth,
        previewHeight: h.previewHeight,
        webformatURL: h.webformatURL,
      })),
    };
    writeCache(cacheKey, data);
    return data;
  }

  /* ---------------- パネル ---------------- */

  function open(options) {
    opts = options || {};
    if (!panel) build();
    panel.hidden = false;
    setTarget(opts.targetLabel || '');
    renderKeyNote();
    const input = panel.querySelector('.imgsearch-q');
    input.focus();
    input.select();
  }

  function close() {
    if (panel) panel.hidden = true;
    opts = null;
  }

  function isOpen() {
    return Boolean(panel && !panel.hidden);
  }

  function setTarget(label) {
    if (!panel) return;
    panel.querySelector('.imgsearch-target').textContent = label
      ? `クリックで「${label}」の画像を入れ替えます`
      : 'クリックで新しい画像カードを置きます(続けてクリックすると、そのカードを入れ替えます)';
  }

  function renderKeyNote() {
    const note = panel.querySelector('.imgsearch-keynote');
    note.hidden = Boolean(CONFIG.PIXABAY_API_KEY);
  }

  function build() {
    try {
      const last = JSON.parse(localStorage.getItem(LAST_KEY) || 'null');
      if (last && typeof last.q === 'string') query = { q: last.q, type: last.type || 'photo' };
    } catch (err) { /* 無ければ既定 */ }
    panel = document.createElement('div');
    panel.className = 'imgsearch';
    panel.hidden = true;
    panel.innerHTML =
      `<div class="imgsearch-head"><span class="imgsearch-title">画像を探す</span>` +
      `<button type="button" class="panel-close imgsearch-close" aria-label="閉じる">×</button></div>` +
      `<form class="imgsearch-form">` +
      `<input type="search" class="imgsearch-q" placeholder="夕暮れ 海、neon city など" value="${escapeHtml(query.q)}" autocomplete="off">` +
      `<select class="imgsearch-type">` +
      [['photo', '写真'], ['illustration', 'イラスト'], ['vector', 'ベクター'], ['all', 'すべて']]
        .map(([v, l]) => `<option value="${v}"${v === query.type ? ' selected' : ''}>${l}</option>`).join('') +
      `</select><button type="submit" class="btn-small">検索</button></form>` +
      `<div class="imgsearch-keynote" hidden>PixabayのAPIキーが未設定です。<button type="button" class="btn-small imgsearch-settings">設定を開く</button></div>` +
      `<div class="imgsearch-target"></div>` +
      `<div class="imgsearch-grid"></div>` +
      `<div class="imgsearch-more-row"><button type="button" class="btn-small imgsearch-more" hidden>もっと見る</button></div>` +
      `<div class="imgsearch-foot">` +
      `<button type="button" class="btn-small imgsearch-file">PCのファイルから</button>` +
      `<a class="imgsearch-credit" href="https://pixabay.com/" target="_blank" rel="noopener">画像: Pixabay</a></div>`;
    document.body.appendChild(panel);

    panel.querySelector('.imgsearch-close').addEventListener('click', close);
    panel.querySelector('.imgsearch-settings').addEventListener('click', () => {
      if (typeof openSettings === 'function') openSettings();
    });
    panel.querySelector('.imgsearch-form').addEventListener('submit', (event) => {
      event.preventDefault();
      query = { q: panel.querySelector('.imgsearch-q').value.trim(), type: panel.querySelector('.imgsearch-type').value };
      try { localStorage.setItem(LAST_KEY, JSON.stringify(query)); } catch (err) { /* 保存できなくても検索はできる */ }
      runSearch(true);
    });
    panel.querySelector('.imgsearch-more').addEventListener('click', () => runSearch(false));
    panel.querySelector('.imgsearch-file').addEventListener('click', () => {
      if (opts && opts.onPickFile) opts.onPickFile();
    });
    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close();
      event.stopPropagation(); // キャンバス側のキー操作(Shift+A、編集ガイドのDeleteなど)に届かないように
    });
    panel.addEventListener('paste', (event) => event.stopPropagation());
  }

  async function runSearch(fresh) {
    if (busy) return;
    if (!CONFIG.PIXABAY_API_KEY) {
      renderKeyNote();
      return;
    }
    if (!query.q) return;
    const grid = panel.querySelector('.imgsearch-grid');
    const more = panel.querySelector('.imgsearch-more');
    if (fresh) {
      page = 1;
      grid.innerHTML = '';
      grid.scrollTop = 0;
    }
    busy = true;
    more.hidden = true;
    const loading = document.createElement('div');
    loading.className = 'imgsearch-msg';
    loading.textContent = '探しています…';
    grid.appendChild(loading);
    try {
      const data = await search(query.q, query.type, page);
      loading.remove();
      totalHits = data.totalHits;
      if (fresh && !data.hits.length) {
        grid.innerHTML = `<div class="imgsearch-msg">見つかりませんでした。別の言葉(英語も)で試してください</div>`;
        return;
      }
      data.hits.forEach((hit) => grid.appendChild(thumb(hit)));
      page += 1;
      more.hidden = (page - 1) * PER_PAGE >= Math.min(totalHits, 500);
    } catch (err) {
      console.error(err);
      loading.textContent = err.message;
    } finally {
      busy = false;
    }
  }

  function thumb(hit) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'imgsearch-thumb';
    btn.title = hit.tags;
    btn.innerHTML = `<img src="${escapeHtml(hit.previewURL)}" alt="${escapeHtml(hit.tags)}" draggable="false" loading="lazy">`;
    btn.addEventListener('click', () => pick(hit, btn));
    return btn;
  }

  async function pick(hit, btn) {
    if (!opts || !opts.onPick || btn.classList.contains('imgsearch-thumb--loading')) return;
    btn.classList.add('imgsearch-thumb--loading');
    try {
      const res = await fetch(hit.webformatURL);
      if (!res.ok) throw new Error(`画像を取得できませんでした(${res.status})`);
      const blob = await res.blob();
      const name = hit.tags.split(',')[0].trim() || `pixabay_${hit.id}`;
      const file = new File([blob], `${name}.jpg`, { type: blob.type || 'image/jpeg' });
      await opts.onPick(file, { site: 'Pixabay', id: hit.id, pageURL: hit.pageURL, user: hit.user, tags: hit.tags.slice(0, 80), name });
      panel.querySelectorAll('.imgsearch-thumb--picked').forEach((el) => el.classList.remove('imgsearch-thumb--picked'));
      btn.classList.add('imgsearch-thumb--picked');
    } catch (err) {
      console.error(err);
      setStatus(err.message, { important: true });
    } finally {
      btn.classList.remove('imgsearch-thumb--loading');
    }
  }

  window.LyraImageSearch = { open, close, isOpen, setTarget };
})();
