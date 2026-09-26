// LYRA — プラグインの専門AIチャット(チャットカード)。ソウル画面とアンサンブル画面で共通。
// 2026-09-27追加(ユーザー要望「プラグインごとに専門AIチャットを作って。チャットは、Constellationの座談会カードの形式を
// 参照して、トピックごとにカードで独立。ボトムツールから追加したらプラグインソウルの現在開いている階層に置く感じ」)。
// 同日拡張(「アンサンブル画面でもカードからチャットを展開できるように、アステリズムで繋いだ別プラグインのAIがチャットに参加できるように」)。
//   - 1枚のカード=1つのトピック。やり取りはカードの中に時系列で並び、下の入力欄から続けて聞ける(座談会と同じLINE風)
//   - ソウル画面: `soul.chats[]` に入り、`moduleId` のページ(=置いた時に開いていた階層)にだけ表示。話し手はそのソウルの専門AIだけ
//   - アンサンブル: `ensemble.cards` に `type: 'chat'`, `soulId`(主のプラグイン)で入る。チャットカードにASTRで直接つないだ
//     別プラグインのソウルカード・パラメータカードの持ち主のAIも参加する(参加者は画面側の ctx.participants() が決める)
//   - 渡す知識は解体したパラメータ(window.LyraSoulMaterial、ensemble.js と同じ形)。ctx.focusParamIds(soul) のパラメータを詳しく
//   - **1回の送信でGeminiを1回**。参加者が複数でも1回の出力に全員の発言(voices)を書かせ、表示だけ1人ずつ間を置いて出す
//     (送信ボタンを押すまでは何も呼ばない。無料枠保護)
//   - 答えの中で触れたパラメータを params として出させ、実在するものだけチップにする(押すとそのパラメータを開く)
//   - 著作権ゲート: 書き出し・共有の機能は付けない。資料の文を長く引用させない
//
// データ: { id, type: 'chat', topic, moduleId?(ソウル画面)| soulId?(アンサンブルの主), x, y, width, height, createdAt,
//           messages: [{ id, role: 'user'|'ai', soulId?(話したAI。無ければ主), text, paramIds?, createdAt }] }
//
// ctx(画面ごとに buildCard へ渡す):
//   host            … 主のソウル
//   participants()  … 今の参加者のソウル(主が先頭)
//   focusParamIds(soul) … 詳しく渡すパラメータのid(Set)
//   place           … チャットの置き場所の説明(「OSCタブ › OSC A のページ」など)
//   extraLines()    … 任意。線でつないだ他のカードの要約(アンサンブル)
//   openParam(soulId, paramId), onChanged(chat)

(function () {
  const REPLY_MAX = 900;
  const QUESTION_MAX = 1000;
  const HISTORY_CHARS = 6000;
  const LONG_PRESS_MS = 450; // 会話ログの上での長押し(編集ガイド)。スクロール・文字選択と区別するため少し長め
  const DEFAULT_SIZE = { width: 360, height: 440 };
  const KEYS = 'ABCDEFGH';

  const inFlight = new Set(); // 返事を待っているチャットのid
  const drafts = new Map(); // 入力途中の文(Driveには残さない。描き直しで消えないようにだけ覚える)
  const contexts = new Map(); // chat.id → ctx(描き直しのたびに更新)

  const REPLY_SCHEMA = {
    type: 'OBJECT',
    properties: {
      voices: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            speaker: { type: 'STRING' },
            text: { type: 'STRING' },
            params: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: { module: { type: 'STRING' }, name: { type: 'STRING' } },
                required: ['name'],
              },
            },
          },
          required: ['speaker', 'text', 'params'],
        },
      },
    },
    required: ['voices'],
  };

  function expertName(soul) {
    return soul ? `${soul.name}の専門AI` : '専門AI';
  }

  /** 新しいチャット。where は { moduleId } か { soulId }。pos はカードの中心 */
  function makeChat(where, topic, pos) {
    return {
      id: newId(),
      type: 'chat',
      ...where,
      topic,
      messages: [],
      x: pos.x - DEFAULT_SIZE.width / 2,
      y: pos.y - DEFAULT_SIZE.height / 2,
      width: DEFAULT_SIZE.width,
      height: DEFAULT_SIZE.height,
      createdAt: new Date().toISOString(),
    };
  }

  /* ---------------- 描画 ---------------- */

  function buildCard(chat, el, ctx) {
    contexts.set(chat.id, ctx);
    el.classList.add('star-card--chat');
    el.innerHTML =
      `<div class="chat-head"></div>` +
      `<div class="chat-log"></div>` +
      `<div class="chat-composer">` +
      `<textarea class="chat-input" rows="2" spellcheck="false"></textarea>` +
      `<button type="button" class="chat-send" aria-label="送信">送信</button></div>`;

    const log = el.querySelector('.chat-log');
    const input = el.querySelector('.chat-input');
    const sendBtn = el.querySelector('.chat-send');
    // ホイールはキャンバスのズームではなく会話ログ・入力欄のスクロールに使う
    [log, input].forEach((x) => x.addEventListener('wheel', (event) => event.stopPropagation(), { passive: true }));
    input.value = drafts.get(chat.id) || '';
    input.addEventListener('input', () => drafts.set(chat.id, input.value));
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault();
        send(chat);
      }
    });
    sendBtn.addEventListener('click', () => send(chat));
    attachLogLongPress(el, log);
    renderHead(chat, el);
    renderLog(chat, el);
  }

  /**
   * 会話ログの上はスクロール・文字選択を優先するため、カード本体の長押し(js/canvas.js)が届かない。
   * 指・マウスを動かさずに押し続けた時だけ、ここで編集ガイド(Edit・ASTR・Delete)を出す。
   */
  function attachLogLongPress(el, log) {
    let timer = null;
    let start = null;
    const cancel = () => {
      clearTimeout(timer);
      timer = null;
      start = null;
    };
    log.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('button') || el.classList.contains('star-card--edit-guide')) return;
      start = { x: event.clientX, y: event.clientY };
      timer = setTimeout(() => {
        timer = null;
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) return; // 文字を選んでいる途中なら出さない
        activateEditGuide(el);
      }, LONG_PRESS_MS);
    });
    log.addEventListener('pointermove', (event) => {
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) cancel();
    });
    ['pointerup', 'pointercancel', 'pointerleave', 'scroll'].forEach((type) => log.addEventListener(type, cancel, { passive: true }));
  }

  function renderHead(chat, el) {
    const ctx = contexts.get(chat.id);
    const head = el.querySelector('.chat-head');
    const input = el.querySelector('.chat-input');
    if (!ctx || !head) return;
    const people = ctx.participants();
    const guests = people.slice(1);
    head.innerHTML =
      `<div class="chat-orbs">${people.map((s) => soulOrbSvg(s, 18)).join('')}</div>` +
      `<div class="chat-head-text"><div class="star-card-kind">${escapeHtml(expertName(ctx.host))}` +
      `${guests.length ? ` + ${escapeHtml(guests.map((s) => s.name).join('・'))}` : ''}</div>` +
      `<div class="chat-topic">${escapeHtml(chat.topic || '(トピックなし)')}</div></div>`;
    if (input) {
      input.placeholder = `${guests.length ? 'みんな' : ctx.host.name}に聞く(Enterで送信・Shift+Enterで改行)`;
    }
  }

  function renderLog(chat, el) {
    const ctx = contexts.get(chat.id);
    const log = el.querySelector('.chat-log');
    if (!ctx || !log) return;
    const host = ctx.host;
    const busy = inFlight.has(chat.id);
    // 主以外が話したことがあるチャットでは、AIの発言ごとに話し手の名前を出す
    const multi = chat.messages.some((m) => m.role === 'ai' && m.soulId && m.soulId !== host.id) || ctx.participants().length > 1;
    const msgs = chat.messages.map((m) => {
      if (m.role === 'user') {
        return `<div class="chat-msg chat-msg--user"><div class="chat-text">${escapeHtml(m.text)}</div></div>`;
      }
      const speaker = (m.soulId && getSoul(m.soulId)) || host;
      const chips = (m.paramIds || [])
        .map((id) => speaker.params.find((p) => p.id === id))
        .filter(Boolean)
        .map((p) => {
          const pm = speaker.modules.find((x) => x.id === p.moduleId);
          const showModule = pm && pm.id !== chat.moduleId;
          return `<button type="button" class="chat-param" data-soul="${speaker.id}" data-param="${p.id}" title="${escapeHtml(`${speaker.name} / ${modulePath(pm)}`)}">` +
            `${showModule ? `${escapeHtml(pm.name)} › ` : ''}${escapeHtml(p.name)}</button>`;
        })
        .join('');
      return `<div class="chat-msg chat-msg--ai">` +
        (multi ? `<div class="chat-speaker" style="color:${shadeColor(speaker.color, -0.3)}">${soulOrbSvg(speaker, 13)}${escapeHtml(speaker.name)}</div>` : '') +
        `<div class="chat-text">${escapeHtml(m.text)}</div>` +
        (chips ? `<div class="chat-params">${chips}</div>` : '') + `</div>`;
    });
    const people = ctx.participants();
    log.innerHTML =
      (msgs.length
        ? msgs.join('')
        : `<div class="chat-empty">「${escapeHtml(chat.topic || '')}」について、${escapeHtml(expertName(host))}に聞いてみましょう。` +
          `解体した知識をもとに答えます(${escapeHtml(ctx.place)})。` +
          (people.length > 1
            ? `線でつないだ ${escapeHtml(people.slice(1).map((s) => s.name).join('・'))} のAIも参加しています。`
            : 'ASTRでカードをこのチャットにつなぐと、そのパラメータ(アンサンブルでは別のプラグインのAIも)が加わります。') +
          `1回の送信でGeminiを1回呼びます。</div>`) +
      (busy ? '<div class="chat-msg chat-msg--ai chat-typing"><span></span><span></span><span></span></div>' : '');
    log.querySelectorAll('.chat-param').forEach((btn) => {
      btn.addEventListener('click', () => ctx.openParam(btn.dataset.soul, btn.dataset.param));
    });
    log.scrollTop = log.scrollHeight;
    const sendBtn = el.querySelector('.chat-send');
    if (sendBtn) sendBtn.disabled = busy;
  }

  function refresh(chat) {
    const el = cardElById(chat.id);
    if (el) renderLog(chat, el);
  }

  /** 参加者が変わった時(線をつないだ・外した時)に見出しと案内を描き直す */
  function refreshParticipants(chat) {
    const el = cardElById(chat.id);
    if (!el || !contexts.has(chat.id)) return;
    renderHead(chat, el);
    if (!inFlight.has(chat.id)) renderLog(chat, el);
  }

  /* ---------------- 送信 ---------------- */

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function normalizeName(text) {
    return String(text || '').toLowerCase().replace(/[\s_\-・/]+/g, '');
  }

  /** Geminiが挙げたパラメータ名を、そのソウルに実在するパラメータへ結びつける(無いものは捨てる) */
  function resolveParams(soul, chat, items) {
    const ids = [];
    (items || []).forEach((item) => {
      const key = normalizeName(item && item.name);
      if (!key) return;
      const candidates = soul.params.filter((p) => normalizeName(p.name) === key);
      if (!candidates.length) return;
      const modKey = normalizeName(item.module);
      const inModule = (p) => {
        const m = soul.modules.find((x) => x.id === p.moduleId);
        return m && modKey && (normalizeName(m.name) === modKey || normalizeName(modulePath(m)) === modKey);
      };
      const hit = candidates.find(inModule) || candidates.find((p) => p.moduleId === chat.moduleId) || candidates[0];
      if (!ids.includes(hit.id)) ids.push(hit.id);
    });
    return ids.slice(0, 6);
  }

  function historyText(chat, keyOf, host) {
    const lines = chat.messages.slice(0, -1).map((m) => {
      if (m.role === 'user') return `ユーザー: ${m.text}`;
      const s = (m.soulId && getSoul(m.soulId)) || host;
      const key = keyOf.get(s.id);
      return `${key ? `[${key}] ` : ''}${expertName(s)}: ${m.text}`;
    });
    const kept = [];
    let total = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      total += lines[i].length;
      if (total > HISTORY_CHARS) break;
      kept.unshift(lines[i]);
    }
    return kept.join('\n');
  }

  function buildPrompt(ctx, chat, question, people) {
    const keyOf = new Map(people.map((s, i) => [s.id, KEYS[i]]));
    const multi = people.length > 1;
    const blocks = people
      .map((s, i) => {
        const focus = ctx.focusParamIds(s);
        const detailed = s.params.filter((p) => focus.has(p.id)).map((p) => p.name);
        const material = window.LyraSoulMaterial ? window.LyraSoulMaterial(s, focus) : '';
        return `[${KEYS[i]}] ${expertName(s)}(${categoryLabel(s.category)}${i === 0 ? '。このチャットの主' : '。線でつないで参加'})\n` +
          (detailed.length && i > 0 ? `  このチャットに線でつないだパラメータ: ${detailed.slice(0, 20).join('、')}\n` : '') +
          `${material || '  (まだ解体した知識がない)'}`;
      })
      .join('\n\n');
    const extra = ctx.extraLines ? ctx.extraLines() : [];
    const history = historyText(chat, keyOf, ctx.host);
    const who = multi
      ? `あなたたちは、作曲支援アプリLYRAのチャットに参加している、それぞれのプラグインの専門家です(参加者は下の角括弧の記号で区別する)。`
      : `あなたは「${ctx.host.name}」(${categoryLabel(ctx.host.category)})の専門家です。`;
    const voiceRule = multi
      ? `- voices に、答える参加者ごとに1つずつ書く(speaker は ${people.map((s) => keyOf.get(s.id)).join(', ')} のどれか)。主の [A] は必ず最初に答える
- 他の参加者は、自分のプラグインの立場から加えることがある時だけ話す(自分のプラグインならどうするか・違い・補足・反論)。前の発言と同じことを繰り返さない。互いの発言に反応してよい
- 各参加者は、自分のプラグインの知識にあるパラメータだけを名前で指す。他のプラグインの機能を自分のもののように語らない
- 1人300字以内`
      : `- voices には [A] の答えを1つだけ書く
- 全体で400字以内`;
    return `${who}ユーザーはCubase Pro 15とMax 9を使って作曲しながら、プラグインを学んでいます。
このチャットのトピック: 「${chat.topic}」
このチャットの置き場所: ${ctx.place}

参加者と、ユーザーが資料から解体して整理したそれぞれの知識:
${blocks}
${extra.length ? `\nこのチャットに線でつないである他のカード:\n${extra.map((l) => `- ${l}`).join('\n')}\n` : ''}
${history ? `ここまでの会話:\n${history}\n\n` : ''}ユーザーの質問: ${question}

答え方:
- 最初の一文から質問に直接答える。前置き・挨拶・質問の言い直しはしない
- 知識にあるパラメータ・モジュールは画面上の名前で指し示し、どのページにあるかも添える
- 知識に無いこと(一般的な音作りの知識や推測)で補う時は、その文の末尾に「(推測)」と付ける。無い機能・パラメータ名・プリセット名・サンプル名を作らない
- 資料の文を長く引用しない。自分の言葉で短く説明する
- 手順が要る時だけ「1. 2. 3.」の短い手順にする。見出しや太字の記号は使わない
${voiceRule}
出力: voices([{ speaker, text(発言), params(その発言で触れた、自分の知識にあるパラメータ。module=モジュール名、name=パラメータ名。最大6個。無ければ空の配列) }])`;
  }

  async function send(chat, textArg) {
    const ctx = contexts.get(chat.id);
    if (!ctx) return;
    const el = cardElById(chat.id);
    const input = el && el.querySelector('.chat-input');
    const question = String(textArg != null ? textArg : (input ? input.value : '')).trim().slice(0, QUESTION_MAX);
    if (!question || inFlight.has(chat.id)) return;
    const people = ctx.participants().slice(0, KEYS.length);

    const userMsg = { id: newId(), role: 'user', text: question, createdAt: new Date().toISOString() };
    chat.messages.push(userMsg);
    if (textArg == null) {
      drafts.delete(chat.id);
      if (input) input.value = '';
    }
    inFlight.add(chat.id);
    refresh(chat);
    scheduleAutoSave();
    setStatus(`${people.length > 1 ? `${people.map((s) => s.name).join('・')}のAI` : expertName(ctx.host)}が考えています…`, { busy: true });
    try {
      const prompt = buildPrompt(ctx, chat, question, people);
      // 「考え中」の点々が一瞬で消えないよう、実際の返事と短い間の長い方を待つ(音は結果がそろった瞬間に鳴らす)
      const [raw] = await Promise.all([
        askGeminiJson({ prompt, responseSchema: REPLY_SCHEMA, maxOutputTokens: people.length > 1 ? 4096 : 2048, label: '専門AIチャット' }),
        wait(600 + Math.random() * 600),
      ]);
      const bySpeaker = new Map(people.map((s, i) => [KEYS[i], s]));
      const seen = new Set();
      const voices = (raw.voices || [])
        .map((v) => ({ soul: bySpeaker.get(String(v.speaker || '').replace(/[[\]\s]/g, '').toUpperCase()), text: String(v.text || '').trim().slice(0, REPLY_MAX), params: v.params }))
        .filter((v) => v.soul && v.text && !seen.has(v.soul.id) && seen.add(v.soul.id));
      if (!voices.length) throw new Error('返事が空でした');
      // 1回の出力に全員ぶんが入っているが、座談会のように1人ずつ間を置いて出す
      for (let i = 0; i < voices.length; i++) {
        if (i > 0) await wait(700 + Math.random() * 600);
        const v = voices[i];
        chat.messages.push({
          id: newId(),
          role: 'ai',
          soulId: v.soul.id,
          text: v.text,
          paramIds: resolveParams(v.soul, chat, v.params),
          createdAt: new Date().toISOString(),
        });
        if (i === voices.length - 1) inFlight.delete(chat.id);
        playChatReplySound();
        refresh(chat);
      }
      setStatus(voices.length > 1 ? `${voices.length}人のAIから返事が届きました` : `${expertName(voices[0].soul)}から返事が届きました`);
    } catch (err) {
      console.error(err);
      // 届かなかった質問は会話から外し、入力欄へ戻す(もう一度そのまま送れるように)
      const idx = chat.messages.indexOf(userMsg);
      if (idx >= 0) chat.messages.splice(idx, 1);
      const nowEl = cardElById(chat.id);
      const nowInput = nowEl && nowEl.querySelector('.chat-input');
      if (nowInput && !nowInput.value.trim()) nowInput.value = question;
      if (!drafts.get(chat.id)) drafts.set(chat.id, question);
      setStatus(`返事を受け取れませんでした: ${err.message}`, { important: true });
    } finally {
      inFlight.delete(chat.id);
      refresh(chat);
      scheduleAutoSave();
      const now = contexts.get(chat.id);
      if (now && now.onChanged) now.onChanged(chat);
    }
  }

  /* ---------------- 追加・編集・削除(各画面から) ---------------- */

  async function askNewChat(soul, placeText) {
    const values = await showFormDialog({
      title: `${expertName(soul)}とのチャット`,
      message: `${placeText}に、トピックごとのチャットカードを置きます。` +
        '最初の質問を書いておくと、置いてすぐに聞きます(Geminiを1回呼びます)。',
      submitLabel: '置く',
      fields: [
        { name: 'topic', label: 'トピック', placeholder: '例: Warpモードの使い分け', required: true },
        { name: 'question', label: '最初の質問(任意)', type: 'textarea', placeholder: '空欄なら、カードの入力欄から後で聞けます' },
      ],
    });
    if (!values) return null;
    return { topic: String(values.topic).trim().slice(0, 60), question: String(values.question || '').trim() };
  }

  async function editTopic(chat) {
    const values = await showFormDialog({
      title: 'トピックを変える',
      fields: [{ name: 'topic', label: 'トピック', value: chat.topic || '', required: true }],
    });
    if (!values) return false;
    chat.topic = String(values.topic).trim().slice(0, 60);
    const el = cardElById(chat.id);
    if (el) renderHead(chat, el);
    scheduleAutoSave();
    return true;
  }

  async function confirmDelete(chat) {
    const choice = await showChoiceDialog({
      title: `チャット「${chat.topic}」を削除しますか?`,
      message: `このカードのやり取り(${chat.messages.length}件)と、そこから伸びている線が消えます。`,
      options: [
        { label: 'やめる', value: 'cancel', secondary: true },
        { label: '削除する', value: 'delete', danger: true },
      ],
    });
    if (choice !== 'delete') return false;
    drafts.delete(chat.id);
    contexts.delete(chat.id);
    inFlight.delete(chat.id);
    return true;
  }

  /** アンサンブルのまとめ・MIDI生成などに渡す1行(トピックと直近のやり取り) */
  function describe(chat) {
    const host = getSoul(chat.soulId);
    const recent = chat.messages.slice(-4).map((m) => {
      if (m.role === 'user') return `ユーザー: ${m.text}`;
      const s = (m.soulId && getSoul(m.soulId)) || host;
      return `${s ? s.name : 'AI'}: ${m.text}`;
    }).join(' / ');
    return `[チャット · ${expertName(host)}] ${chat.topic || ''}${recent ? ` — ${recent.slice(0, 400)}` : '(まだやり取りなし)'}`;
  }

  window.LyraSoulChat = { makeChat, buildCard, send, askNewChat, editTopic, confirmDelete, refreshParticipants, expertName, describe };
})();
