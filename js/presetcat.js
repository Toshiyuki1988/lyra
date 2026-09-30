// LYRA — プリセット目録(2026-10-01、ユーザー要望「Serum2 には潤沢なプリセットがあるが、それを一発で取り出せる把握構造が LYRA にない」)。
//
// プラグインのソウル(Serum2)ごとに、PC のプリセットのフォルダ(例: D:\ドキュメント\Xfer\Serum 2 Presets)を1回選ぶと、
// 各ファイルの先頭だけを読んで「名前・カテゴリ(パックとフォルダ)・説明」(とエンジンのタグ)の目録を作る。Gemini は使わない。
//   .SerumPreset: 先頭は「XferJson」+ 0x00 + ヘッダーの長さ(uint32、9バイト目から)+ 4バイト + JSON(17バイト目から)。
//     JSON に presetName・presetAuthor・presetDescription・tags(Wavetable / Poly / Granular など、エンジンと鳴り方の13種類)。
//     本体はその後ろの zstd で圧縮されたデータ(今は読まない)
//   .fxp(Serum1): 名前とフォルダだけ。「._」で始まるファイル(Mac の付属ファイル)は飛ばす
// 目録は大きい(2000件ほど)ので、この端末の IndexedDB(lyra-presets)に置く。Drive のソウルには件数と日時だけ(soul.presetCatalog)。
// 探す: 目録の窓での言葉の絞り込み(Gemini なし)/ 言葉か画像から、合う5つを Gemini 1回で理由つきで選ぶ(目録の番号で答えさせ、実在するものだけ)。
//
// window.LyraPresetCat = { openPanel(soul), searchByImage(imageCard), hasCatalog(soul), …(音色の窓 js/timbre.js も rowHtml・bindCopy・scanFolder・savePicks を使う) }

(function () {
  const DB = 'lyra-presets';
  const MAX_DESC = 80;

  function db() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('catalog');
        req.result.createObjectStore('handles');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function tx(store, mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
    });
  }
  const getCatalog = (soulId) => tx('catalog', 'readonly', (s) => s.get(soulId));
  const putCatalog = (soulId, cat) => tx('catalog', 'readwrite', (s) => s.put(cat, soulId));
  const putHandle = (soulId, h) => tx('handles', 'readwrite', (s) => s.put(h, soulId));
  const getHandle = (soulId) => tx('handles', 'readonly', (s) => s.get(soulId));
  const hasCatalog = (soul) => Boolean(soul && soul.presetCatalog && soul.presetCatalog.count);

  /* ---------------- 読み込み ---------------- */

  async function readHeader(file) {
    const head = new Uint8Array(await file.slice(0, 17).arrayBuffer());
    if (String.fromCharCode(...head.slice(0, 8)) !== 'XferJson') return null;
    const n = new DataView(head.buffer).getUint32(9, true);
    if (!n || n > 200000) return null;
    const text = new TextDecoder('utf-8').decode(await file.slice(17, 17 + n).arrayBuffer());
    return JSON.parse(text);
  }

  /** フォルダを再帰的に読む。path は Presets からの相対(先頭がパック、次がカテゴリ) */
  async function scanDir(dir, path, out, onProgress) {
    for await (const [name, h] of dir.entries()) {
      if (name.startsWith('.') || name.startsWith('._')) continue;
      if (h.kind === 'directory') {
        await scanDir(h, [...path, name], out, onProgress);
        continue;
      }
      const lower = name.toLowerCase();
      const isS2 = lower.endsWith('.serumpreset');
      const isS1 = lower.endsWith('.fxp');
      if (!isS2 && !isS1) continue;
      const entry = { name: name.replace(/\.(serumpreset|fxp)$/i, ''), pack: path[0] || '', category: path.slice(1).join(' / '), description: '', author: '', tags: [], s1: isS1, path: [...path, name].join('/') };
      if (isS2) {
        try {
          const meta = await readHeader(await h.getFile());
          if (meta) {
            entry.name = String(meta.presetName || entry.name);
            entry.description = String(meta.presetDescription || '').replace(/\s+/g, ' ').trim().slice(0, MAX_DESC);
            entry.author = String(meta.presetAuthor || '').slice(0, 40);
            entry.tags = (meta.tags || []).filter((t) => t !== 'Preview').slice(0, 8);
          }
        } catch (err) {
          /* 読めないファイルは名前とフォルダだけ */
        }
      }
      out.push(entry);
      if (out.length % 100 === 0 && onProgress) onProgress(out.length);
    }
  }

  /** フォルダを選んで目録を作る(クリックの中で呼ぶこと。フォルダの選択はユーザー操作が要る) */
  async function scanFolder(soul) {
    if (!window.showDirectoryPicker) {
      setStatus('このブラウザはフォルダの読み込みに対応していません(Chrome / Edge で開いてください)', { important: true });
      return false;
    }
    let dir;
    try {
      dir = await window.showDirectoryPicker({ id: 'lyra-presets', mode: 'read' });
    } catch (err) {
      return false; // やめた
    }
    // 「Serum 2 Presets」を選んだ時は、その中の「Presets」から読む
    try {
      dir = await dir.getDirectoryHandle('Presets');
    } catch (err) {
      /* Presets のフォルダそのものを選んだ */
    }
    const entries = [];
    setStatus('プリセットのフォルダを読んでいます…', { busy: true });
    await scanDir(dir, [], entries, (n) => setStatus(`プリセットのフォルダを読んでいます…(${n}個)`, { busy: true }));
    entries.sort((a, b) => Number(a.s1) - Number(b.s1) || a.pack.localeCompare(b.pack) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    await putCatalog(soul.id, { entries, scannedAt: new Date().toISOString(), root: dir.name });
    await putHandle(soul.id, dir).catch(() => {});
    const s2 = entries.filter((e) => !e.s1).length;
    soul.presetCatalog = { count: entries.length, s2, s1: entries.length - s2, scannedAt: new Date().toISOString(), root: dir.name };
    scheduleAutoSave();
    setStatus(`「${soul.name}」のプリセット目録を作りました(Serum2 ${s2}個・Serum1 ${entries.length - s2}個)`);
    return true;
  }

  /* ---------------- Gemini に選ばせる ---------------- */

  const catLine = (e, i) => `${i}: ${e.s1 ? '[S1] ' : ''}${e.pack}${e.category ? ` / ${e.category}` : ''} | ${e.name}${e.description ? ` | ${e.description}` : ''}${e.tags.length ? ` | ${e.tags.join(',')}` : ''}`;

  async function pick(soul, entries, { text, imageCard }) {
    const prompt = `あなたはシンセサイザー「${soul.name}」のプリセットに詳しい音色の案内役です。
${imageCard ? '添付の画像から受ける印象(色・光・質感・動き・時間の流れ)' : `ユーザーの要望「${text}」`}にいちばん合うプリセットを、下の目録から5つ選んでください。
${imageCard && text ? `ユーザーの注文: ${text}\n` : ''}
目録の各行: 番号: パック / カテゴリ | 名前 | 説明 | エンジンのタグ([S1] は旧版 Serum1 の音色)
${entries.map(catLine).join('\n')}

決まり:
- 名前・カテゴリ・説明から音を想像して選ぶ。名前に花などの語が無くても、音の性格(アタックの速さ・明るさ・広がり・動き)が合うものを選んでよい
- i には目録の番号だけを書く(名前を作らない)。why には、なぜ合うかを40字以内で
- なるべくカテゴリが偏らないように(同じ音の性格でも、パッド・プラック・アルペジオなど弾き方の違うものを混ぜる)`;
    const schema = { type: 'OBJECT', properties: { picks: { type: 'ARRAY', items: { type: 'OBJECT', properties: { i: { type: 'STRING' }, why: { type: 'STRING' } }, required: ['i', 'why'] } } }, required: ['picks'] };
    const files = imageCard ? [await localImageForGemini(imageCard.id)] : undefined;
    setStatus('Geminiにプリセットを選んでもらっています…', { busy: true });
    const raw = await askGeminiJson({ prompt, files, responseSchema: schema, maxOutputTokens: 2048, timeoutMs: 120000, label: 'プリセット選び' });
    const seen = new Set();
    return (raw.picks || []).map((x) => {
      const i = Number(String(x.i || '').replace(/\D/g, ''));
      if (!Number.isInteger(i) || !entries[i] || seen.has(i)) return null; // 目録に無い番号は捨てる
      seen.add(i);
      return { e: entries[i], why: String(x.why || '').slice(0, 80) };
    }).filter(Boolean).slice(0, 5);
  }

  /* ---------------- 画面 ---------------- */

  function rowHtml(e, why) {
    return `<div class="pcat-row"><div class="pcat-main"><b>${escapeHtml(e.name)}</b>` +
      `<span>${e.s1 ? 'Serum1 · ' : ''}${escapeHtml(e.pack)}${e.category ? ` / ${escapeHtml(e.category)}` : ''}${e.author ? ` · ${escapeHtml(e.author)}` : ''}${e.tags.length ? ` · ${escapeHtml(e.tags.join(', '))}` : ''}</span>` +
      (e.description ? `<em>${escapeHtml(e.description)}</em>` : '') +
      (why ? `<i>${escapeHtml(why)}</i>` : '') +
      `</div><button type="button" class="secondary pcat-copy" data-name="${escapeHtml(e.name)}">名前をコピー</button></div>`;
  }

  function bindCopy(root) {
    root.querySelectorAll('.pcat-copy').forEach((btn) => btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.name);
        setStatus(`「${btn.dataset.name}」をコピーしました(Serum2 のプリセットブラウザの検索欄に貼ってください)`);
      } catch (err) {
        setStatus('コピーできませんでした(ブラウザが許可していません)', { important: true });
      }
    }));
  }

  function modal(html) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay visible';
    overlay.innerHTML = `<div class="modal pcat-modal">${html}</div>`;
    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };
    attachBackgroundTapToClose(overlay, close);
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(overlay);
    overlay.addEventListener('keydown', (event) => event.stopPropagation());
    return { overlay, close };
  }

  /* ---------------- 候補リスト(2026-10-01、ユーザー要望「この厳選リストを、プレミックスの MIDI からホストする時か LYRA Host 側で機能させたい」) ----------------
   * Gemini が選んだ5つを、ソウルの「候補リスト」(soul.presetPicks、Drive。新しい順に12件まで)として残す。
   * プレミックスの MIDI のカードの「ホスト」で候補リストを選ぶと、この端末のプリセットのファイルを読み(目録の読み込みで覚えたフォルダのハンドル)、
   * 中身ごと LYRA Host へ送る(open の candidates。ホストが capabilities に "candidates" を載せている時だけ)。ホストの画面で聴き比べる */
  function savePicks(soul, title, picks) {
    if (!soul || !picks.length) return;
    soul.presetPicks = Array.isArray(soul.presetPicks) ? soul.presetPicks : [];
    soul.presetPicks.unshift({
      id: newId(), title: String(title).slice(0, 80), at: new Date().toISOString(),
      items: picks.map((x) => ({ path: x.e.path, name: x.e.name, pack: x.e.pack, category: x.e.category, s1: x.e.s1, why: x.why })),
    });
    soul.presetPicks = soul.presetPicks.slice(0, 12);
    scheduleAutoSave();
  }

  function toBase64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  /**
   * 候補リストのプリセットのファイルを読み、LYRA Host の open の candidates の形にする。
   * ページを開き直した後はフォルダの読み取りの許可が要るので、**クリックの中(か、その直後)で呼ぶこと**
   */
  async function loadCandidates(soul, list) {
    const dir = await getHandle(soul.id).catch(() => null);
    if (!dir) throw new Error('この端末でプリセットのフォルダを読み込んでいません(ソウル画面の「目録」で読み込んでください)');
    if (dir.queryPermission && (await dir.queryPermission({ mode: 'read' })) !== 'granted') {
      if (!dir.requestPermission || (await dir.requestPermission({ mode: 'read' })) !== 'granted') throw new Error('プリセットのフォルダの読み取りが許可されませんでした');
    }
    const out = [];
    for (const it of list.items) {
      const parts = String(it.path || '').split('/').filter(Boolean);
      try {
        let d = dir;
        for (const name of parts.slice(0, -1)) d = await d.getDirectoryHandle(name);
        const file = await (await d.getFileHandle(parts[parts.length - 1])).getFile();
        out.push({ name: it.name, fileName: file.name, kind: it.s1 ? 'fxp' : 'SerumPreset', why: it.why || '', dataBase64: toBase64(await file.arrayBuffer()) });
      } catch (err) {
        console.error(err);
        out.push({ name: it.name, missing: true });
      }
    }
    return out;
  }

  /** 選んだ5つを見せる(候補リストとしてソウルに残す) */
  function showPicks(title, picks, soul) {
    savePicks(soul, title, picks);
    const { overlay, close } = modal(`<h2>${escapeHtml(title)}</h2>` +
      (soul && picks.length ? '<p class="modal-desc">この5つを「候補リスト」として残しました。プレミックスのMIDIのカードの「ホスト」で選ぶと、LYRA Host で聴き比べられます(ホストが対応していれば)。</p>' : '') +
      `<div class="pcat-list">${picks.length ? picks.map((x) => rowHtml(x.e, x.why)).join('') : '<div class="panel-empty">合うものを選べませんでした</div>'}</div>` +
      `<div class="modal-actions"><button type="button" data-close>閉じる</button></div>`);
    overlay.querySelector('[data-close]').addEventListener('click', close);
    bindCopy(overlay);
  }

  /** ソウル画面の「目録」: 読み込み・言葉の絞り込み・Gemini に選ばせる */
  async function openPanel(soul) {
    const cat = await getCatalog(soul.id).catch(() => null);
    const entries = (cat && cat.entries) || [];
    const info = soul.presetCatalog;
    const { overlay, close } = modal(
      `<h2>「${escapeHtml(soul.name)}」のプリセット目録</h2>` +
      `<p class="modal-desc">${entries.length
        ? `Serum2 ${entries.filter((e) => !e.s1).length}個・Serum1 ${entries.filter((e) => e.s1).length}個(${escapeHtml(cat.root || '')}、${new Date(cat.scannedAt).toLocaleDateString()}に読み込み)。名前・カテゴリ・説明で探せます。`
        : info && info.count ? `この端末には目録がありません(別の端末で ${info.count}個 を読み込み済み)。この端末でもフォルダを読み込んでください。`
        : 'プリセットのフォルダ(例: ドキュメント\\Xfer\\Serum 2 Presets)を選ぶと、各ファイルの名前・カテゴリ・説明を読んで目録にします(Geminiは使いません)。'}</p>` +
      `<div class="pcat-tools"><input type="search" class="pcat-q" placeholder="言葉で絞り込む(例: pad、bell、bloom)"${entries.length ? '' : ' disabled'}>` +
      `<button type="button" class="secondary" data-scan>${entries.length ? '読み直す' : 'フォルダを読み込む'}</button></div>` +
      (entries.length ? `<div class="pcat-tools"><input type="text" class="pcat-ask" placeholder="Geminiに探してもらう(例: 花が開くようなきらめく音)"><button type="button" data-ask>選んでもらう</button></div>` : '') +
      `<div class="pcat-list"></div>` +
      `<div class="modal-actions"><button type="button" class="secondary" data-close>閉じる</button></div>`);
    overlay.querySelector('[data-close]').addEventListener('click', close);
    overlay.querySelector('[data-scan]').addEventListener('click', async () => {
      const ok = await scanFolder(soul);
      if (ok) {
        close();
        openPanel(soul);
      }
    });
    const list = overlay.querySelector('.pcat-list');
    const render = (q) => {
      const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
      const hits = words.length ? entries.filter((e) => words.every((w) => `${e.name} ${e.pack} ${e.category} ${e.description} ${e.tags.join(' ')}`.toLowerCase().includes(w))) : [];
      list.innerHTML = words.length ? (hits.length ? hits.slice(0, 80).map((e) => rowHtml(e)).join('') + (hits.length > 80 ? `<div class="panel-empty">ほか${hits.length - 80}個</div>` : '') : '<div class="panel-empty">見つかりません</div>') : '';
      bindCopy(list);
    };
    const q = overlay.querySelector('.pcat-q');
    if (q) q.addEventListener('input', () => render(q.value));
    const askBtn = overlay.querySelector('[data-ask]');
    if (askBtn) askBtn.addEventListener('click', async () => {
      const text = overlay.querySelector('.pcat-ask').value.trim();
      if (!text) return;
      try {
        const picks = await pick(soul, entries, { text });
        close();
        showPicks(`「${text}」に合う ${soul.name} のプリセット`, picks, soul);
        setStatus(`${picks.length}個のプリセットを選びました`);
      } catch (err) {
        console.error(err);
        setStatus(`選べませんでした: ${err.message}`, { important: true });
      }
    });
  }

  /** プレミックスの画像カードの「プリセット」: 画像に合う5つを Gemini 1回で選ぶ */
  async function searchByImage(imageCard) {
    const souls = (state.souls || []).filter((x) => x.category === 'plugin' && hasCatalog(x));
    if (!souls.length) {
      setStatus('プリセット目録のあるソウルがありません(プラグインのソウル画面の「目録」で、プリセットのフォルダを読み込んでください)', { important: true });
      return;
    }
    const values = await showFormDialog({
      title: 'この画像に合うプリセットを探す',
      message: 'プリセット目録(名前・カテゴリ・説明)と画像をGeminiに渡して、合うものを5つ選んでもらいます(Geminiを1回)。',
      submitLabel: '探す',
      fields: [
        { name: 'soul', label: '音源(ソウル)', type: 'select', value: souls[0].id, options: souls.map((x) => ({ value: x.id, label: `${x.name}(${x.presetCatalog.count}個)` })) },
        { name: 'hint', label: '注文(任意)', type: 'text', placeholder: '例: パッドで/短く鳴る音で' },
      ],
    });
    if (!values) return;
    const soul = souls.find((x) => x.id === values.soul);
    try {
      const cat = await getCatalog(soul.id);
      if (!cat || !cat.entries.length) throw new Error('この端末には目録がありません。ソウル画面の「目録」でフォルダを読み込んでください');
      const picks = await pick(soul, cat.entries, { imageCard, text: values.hint });
      showPicks(`この画像${values.hint ? `(${values.hint})` : ''}に合う ${soul.name} のプリセット`, picks, soul);
      setStatus(`${picks.length}個のプリセットを選びました`);
    } catch (err) {
      console.error(err);
      setStatus(`探せませんでした: ${err.message}`, { important: true });
    }
  }

  window.LyraPresetCat = { openPanel, searchByImage, hasCatalog, loadCandidates, scanFolder, savePicks, rowHtml, bindCopy, _test: { readHeader, scanDir, pick, getCatalog, putCatalog } };
})();
