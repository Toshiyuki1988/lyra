// LYRA — MIDIの編集画面(canvasのピアノロール)。
//
// 2026-09-26に作り直した(ユーザー要望「MIDIエディター含めてMIDI生成周りを最も効率が良い形に0から作り直して」)。
// 以前のSVG版は、押すたびに全部の音を描き直し、画面の幅に全体を押し込んでいたため、長い曲では音が潰れ、1音ずつしか
// 動かせなかった。canvasにして、次のことをできるようにした:
//   - 時間・音域のズームとスクロール(ホイール=上下、Shift+ホイール=左右、Ctrl+ホイール=時間のズーム、Alt+ホイール=音域のズーム。
//     鍵盤を上下にドラッグ=スクロール・押すと試し弾き、ルーラーを左右にドラッグ=スクロール・押すと再生位置)
//   - 道具: 選択(V)=空いた所のドラッグで囲んで選ぶ・ダブルクリックで音を足す / 描く(B)=空いた所を押して音を足しドラッグで長さ /
//     範囲(R)=書き出す範囲を囲む(Shiftで小節単位)。選んだ音はまとめて移動・長さ変更、Alt+ドラッグで複製、ダブルクリック/Deleteで削除
//   - 下のベロシティ欄をドラッグで強弱を描く(選んだ音があればその音だけ)
//   - 変形: 半音・オクターブ・反行・逆行・拡大・縮小・クオンタイズ・レガート・ヒューマナイズ・強弱・複製(Ctrl+D)
//   - コピー&ペースト(Ctrl+C / Ctrl+V は再生位置へ)、元に戻す(Ctrl+Z)/やり直す(Ctrl+Y)
//   - パートの表示の切り替え(隠したパートは編集も試聴もしない。Ctrl+クリックでそのパートだけ)
//   - 再生位置の表示と追従(Space で再生/停止)、テンポ・試聴の音量・音色、スケールでリスケール(js/scales.js)
// 保存はそのカードに上書きし midi.edited を立てる。設計図の line の層(Geminiが書いた旋律)は、直した音に書き戻す
// (作り直しは設計図でやり取りするため)。テンポは midi.tempo と設計図の tempo に書き戻す(.mid のテンポも変わる)。

(function () {
  const M = (window.LyraMidi = window.LyraMidi || {});
  const T = window.LyraTheory;
  const { EPS } = T;

  const KEYS_W = 46;
  const RULER_H = 22;
  const VEL_H = 60;
  const VEL_GAP = 6;
  const SNAPS = [
    { value: '1', label: '1拍' }, { value: '0.5', label: '8分' }, { value: '0.25', label: '16分' }, { value: '0.125', label: '32分' },
    { value: '0.3333333', label: '8分3連' }, { value: '0.1666667', label: '16分3連' }, { value: '0', label: 'なし' },
  ];
  const BLACK = [1, 3, 6, 8, 10];

  function openMidiEditor(card, opts = {}) {
    const S = window.LyraScales;
    const m = card.midi;
    const parts = M.partsOf(m).length ? M.partsOf(m) : [''];
    let notes = m.notes.map((n) => ({ ...n }));
    const hidden = new Set();
    let selected = new Set();
    let tool = opts.mode === 'range' ? 'range' : 'select';
    let sel = card.selection ? { ...card.selection } : null;
    let tempo = m.tempo;
    let cursor = 0; // 再生を始める位置(拍)
    let dirty = false;
    let clipboard = null;
    let rescaled = null;
    const undoStack = [];
    const redoStack = [];

    // 曲の長さ(後ろに2小節の余白を足して、終わりの先にも音を置けるように)
    const used = T.barList(m, Math.max(T.endBeat(notes), 4));
    const last = used[used.length - 1];
    const beats = last.start + last.len * 3;
    const allBars = T.barList(m, beats - EPS);

    /* ---------------- 画面 ---------------- */
    const guess = (() => {
      const d = m.design;
      const sc = d && d.pitch && d.pitch.scale && window.LyraEngine.scaleOf(d.pitch.scale);
      if (sc && d.pitch.system !== 'row') return { root: d.pitch.root, id: sc.id, from: '設計図から' };
      if (m.sketch) {
        const key = T.parseChord(String(m.sketch.key || '').split('|')[0]);
        const named = S.findByName(m.sketch.scale);
        if (key && named) return { root: key.root, id: named.id, from: '設計図から' };
      }
      return { ...S.estimate(m.notes), from: '音から推定' };
    })();
    const rootOptions = (v) => S.NOTE_NAMES.map((name, i) => `<option value="${i}"${i === v ? ' selected' : ''}>${name}</option>`).join('');
    const scaleOptions = (v, withAsk) => {
      const groups = {};
      S.all().forEach((x) => { (groups[x.group] = groups[x.group] || []).push(x); });
      return Object.entries(groups).map(([g, list]) => `<optgroup label="${escapeHtml(g)}">` +
        list.map((x) => `<option value="${escapeHtml(x.id)}"${x.id === v ? ' selected' : ''}>${escapeHtml(x.label)}</option>`).join('') + `</optgroup>`).join('') +
        (withAsk ? `<option value="__ask">一覧に無いスケールをGeminiにたずねる…</option>` : '');
    };
    const btn = (op, label, title) => `<button type="button" class="me-btn" data-op="${op}" title="${escapeHtml(title || label)}">${escapeHtml(label)}</button>`;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay visible';
    overlay.innerHTML =
      `<div class="modal midi-editor"><div class="me-head"><h2>MIDIを編集 · ${escapeHtml(card.name)}</h2><span class="me-info" data-info></span></div>` +
      `<div class="me-bar">` +
      `<div class="me-seg" data-tools>${[['select', '選択', 'V'], ['draw', '描く', 'B'], ['range', '書き出す範囲', 'R']].map(([id, label, key]) => `<button type="button" data-tool="${id}" title="${label}(${key})">${label}</button>`).join('')}</div>` +
      `<label class="me-field">グリッド<select data-snap>${SNAPS.map((s) => `<option value="${s.value}"${s.value === '0.25' ? ' selected' : ''}>${s.label}</option>`).join('')}</select></label>` +
      (parts.length > 1 ? `<label class="me-field">足す音のパート<select data-part>${parts.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(M.partLabel(m, p))}</option>`).join('')}</select></label>` : '') +
      `<label class="me-field">音色<select data-voice>${M.VOICES.map((v) => `<option value="${v.id}"${v.id === M.voiceOf(card).id ? ' selected' : ''}>${escapeHtml(v.label)}</option>`).join('')}</select></label>` +
      `<label class="me-field">テンポ<input type="number" data-tempo min="20" max="300" step="1" value="${Math.round(m.tempo)}"></label>` +
      `<label class="me-field">音量<input type="range" data-volume min="0" max="100" step="1" value="${M.previewVolume()}"></label>` +
      `</div>` +
      (parts.length > 1 ? `<div class="me-parts" data-parts>${parts.map((p) => `<button type="button" class="me-part" data-part-toggle="${escapeHtml(p)}" title="クリックで表示の切り替え、Ctrl+クリックでこのパートだけ"><i style="background:${M.partColor(m, p)}"></i>${escapeHtml(M.partLabel(m, p))}</button>`).join('')}</div>` : '') +
      `<div class="me-bar me-ops"><span class="me-bar-label">変形</span>` +
      btn('up', '半音↑', '半音上げる(↑)') + btn('down', '半音↓', '半音下げる(↓)') + btn('octUp', 'オクターブ↑', 'Shift+↑') + btn('octDown', 'オクターブ↓', 'Shift+↓') +
      btn('invert', '反行', '選んだ音の上下を反転') + btn('retro', '逆行', '選んだ音の時間を逆に') + btn('aug', '拡大×2', '音価と間隔を2倍') + btn('dim', '縮小÷2', '音価と間隔を半分') +
      btn('quantize', 'クオンタイズ', 'グリッドにそろえる(Q)') + btn('legato', 'レガート', '次の音までつなげる') + btn('humanize', 'ゆらす', 'タイミングと強弱をわずかに揺らす') +
      btn('louder', '強く', '強弱+10') + btn('softer', '弱く', '強弱-10') + btn('dup', '複製', 'すぐ後ろに複製(Ctrl+D)') + btn('delete', '削除', 'Delete') +
      btn('undo', '元に戻す', 'Ctrl+Z') + btn('redo', 'やり直す', 'Ctrl+Y') + `</div>` +
      `<div class="me-bar me-scale"><span class="me-bar-label">スケール</span>` +
      `<label class="me-field">方法<select data-sc-method><option value="snap">近い音にそろえる</option><option value="degree">度数を保って移す</option></select></label>` +
      `<label class="me-field" data-sc-src-wrap>元<select data-sc-src-root>${rootOptions(guess.root)}</select><select data-sc-src-id class="me-scale-select">${scaleOptions(guess.id, false)}</select><small data-sc-from>${guess.from}</small></label>` +
      `<label class="me-field">新しい<select data-sc-root>${rootOptions(guess.root)}</select><select data-sc-id class="me-scale-select">${scaleOptions(guess.id, true)}</select></label>` +
      `<button type="button" class="me-btn" data-sc-preview>▶ 音階を聴く</button>` +
      `<label class="me-check"><input type="checkbox" data-sc-autoplay checked>選んだら鳴らす</label>` +
      `<button type="button" class="me-btn me-btn--accent" data-sc-apply title="選んだ音があればその音だけ、無ければ表示中のパート">リスケール</button></div>` +
      `<div class="me-stage" data-stage><canvas class="me-canvas"></canvas></div>` +
      `<div class="me-foot"><input type="range" class="me-hscroll" data-hscroll min="0" max="1000" value="0">` +
      `<span class="me-zoom">時間${btn('zoomOut', '−', '時間を縮める(Ctrl+ホイール)')}${btn('zoomIn', '+', '時間を広げる')} 音域${btn('rowOut', '−', '音域を縮める(Alt+ホイール)')}${btn('rowIn', '+', '音域を広げる')}${btn('fit', '全体', '全体を表示')}</span></div>` +
      `<p class="modal-desc me-help" data-help></p>` +
      `<div class="modal-actions"><button type="button" class="secondary" data-act="play">▶ 試聴</button>` +
      `<button type="button" class="secondary" data-act="all">範囲を全体に</button>` +
      `<button type="button" class="secondary" data-act="cancel">やめる</button>` +
      `<button type="button" data-act="ok">保存</button></div></div>`;
    document.body.appendChild(overlay);

    const $ = (q) => overlay.querySelector(q);
    const canvas = $('.me-canvas');
    const stageEl = $('[data-stage]');
    const g = canvas.getContext('2d');
    const info = $('[data-info]');
    const help = $('[data-help]');
    const playBtn = $('[data-act="play"]');
    const snapEl = $('[data-snap]');
    const partEl = $('[data-part]');
    const hscroll = $('[data-hscroll]');

    /* ---------------- 表示の座標 ---------------- */
    let W = 800;
    let H = 420;
    let pxPerBeat = 40;
    let rowH = 12;
    let scrollX = 0; // 左端の拍
    let topPitch = 84; // 一番上の行の音
    const gridTop = RULER_H;
    const gridBottom = () => H - VEL_H - VEL_GAP;
    const gridW = () => W - KEYS_W;
    const visibleRows = () => Math.floor((gridBottom() - gridTop) / rowH);
    const xOf = (beat) => KEYS_W + (beat - scrollX) * pxPerBeat;
    const yOf = (pitch) => gridTop + (topPitch - pitch) * rowH;
    const beatAt = (x) => scrollX + (x - KEYS_W) / pxPerBeat;
    const pitchAt = (y) => topPitch - Math.floor((y - gridTop) / rowH);
    const snap = () => Number(snapEl.value) || 0;
    const q = () => snap() || 1 / 48;
    const snapBeat = (b) => (snap() ? Math.round(b / snap() + EPS) * snap() : Math.round(b * 48) / 48);
    const floorBeat = (b) => (snap() ? Math.floor(b / snap() + EPS) * snap() : Math.round(b * 48) / 48);
    const visible = (n) => !hidden.has(n.part || '');

    function clampView() {
      pxPerBeat = Math.max(6, Math.min(400, pxPerBeat));
      rowH = Math.max(5, Math.min(28, rowH));
      scrollX = Math.max(0, Math.min(Math.max(0, beats - gridW() / pxPerBeat), scrollX));
      topPitch = Math.max(Math.min(127, visibleRows() - 1), Math.min(127, topPitch));
      hscroll.max = String(Math.max(0, Math.round((beats - gridW() / pxPerBeat) * 100)));
      hscroll.value = String(Math.round(scrollX * 100));
    }

    function fitAll() {
      pxPerBeat = gridW() / Math.max(4, T.endBeat(notes) + 1 || beats);
      let lo = 127;
      let hi = 0;
      notes.forEach((n) => { lo = Math.min(lo, n.pitch); hi = Math.max(hi, n.pitch); });
      if (!notes.length) { lo = 55; hi = 72; }
      rowH = Math.max(5, Math.min(18, (gridBottom() - gridTop) / Math.max(24, hi - lo + 7)));
      topPitch = Math.min(127, hi + Math.max(3, Math.floor((visibleRows() - (hi - lo + 1)) / 2)));
      scrollX = 0;
      clampView();
    }

    function resize() {
      const r = stageEl.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      W = Math.max(300, Math.floor(r.width));
      H = Math.max(260, Math.floor(r.height));
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      clampView();
      invalidate();
    }

    /* ---------------- 描画 ---------------- */
    let frame = 0;
    let marquee = null; // {x0,y0,x1,y1} 画面座標
    let playhead = null; // 拍
    let scaleRows = null; // リスケールの行の塗り { root, intervals }
    const invalidate = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };

    function draw() {
      frame = 0;
      g.clearRect(0, 0, W, H);
      const gb = gridBottom();
      // 背景と行
      g.fillStyle = '#fbf8f1';
      g.fillRect(KEYS_W, gridTop, gridW(), gb - gridTop);
      const rows = visibleRows() + 1;
      for (let k = 0; k < rows; k++) {
        const p = topPitch - k;
        if (p < 0) break;
        const y = yOf(p);
        if (BLACK.includes(p % 12)) {
          g.fillStyle = '#f1ebdf';
          g.fillRect(KEYS_W, y, gridW(), rowH);
        }
        if (scaleRows && scaleRows.intervals.includes(((p - scaleRows.root) % 12 + 12) % 12)) {
          g.fillStyle = (p - scaleRows.root) % 12 === 0 ? 'rgba(184,134,59,0.22)' : 'rgba(184,134,59,0.10)';
          g.fillRect(KEYS_W, y, gridW(), rowH);
        }
        if (p % 12 === 0) {
          g.fillStyle = '#e0d6c3';
          g.fillRect(KEYS_W, y + rowH - 1, gridW(), 1);
        }
      }
      // 小節線・拍・グリッド
      const beatFrom = scrollX;
      const beatTo = beatAt(W);
      allBars.forEach((b) => {
        if (b.start > beatTo || b.start + b.len < beatFrom) return;
        const sub = snap() && snap() * pxPerBeat >= 7 ? snap() : 1;
        for (let t = 0; t < b.len - EPS; t += sub) {
          const x = Math.round(xOf(b.start + t)) + 0.5;
          const onBeat = Math.abs(t - Math.round(t)) < EPS;
          g.fillStyle = t === 0 ? '#bfae8f' : onBeat ? '#e3d9c7' : '#efe8da';
          g.fillRect(x, gridTop, 1, gb - gridTop);
        }
      });
      g.fillStyle = '#bfae8f';
      g.fillRect(Math.round(xOf(beats)), gridTop, 1, gb - gridTop);
      // 書き出す範囲
      if (sel) {
        g.fillStyle = 'rgba(184,134,59,0.10)';
        g.strokeStyle = '#8a4c1e';
        g.setLineDash([5, 3]);
        const x0 = xOf(sel.start);
        const y0 = yOf(sel.high);
        g.fillRect(x0, y0, (sel.end - sel.start) * pxPerBeat, (sel.high - sel.low + 1) * rowH);
        g.strokeRect(x0 + 0.5, y0 + 0.5, (sel.end - sel.start) * pxPerBeat, (sel.high - sel.low + 1) * rowH);
        g.setLineDash([]);
      }
      // 音
      g.save();
      g.beginPath();
      g.rect(KEYS_W, gridTop, gridW(), gb - gridTop);
      g.clip();
      const inSel = (n) => !sel || (n.pitch >= sel.low && n.pitch <= sel.high && n.start < sel.end - EPS && n.start + n.duration > sel.start + EPS);
      notes.forEach((n) => {
        if (!visible(n)) return;
        const x = xOf(n.start);
        const w = Math.max(2, n.duration * pxPerBeat - 1);
        if (x > W || x + w < KEYS_W) return;
        const y = yOf(n.pitch);
        if (y > gb || y + rowH < gridTop) return;
        g.globalAlpha = inSel(n) ? 0.35 + (n.velocity / 127) * 0.65 : 0.18;
        g.fillStyle = M.partColor(m, n.part || '');
        g.fillRect(x, y + 1, w, Math.max(2, rowH - 2));
        g.globalAlpha = 1;
        if (selected.has(n)) {
          g.strokeStyle = '#2b2620';
          g.lineWidth = 1.5;
          g.strokeRect(x + 0.75, y + 1.75, w - 1.5, Math.max(1, rowH - 3.5));
        }
      });
      if (marquee) {
        g.fillStyle = 'rgba(79,122,140,0.10)';
        g.strokeStyle = '#4f7a8c';
        g.setLineDash([4, 3]);
        const x = Math.min(marquee.x0, marquee.x1);
        const y = Math.min(marquee.y0, marquee.y1);
        g.fillRect(x, y, Math.abs(marquee.x1 - marquee.x0), Math.abs(marquee.y1 - marquee.y0));
        g.strokeRect(x + 0.5, y + 0.5, Math.abs(marquee.x1 - marquee.x0), Math.abs(marquee.y1 - marquee.y0));
        g.setLineDash([]);
      }
      g.restore();
      // ベロシティ欄
      const vy = gb + VEL_GAP;
      g.fillStyle = '#f6f1e6';
      g.fillRect(KEYS_W, vy, gridW(), VEL_H);
      g.fillStyle = '#a39a86';
      g.font = '10px sans-serif';
      g.fillText('強弱', 8, vy + 14);
      notes.forEach((n) => {
        if (!visible(n)) return;
        const x = xOf(n.start);
        if (x < KEYS_W || x > W) return;
        const h = (n.velocity / 127) * (VEL_H - 6);
        g.fillStyle = selected.has(n) ? '#2b2620' : M.partColor(m, n.part || '');
        g.fillRect(Math.round(x), vy + VEL_H - h, 3, h);
      });
      // 鍵盤
      g.fillStyle = '#fff';
      g.fillRect(0, gridTop, KEYS_W, gb - gridTop);
      for (let k = 0; k < rows; k++) {
        const p = topPitch - k;
        if (p < 0) break;
        const y = yOf(p);
        if (y > gb) break;
        if (BLACK.includes(p % 12)) {
          g.fillStyle = '#3a342c';
          g.fillRect(0, y, KEYS_W * 0.6, rowH);
        }
        g.fillStyle = '#e4ddd0';
        g.fillRect(0, y + rowH - 1, KEYS_W, p % 12 === 0 || p % 12 === 5 ? 1 : 0);
        if (p % 12 === 0) {
          g.fillStyle = BLACK.includes(p % 12) ? '#fff' : '#8a8171';
          g.font = `${Math.max(8, Math.min(10, rowH))}px sans-serif`;
          g.fillText(T.midiToNote(p), KEYS_W - 26, y + rowH - 2);
        }
      }
      g.fillStyle = '#d8cfbd';
      g.fillRect(KEYS_W - 1, gridTop, 1, gb - gridTop);
      // ルーラー
      g.fillStyle = '#f3eee3';
      g.fillRect(0, 0, W, RULER_H);
      g.font = '10px sans-serif';
      allBars.forEach((b, i) => {
        const x = xOf(b.start);
        if (x < KEYS_W - 30 || x > W) return;
        const prev = allBars[i - 1];
        const meter = !prev || prev.num !== b.num || prev.den !== b.den ? ` ${b.num}/${b.den}` : '';
        if (pxPerBeat * b.len < 18 && !meter && b.bar % 4 !== 1) return;
        g.fillStyle = '#6d6455';
        g.fillText(`${b.bar}${meter}`, x + 3, 14);
        g.fillStyle = '#bfae8f';
        g.fillRect(Math.round(x), 12, 1, RULER_H - 12);
      });
      (m.markers || []).forEach((mk) => {
        const x = xOf(mk.beat);
        if (x < KEYS_W || x > W) return;
        g.fillStyle = '#8a4c1e';
        g.fillRect(Math.round(x), RULER_H - 4, 1, 4);
      });
      // 再生を始める位置と、再生位置
      const cx = xOf(cursor);
      if (cx >= KEYS_W && cx <= W) {
        g.fillStyle = '#4f7a8c';
        g.beginPath();
        g.moveTo(cx - 5, 0);
        g.lineTo(cx + 5, 0);
        g.lineTo(cx, 8);
        g.fill();
      }
      if (playhead != null) {
        const px = xOf(playhead);
        if (px >= KEYS_W && px <= W) {
          g.fillStyle = '#c0392b';
          g.fillRect(Math.round(px), 0, 1.5, gb);
        }
      }
      g.fillStyle = '#fff';
      g.fillRect(0, 0, KEYS_W, RULER_H);
      g.fillRect(0, gb, KEYS_W, VEL_GAP + VEL_H);
      drawInfo();
    }

    function drawInfo() {
      const picked = [...selected];
      const one = picked.length === 1 ? picked[0] : null;
      const range = sel ? M.selectionLabel({ ...card, midi: draftMidi(), selection: sel }).replace('書き出す範囲', '範囲') : '書き出す範囲: 全体';
      info.textContent = `${notes.length}音${picked.length ? ` · ${picked.length}音を選択中` : ''}${dirty || tempoChanged() ? ' · 未保存の変更あり' : ''} · テンポ ${Math.round(tempo)} · ${range}` +
        (one ? ` · ${T.midiToNote(one.pitch)}(${T.beatLabel(one.start, m)}から${Math.round(one.duration * 100) / 100}拍・強さ${one.velocity}${one.part ? `・${M.partLabel(m, one.part)}` : ''})` : '');
      playBtn.textContent = preview ? '■ 停止(Space)' : sel ? '▶ 範囲を試聴(Space)' : '▶ 試聴(Space)';
    }

    /* ---------------- 編集の土台 ---------------- */
    const tempoChanged = () => Math.abs(tempo - m.tempo) > 0.01;
    const snapshot = () => notes.map((n) => ({ ...n }));
    function pushUndo() {
      undoStack.push(snapshot());
      if (undoStack.length > 80) undoStack.shift();
      redoStack.length = 0;
      dirty = true;
    }
    function restore(from, to) {
      if (!from.length) return;
      to.push(snapshot());
      notes = from.pop();
      selected = new Set();
      dirty = true;
      invalidate();
    }
    const targets = () => (selected.size ? [...selected] : notes.filter(visible));
    function draftMidi() {
      return {
        ...m,
        tempo,
        tempoChanges: (m.tempoChanges || []).map((t) => ({ ...t, bpm: Math.round(t.bpm * (tempo / m.tempo) * 10) / 10 })),
        notes: notes.slice().sort((a, b) => a.start - b.start),
      };
    }
    const span = (list) => ({ start: Math.min(...list.map((n) => n.start)), end: Math.max(...list.map((n) => n.start + n.duration)) });

    function hitNote(x, y) {
      const p = pitchAt(y);
      const b = beatAt(x);
      for (let i = notes.length - 1; i >= 0; i--) {
        const n = notes[i];
        if (visible(n) && n.pitch === p && b >= n.start - EPS && b < n.start + Math.max(n.duration, 4 / pxPerBeat)) return n;
      }
      return null;
    }

    /* ---------------- 変形 ---------------- */
    const OPS = {
      up: () => transpose(1), down: () => transpose(-1), octUp: () => transpose(12), octDown: () => transpose(-12),
      invert() {
        const list = targets();
        if (!list.length) return;
        pushUndo();
        const lo = Math.min(...list.map((n) => n.pitch));
        const hi = Math.max(...list.map((n) => n.pitch));
        list.forEach((n) => { n.pitch = Math.max(0, Math.min(127, lo + hi - n.pitch)); });
      },
      retro() {
        const list = targets();
        if (!list.length) return;
        pushUndo();
        const s = span(list);
        list.forEach((n) => { n.start = Math.max(0, s.start + s.end - (n.start + n.duration)); });
      },
      aug: () => stretch(2), dim: () => stretch(0.5),
      quantize() {
        const list = targets();
        if (!list.length || !snap()) return;
        pushUndo();
        list.forEach((n) => {
          n.start = Math.max(0, snapBeat(n.start));
          n.duration = Math.max(snap(), Math.round(n.duration / snap()) * snap());
        });
      },
      legato() {
        const list = targets().slice().sort((a, b) => a.start - b.start);
        if (!list.length) return;
        pushUndo();
        list.forEach((n) => {
          const next = notes.filter((x) => (x.part || '') === (n.part || '') && x.start > n.start + EPS).reduce((best, x) => (best == null || x.start < best ? x.start : best), null);
          if (next != null) n.duration = next - n.start;
        });
      },
      humanize() {
        const list = targets();
        if (!list.length) return;
        pushUndo();
        list.forEach((n) => {
          n.start = Math.max(0, n.start + (Math.random() * 2 - 1) * 0.02);
          n.velocity = Math.max(1, Math.min(127, Math.round(n.velocity + (Math.random() * 2 - 1) * 8)));
        });
      },
      louder: () => velocity(10), softer: () => velocity(-10),
      dup() {
        const list = targets();
        if (!list.length) return;
        pushUndo();
        const s = span(list);
        const offset = snap() ? Math.ceil((s.end - s.start) / snap() - EPS) * snap() : s.end - s.start;
        const copies = list.map((n) => ({ ...n, start: n.start + offset }));
        notes.push(...copies);
        selected = new Set(copies);
      },
      delete() {
        if (!selected.size) return;
        pushUndo();
        notes = notes.filter((n) => !selected.has(n));
        selected = new Set();
      },
      undo: () => restore(undoStack, redoStack),
      redo: () => restore(redoStack, undoStack),
      zoomIn: () => zoomX(1.5, KEYS_W + gridW() / 2), zoomOut: () => zoomX(1 / 1.5, KEYS_W + gridW() / 2),
      rowIn: () => zoomY(1.25), rowOut: () => zoomY(0.8),
      fit: fitAll,
    };
    function transpose(d) {
      const list = targets();
      if (!list.length) return;
      pushUndo();
      list.forEach((n) => { n.pitch = Math.max(0, Math.min(127, n.pitch + d)); });
      const hi = Math.max(...list.map((n) => n.pitch));
      const lo = Math.min(...list.map((n) => n.pitch));
      if (hi > topPitch) topPitch = hi + 2;
      if (lo < topPitch - visibleRows() + 1) topPitch = lo + visibleRows() - 3;
    }
    function stretch(k) {
      const list = targets();
      if (!list.length) return;
      pushUndo();
      const s = span(list);
      list.forEach((n) => {
        n.start = s.start + (n.start - s.start) * k;
        n.duration = Math.max(1 / 48, n.duration * k);
      });
    }
    function velocity(d) {
      const list = targets();
      if (!list.length) return;
      pushUndo();
      list.forEach((n) => { n.velocity = Math.max(1, Math.min(127, n.velocity + d)); });
    }
    function zoomX(k, atX) {
      const b = beatAt(atX);
      pxPerBeat *= k;
      clampView();
      scrollX = b - (atX - KEYS_W) / pxPerBeat;
      clampView();
    }
    function zoomY(k) {
      const mid = topPitch - visibleRows() / 2;
      rowH *= k;
      clampView();
      topPitch = Math.round(mid + visibleRows() / 2);
      clampView();
    }
    function runOp(op) {
      if (!OPS[op]) return;
      OPS[op]();
      invalidate();
    }

    /* ---------------- 試し弾き・試聴 ---------------- */
    let preview = null; // { handle, timer, offset }
    let previewRequest = 0;
    function stopPreview() {
      if (preview) {
        preview.handle.stop();
        clearTimeout(preview.timer);
        preview = null;
      }
      playhead = null;
      invalidate();
    }
    async function playMidi(midi, offset, onEnd) {
      M.stopAll();
      stopPreview();
      const request = ++previewRequest;
      const handle = await M.scheduleVoiced(soundAudioCtx, { voice: card.voice, midi }, (ctx) => ctx.currentTime + 0.05);
      if (request !== previewRequest || !overlay.isConnected) {
        handle.stop();
        return;
      }
      preview = { handle, offset, timer: setTimeout(() => { stopPreview(); if (onEnd) onEnd(); }, handle.duration * 1000 + 150), follow: offset != null };
      if (offset != null) requestAnimationFrame(tickPlayhead);
      invalidate();
    }
    function tickPlayhead() {
      if (!preview || preview.offset == null) return;
      const h = preview.handle;
      const sec = h.ctx.currentTime - h.startAt;
      playhead = sec < 0 ? preview.offset : preview.offset + h.toBeat(sec);
      // 再生位置が画面の外へ出たら追う
      const x = xOf(playhead);
      if (x > W - 30 || x < KEYS_W) {
        scrollX = playhead - (gridW() / pxPerBeat) * 0.1;
        clampView();
      }
      invalidate();
      requestAnimationFrame(tickPlayhead);
    }
    function togglePlayback() {
      if (preview) {
        previewRequest++;
        stopPreview();
        return;
      }
      const d = draftMidi();
      const shown = { ...d, notes: d.notes.filter(visible) };
      if (sel) {
        playMidi(M.sliceMidi(shown, sel), sel.start);
      } else {
        const from = Math.min(cursor, Math.max(0, T.endBeat(shown.notes) - 0.25));
        const end = beats + 16;
        const sliced = M.sliceMidi(shown, { start: from, end, low: 0, high: 127 });
        playMidi(sliced, from);
      }
    }
    function audition(pitch) {
      M.scheduleVoiced(soundAudioCtx, { voice: card.voice, midi: { tempo: 120, notes: [{ pitch, start: 0, duration: 0.5, velocity: 90 }], cc: [], tempoChanges: [] } }, (ctx) => ctx.currentTime + 0.01);
    }

    /* ---------------- ポインタ ---------------- */
    let drag = null;
    let lastDown = null; // ダブルクリックの見分け用
    const pos = (event) => {
      const r = canvas.getBoundingClientRect();
      return { x: event.clientX - r.left, y: event.clientY - r.top };
    };
    const region = ({ x, y }) => {
      if (y < RULER_H) return 'ruler';
      if (y > gridBottom() + VEL_GAP) return x < KEYS_W ? 'none' : 'vel';
      if (y > gridBottom()) return 'none';
      return x < KEYS_W ? 'keys' : 'grid';
    };

    function addNoteAt(pt) {
      pushUndo();
      const start = Math.max(0, Math.min(floorBeat(beatAt(pt.x)), beats - q()));
      const part = partEl ? partEl.value : parts[0];
      const n = { ...(part ? { part } : {}), pitch: pitchAt(pt.y), start, duration: q() === 1 / 48 ? 0.25 : q(), velocity: M.roleOf(m, part) === 'harmony' ? 70 : 90 };
      notes.push(n);
      selected = new Set([n]);
      audition(n.pitch);
      return n;
    }

    canvas.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      const pt = pos(event);
      const where = region(pt);
      if (where === 'ruler') {
        drag = { type: 'ruler', pt, scrollX, moved: false };
        return;
      }
      if (where === 'keys') {
        drag = { type: 'keys', pt, topPitch, moved: false };
        return;
      }
      if (where === 'vel') {
        pushUndo();
        drag = { type: 'vel' };
        paintVelocity(pt);
        return;
      }
      if (where !== 'grid') return;
      if (tool === 'range') {
        drag = { type: 'range', anchor: { beat: beatAt(pt.x), pitch: pitchAt(pt.y) } };
        updateRange(event, pt);
        return;
      }
      const hit = hitNote(pt.x, pt.y);
      const now = Date.now();
      const dbl = lastDown && now - lastDown.t < 350 && Math.abs(lastDown.x - pt.x) < 5 && Math.abs(lastDown.y - pt.y) < 5;
      lastDown = { t: now, x: pt.x, y: pt.y };
      if (hit) {
        if (dbl) {
          pushUndo();
          notes = notes.filter((n) => n !== hit);
          selected.delete(hit);
          lastDown = null;
          invalidate();
          return;
        }
        if (event.shiftKey) {
          if (selected.has(hit)) selected.delete(hit);
          else selected.add(hit);
          invalidate();
          return;
        }
        if (!selected.has(hit)) selected = new Set([hit]);
        audition(hit.pitch);
        const edge = Math.min(8, (hit.duration * pxPerBeat) / 3);
        const resize = pt.x > xOf(hit.start + hit.duration) - edge;
        let moving = [...selected];
        if (event.altKey && !resize) {
          // Alt+ドラッグで複製(元の音は残し、複製を動かす)
          pushUndo();
          const copies = moving.map((n) => ({ ...n }));
          notes.push(...copies);
          moving = copies;
          selected = new Set(copies);
        }
        drag = { type: resize ? 'resize' : 'move', grab: resize ? moving[moving.indexOf(hit)] || hit : null, pt, origin: moving.map((n) => ({ n, start: n.start, pitch: n.pitch, duration: n.duration })), moved: event.altKey, anchorBeat: beatAt(pt.x), anchorPitch: pitchAt(pt.y) };
        invalidate();
        return;
      }
      if (tool === 'draw' || dbl) {
        const n = addNoteAt(pt);
        drag = { type: 'resize', grab: n, pt, origin: [{ n, start: n.start, pitch: n.pitch, duration: n.duration }], moved: true, anchorBeat: beatAt(pt.x) };
        lastDown = null;
        invalidate();
        return;
      }
      if (!event.shiftKey) selected = new Set();
      drag = { type: 'marquee', pt, base: new Set(selected) };
      marquee = { x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y };
      invalidate();
    });

    canvas.addEventListener('pointermove', (event) => {
      const pt = pos(event);
      if (!drag) {
        // カーソルの形(音の右端は長さ、音の上は移動)
        const where = region(pt);
        let cur = 'default';
        if (where === 'grid') {
          const hit = tool !== 'range' && hitNote(pt.x, pt.y);
          if (hit) cur = pt.x > xOf(hit.start + hit.duration) - Math.min(8, (hit.duration * pxPerBeat) / 3) ? 'ew-resize' : 'grab';
          else cur = tool === 'draw' ? 'copy' : 'crosshair';
        } else if (where === 'keys') cur = 'ns-resize';
        else if (where === 'ruler') cur = 'ew-resize';
        canvas.style.cursor = cur;
        return;
      }
      if (drag.type === 'ruler') {
        const dx = pt.x - drag.pt.x;
        if (Math.abs(dx) > 3) drag.moved = true;
        if (drag.moved) {
          scrollX = drag.scrollX - dx / pxPerBeat;
          clampView();
          invalidate();
        }
      } else if (drag.type === 'keys') {
        const dy = pt.y - drag.pt.y;
        if (Math.abs(dy) > 3) drag.moved = true;
        if (drag.moved) {
          topPitch = Math.round(drag.topPitch + dy / rowH);
          clampView();
          invalidate();
        }
      } else if (drag.type === 'vel') {
        paintVelocity(pt);
      } else if (drag.type === 'range') {
        updateRange(event, pt);
      } else if (drag.type === 'marquee') {
        marquee.x1 = pt.x;
        marquee.y1 = pt.y;
        const b0 = beatAt(Math.min(marquee.x0, marquee.x1));
        const b1 = beatAt(Math.max(marquee.x0, marquee.x1));
        const p0 = pitchAt(Math.max(marquee.y0, marquee.y1));
        const p1 = pitchAt(Math.min(marquee.y0, marquee.y1));
        selected = new Set(drag.base);
        notes.forEach((n) => {
          if (visible(n) && n.pitch >= p0 && n.pitch <= p1 && n.start < b1 && n.start + n.duration > b0) selected.add(n);
        });
        invalidate();
      } else if (drag.type === 'move') {
        const dBeat = snap() ? Math.round((beatAt(pt.x) - drag.anchorBeat) / snap()) * snap() : beatAt(pt.x) - drag.anchorBeat;
        const dPitch = pitchAt(pt.y) - drag.anchorPitch;
        const minStart = Math.min(...drag.origin.map((o) => o.start));
        const d = Math.max(-minStart, dBeat);
        if (!drag.moved && (d !== 0 || dPitch !== 0)) {
          pushUndo();
          drag.moved = true;
        }
        drag.origin.forEach((o) => {
          o.n.start = o.start + d;
          o.n.pitch = Math.max(0, Math.min(127, o.pitch + dPitch));
        });
        if (dPitch !== drag.lastPitch) {
          drag.lastPitch = dPitch;
          if (drag.moved && drag.origin.length === 1) audition(drag.origin[0].n.pitch);
        }
        invalidate();
      } else if (drag.type === 'resize') {
        const g0 = drag.origin.find((o) => o.n === drag.grab) || drag.origin[0];
        const end = Math.max(g0.start + q(), snapBeat(beatAt(pt.x)));
        const delta = end - (g0.start + g0.duration);
        if (!drag.moved && Math.abs(delta) > EPS) {
          pushUndo();
          drag.moved = true;
        }
        drag.origin.forEach((o) => { o.n.duration = Math.max(q(), o.duration + delta); });
        invalidate();
      }
    });

    const endPointer = (event) => {
      if (!drag) return;
      if (drag.type === 'ruler' && !drag.moved) {
        cursor = Math.max(0, snapBeat(beatAt(drag.pt.x)));
        if (preview && !sel) {
          previewRequest++;
          stopPreview();
          togglePlayback();
        }
      }
      if (drag.type === 'keys' && !drag.moved) audition(pitchAt(drag.pt.y));
      marquee = null;
      drag = null;
      invalidate();
    };
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);

    function paintVelocity(pt) {
      const b = beatAt(pt.x);
      const v = Math.max(1, Math.min(127, Math.round(((gridBottom() + VEL_GAP + VEL_H - pt.y) / (VEL_H - 6)) * 127)));
      const hitW = Math.max(0.05, 4 / pxPerBeat);
      const pool = selected.size ? [...selected] : notes.filter(visible);
      pool.forEach((n) => { if (Math.abs(n.start - b) <= hitW) n.velocity = v; });
      invalidate();
    }

    function updateRange(event, pt) {
      const a = drag.anchor;
      const b = { beat: beatAt(pt.x), pitch: pitchAt(pt.y) };
      let start;
      let end;
      if (event.shiftKey) {
        start = T.barAt(allBars, Math.min(a.beat, b.beat)).start;
        const lastBar = T.barAt(allBars, Math.max(a.beat, b.beat) - 0.001);
        end = Math.max(lastBar.start + lastBar.len, start + T.barAt(allBars, start).len);
      } else {
        start = Math.floor(Math.max(0, Math.min(a.beat, b.beat)));
        end = Math.max(Math.ceil(Math.max(a.beat, b.beat)), start + 1);
      }
      end = Math.min(end, beats);
      start = Math.min(start, end - 0.25);
      sel = { start, end, low: Math.max(0, Math.min(a.pitch, b.pitch)), high: Math.min(127, Math.max(a.pitch, b.pitch)) };
      invalidate();
    }

    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      const pt = pos(event);
      if (event.ctrlKey || event.metaKey) zoomX(event.deltaY < 0 ? 1.2 : 1 / 1.2, pt.x);
      else if (event.altKey) zoomY(event.deltaY < 0 ? 1.15 : 1 / 1.15);
      else if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        scrollX += (event.deltaX || event.deltaY) / pxPerBeat;
        clampView();
      } else {
        topPitch -= Math.sign(event.deltaY) * 3;
        clampView();
      }
      invalidate();
    }, { passive: false });
    hscroll.addEventListener('input', () => {
      scrollX = Number(hscroll.value) / 100;
      clampView();
      invalidate();
    });

    /* ---------------- キーボード ---------------- */
    const onKey = (event) => {
      if (document.querySelectorAll('.modal-overlay.visible').length > 1) return; // 確認ダイアログを出している間(設定画面の枠は常にあるので、表示中だけを数える)
      const tag = event.target && event.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      // カードの編集ガイドのキー(Delete=カードの削除など)に届かないよう、編集画面を開いている間は止める
      event.stopPropagation();
      const ctrl = event.ctrlKey || event.metaKey;
      const key = event.key;
      let handled = true;
      if (key === 'Escape') {
        if (selected.size) {
          selected = new Set();
          invalidate();
        } else tryClose();
      } else if (key === ' ') togglePlayback();
      else if (key === 'Delete' || key === 'Backspace') runOp('delete');
      else if (ctrl && (key === 'z' || key === 'Z')) runOp(event.shiftKey ? 'redo' : 'undo');
      else if (ctrl && (key === 'y' || key === 'Y')) runOp('redo');
      else if (ctrl && (key === 'a' || key === 'A')) {
        selected = new Set(notes.filter(visible));
        invalidate();
      } else if (ctrl && (key === 'c' || key === 'C')) {
        const list = [...selected];
        if (list.length) {
          const s = span(list);
          clipboard = list.map((n) => ({ ...n, start: n.start - s.start }));
          setStatus(`${list.length}音をコピーしました(Ctrl+Vで再生位置へ貼り付け)`);
        }
      } else if (ctrl && (key === 'x' || key === 'X')) {
        const list = [...selected];
        if (list.length) {
          const s = span(list);
          clipboard = list.map((n) => ({ ...n, start: n.start - s.start }));
          runOp('delete');
        }
      } else if (ctrl && (key === 'v' || key === 'V')) {
        if (clipboard && clipboard.length) {
          pushUndo();
          const pasted = clipboard.map((n) => ({ ...n, start: cursor + n.start }));
          notes.push(...pasted);
          selected = new Set(pasted);
          invalidate();
        }
      } else if (ctrl && (key === 'd' || key === 'D')) runOp('dup');
      else if (key === 'ArrowUp') runOp(event.shiftKey ? 'octUp' : 'up');
      else if (key === 'ArrowDown') runOp(event.shiftKey ? 'octDown' : 'down');
      else if ((key === 'ArrowLeft' || key === 'ArrowRight') && selected.size) {
        pushUndo();
        const d = (key === 'ArrowLeft' ? -1 : 1) * (snap() || 0.25) * (event.shiftKey ? 4 : 1);
        const list = [...selected];
        const minStart = Math.min(...list.map((n) => n.start));
        list.forEach((n) => { n.start += Math.max(-minStart, d); });
        invalidate();
      } else if (!ctrl && (key === 'q' || key === 'Q')) runOp('quantize');
      else if (!ctrl && (key === 'v' || key === 'V')) setTool('select');
      else if (!ctrl && (key === 'b' || key === 'B')) setTool('draw');
      else if (!ctrl && (key === 'r' || key === 'R')) setTool('range');
      else handled = false;
      if (handled) event.preventDefault();
    };
    document.addEventListener('keydown', onKey, true);

    /* ---------------- 道具・欄 ---------------- */
    function setTool(next) {
      tool = next;
      overlay.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('me-seg--active', b.dataset.tool === tool));
      help.textContent = {
        select: '空いた所をドラッグで囲んで選ぶ(Shiftで追加)・ダブルクリックで音を足す。選んだ音はドラッグで移動、右端で長さ、Alt+ドラッグで複製、ダブルクリックかDeleteで削除。↑↓で半音(Shiftでオクターブ)、←→で横へ',
        draw: '空いた所を押すと音を足し、そのままドラッグで長さ。音の上では選択と同じように動かせます',
        range: 'ドラッグで四角く囲むと、保存(⇩)でその範囲の音だけを書き出します(拍単位。Shiftを押しながらだと小節単位)',
      }[tool] + '。ホイール=上下、Shift+ホイール=左右、Ctrl+ホイール=時間のズーム。ルーラーを押すと再生位置、Spaceで試聴';
      invalidate();
    }
    overlay.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
    overlay.querySelectorAll('[data-op]').forEach((b) => b.addEventListener('click', () => runOp(b.dataset.op)));
    snapEl.addEventListener('change', invalidate);
    overlay.querySelectorAll('[data-part-toggle]').forEach((b) => b.addEventListener('click', (event) => {
      const p = b.dataset.partToggle;
      if (event.ctrlKey || event.metaKey) {
        parts.forEach((x) => { if (x === p) hidden.delete(x); else hidden.add(x); });
      } else if (hidden.has(p)) hidden.delete(p);
      else if (hidden.size < parts.length - 1) hidden.add(p);
      selected = new Set([...selected].filter(visible));
      overlay.querySelectorAll('[data-part-toggle]').forEach((x) => x.classList.toggle('me-part--off', hidden.has(x.dataset.partToggle)));
      if (partEl && hidden.has(partEl.value)) partEl.value = parts.find((x) => !hidden.has(x)) || partEl.value;
      invalidate();
    }));
    // 音色はノートの編集と違って、選んだ時点でカードに残す(「やめる」でも戻さない)
    $('[data-voice]').addEventListener('change', (event) => {
      card.voice = event.target.value;
      scheduleAutoSave();
      previewRequest++;
      stopPreview();
      M.prepareVoice(M.voiceOf(card), draftMidi());
      setStatus(`音色を「${M.voiceOf(card).label}」にしました`);
      if (window.refreshEnsemblePanel) window.refreshEnsemblePanel(card);
    });
    M.prepareVoice(M.voiceOf(card), m);
    const tempoEl = $('[data-tempo]');
    const applyTempo = () => {
      const v = Number(tempoEl.value);
      if (!Number.isFinite(v) || v < 20 || v > 300) return;
      tempo = v;
      if (preview) {
        previewRequest++;
        stopPreview();
        togglePlayback();
      }
      invalidate();
    };
    tempoEl.addEventListener('change', applyTempo);
    tempoEl.addEventListener('keydown', (event) => { if (event.key === 'Enter') applyTempo(); });
    const volEl = $('[data-volume]');
    volEl.addEventListener('input', () => M.setPreviewVolume(Number(volEl.value)));
    volEl.addEventListener('change', () => scheduleAutoSave());

    /* ---------------- スケールでリスケール ---------------- */
    const sc = (name) => $(`[data-sc-${name}]`);
    let lastScaleId = guess.id;
    const showScaleRows = () => {
      const s = S.byId(sc('id').value);
      scaleRows = s ? { root: Number(sc('root').value), intervals: s.intervals } : null;
      invalidate();
    };
    const syncMethod = () => {
      const degree = sc('method').value === 'degree';
      sc('src-wrap').classList.toggle('me-field--off', !degree);
      sc('src-root').disabled = !degree;
      sc('src-id').disabled = !degree;
    };
    async function previewScale() {
      const s = S.byId(sc('id').value);
      if (!s) return;
      const root = Number(sc('root').value);
      let base = 60 + root;
      if (base > 66) base -= 12;
      const up = [...s.intervals, 12].map((i) => base + i);
      const pitches = [...up, ...up.slice(0, -1).reverse()];
      await playMidi({
        tempo: 120, cc: [], markers: [], tempoChanges: [],
        notes: pitches.map((pitch, i) => ({ pitch, start: i * 0.5, duration: i === pitches.length - 1 ? 1.5 : 0.475, velocity: i === 0 || i === pitches.length - 1 ? 96 : 84 })),
      }, null);
      info.textContent = `${S.NOTE_NAMES[root]} ${s.label}: ${s.intervals.map((i) => S.NOTE_NAMES[(root + i) % 12]).join(' ')}`;
    }
    const autoPreview = () => { if (sc('autoplay').checked) previewScale(); };
    sc('preview').addEventListener('click', previewScale);
    sc('method').addEventListener('change', syncMethod);
    sc('root').addEventListener('change', () => { showScaleRows(); autoPreview(); });
    sc('id').addEventListener('change', async () => {
      if (sc('id').value !== '__ask') {
        lastScaleId = sc('id').value;
        showScaleRows();
        autoPreview();
        return;
      }
      sc('id').value = lastScaleId;
      const asked = await showFormDialog({
        title: 'スケールをGeminiにたずねる',
        message: '名前を書くと、構成音(ルートからの半音の並び)をGeminiに1回たずねて一覧に足します。微分音は12平均律の近い半音に丸めます。足したスケールは次からも一覧に出ます。',
        submitLabel: 'たずねる',
        fields: [{ name: 'name', label: 'スケールの名前', required: true, placeholder: 'マカーム・バヤーティー、ラーガ・ヤマン など' }],
      });
      if (!asked) return;
      try {
        setStatus(`「${asked.name}」をGeminiにたずねています…`, { busy: true });
        const added = await S.askGemini(asked.name);
        sc('src-id').innerHTML = scaleOptions(sc('src-id').value, false);
        sc('id').innerHTML = scaleOptions(added.id, true);
        lastScaleId = added.id;
        showScaleRows();
        autoPreview();
        setStatus(`「${added.label}」を一覧に足しました`);
      } catch (err) {
        console.error(err);
        setStatus(`スケールをたずねられませんでした: ${err.message}`, { important: true });
      }
    });
    sc('apply').addEventListener('click', () => {
      const id = sc('id').value;
      const s = S.byId(id);
      if (!s) return;
      const root = Number(sc('root').value);
      const list = targets().filter((n) => M.roleOf(m, n.part) !== 'drums');
      if (!list.length) return;
      const opts2 = { method: sc('method').value, root, id, srcRoot: Number(sc('src-root').value), srcId: sc('src-id').value, parts: null };
      const next = list.map((n) => S.rescale([n], opts2)[0].pitch);
      if (!next.some((p, i) => p !== list[i].pitch)) {
        info.textContent = `${S.NOTE_NAMES[root]} ${s.label}: 動かす音はありませんでした(もうそのスケールに収まっています)`;
        return;
      }
      pushUndo();
      list.forEach((n, i) => { n.pitch = next[i]; });
      // 同じパート・同じ時刻・同じ高さに重なった音は1つにまとめる
      const seen = new Set();
      notes = notes.filter((n) => {
        const k = `${n.part || ''}/${Math.round(n.start * 1000)}/${n.pitch}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      selected = new Set([...selected].filter((n) => notes.includes(n)));
      rescaled = { root, id, label: s.label };
      sc('src-root').value = String(root);
      sc('src-id').value = id;
      sc('from').textContent = 'リスケール後';
      invalidate();
      info.textContent = `${S.NOTE_NAMES[root]} ${s.label}にリスケールしました。気に入らなければ「元に戻す」、よければ「保存」`;
    });
    syncMethod();

    /* ---------------- 閉じる・保存 ---------------- */
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    function close() {
      previewRequest++;
      stopPreview();
      if (ro) ro.disconnect();
      window.removeEventListener('resize', resize);
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
    }
    async function tryClose() {
      if (dirty || tempoChanged()) {
        const choice = await showChoiceDialog({
          title: '編集した内容を捨てますか?',
          message: '保存していないノート・テンポの変更があります。',
          options: [
            { label: '編集に戻る', value: 'back', secondary: true },
            { label: '捨てて閉じる', value: 'discard', danger: true },
          ],
        });
        if (choice !== 'discard') return;
      }
      close();
    }
    attachBackgroundTapToClose(overlay, tryClose);
    $('[data-act="cancel"]').addEventListener('click', tryClose);
    $('[data-act="play"]').addEventListener('click', togglePlayback);
    $('[data-act="all"]').addEventListener('click', () => {
      sel = null;
      invalidate();
    });
    $('[data-act="ok"]').addEventListener('click', () => {
      const draft = draftMidi();
      if (!draft.notes.length) {
        info.textContent = '音が1つもありません。音を足すか「やめる」で閉じてください';
        return;
      }
      if (sel && !M.sliceMidi(draft, sel).notes.length) {
        info.textContent = '書き出す範囲に音がありません。囲み直すか「範囲を全体に」を押してください';
        return;
      }
      const tempoSaved = tempoChanged();
      if (dirty) applyEdit(card, draft.notes);
      if (tempoSaved) {
        card.midi.tempo = draft.tempo;
        card.midi.tempoChanges = draft.tempoChanges;
        if (card.midi.design) card.midi.design.tempo = draft.tempo;
      }
      if (dirty && rescaled) {
        const shortName = rescaled.label.split(/ \/ | \(|（/)[0];
        card.midi.rescaledTo = `${S.NOTE_NAMES[rescaled.root]} ${shortName}`;
        const d = card.midi.design;
        if (d && d.pitch.system !== 'chords' && d.pitch.system !== 'row') {
          d.pitch.root = rescaled.root;
          d.pitch.scale = rescaled.id;
        }
      }
      card.selection = sel;
      scheduleAutoSave();
      close();
      if (window.refreshEnsembleCard) window.refreshEnsembleCard(card);
      setStatus(dirty || tempoSaved
        ? `「${card.name}」を保存しました${tempoSaved ? `(テンポ ${Math.round(draft.tempo)})` : ''}。ASTRでソウルやカードをつないで「作り直す」と、それを踏まえてブラッシュアップします`
        : card.selection ? `${M.selectionLabel(card)}。⇩でこの範囲だけを保存します` : '書き出す範囲を全体にしました');
      if (opts.onDone) opts.onDone();
      else if (window.refreshEnsemblePanel) window.refreshEnsemblePanel(card);
    });

    if (ro) ro.observe(stageEl);
    window.addEventListener('resize', resize);
    setTool(tool);
    resize();
    fitAll();
    invalidate();
  }

  /** 編集したノートをカードに書き込む。設計図の line の層(Geminiが書いた旋律)は、直した音に書き戻す */
  function applyEdit(card, notes) {
    const m = card.midi;
    m.notes = notes.map((n) => ({ ...n, start: Math.round(n.start * 1000) / 1000, duration: Math.round(n.duration * 1000) / 1000 })).slice(0, 4000);
    m.edited = true;
    const d = m.design;
    if (!d || !m.partLayers) return;
    // 設計図の旋律はハネを付ける前の位置で持つので、エンジンが付けたハネを外して戻す
    const shift = d.swing > 0.01 ? d.swing / 6 : 0;
    const unswing = (b) => (shift && Math.abs(b - Math.floor(b) - 0.5 - shift) < 1e-3 ? b - shift : b);
    const byLayer = {};
    m.notes.forEach((n) => {
      const li = m.partLayers[n.part];
      if (li == null) return;
      (byLayer[li] = byLayer[li] || []).push(n);
    });
    d.layers.forEach((l, i) => {
      if (l.generator !== 'line') return;
      l.notes = (byLayer[i] || []).map((n) => {
        const start = unswing(n.start);
        return { pitch: n.pitch, start, duration: Math.max(0.05, unswing(n.start + n.duration) - start), velocity: n.velocity };
      });
    });
  }

  Object.assign(M, { openMidiEditor });
})();
