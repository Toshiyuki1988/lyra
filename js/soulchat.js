// LYRA — プラグインの専門AIチャット(ソウル画面のチャットカード)。
// 2026-09-27追加(ユーザー要望「プラグインごとに専門AIチャットを作って。チャットは、Constellationの座談会カードの形式を
// 参照して、トピックごとにカードで独立。ボトムツールから追加したらプラグインソウルの現在開いている階層に置く感じ」)。
//   - 1枚のカード=1つのトピック。やり取りはカードの中に時系列で並び、下の入力欄から続けて聞ける(座談会と同じLINE風)
//   - カードはソウルの `soul.chats[]` に入り、`moduleId` のページ(=置いた時に開いていた階層)にだけ表示される
//   - 話し手はそのソウルの専門AIの1人だけ。渡す知識は解体したパラメータ(window.LyraSoulMaterial、ensemble.js と同じ形)で、
//     カードのあるページのパラメータと、ASTRでチャットにつないだパラメータを詳しく渡す
//   - 1回の送信でGeminiを1回呼ぶ(座談会と同じく、送信ボタンを押すまでは何も呼ばない。無料枠保護)
//   - 答えの中で触れたパラメータを params として出させ、実在するものだけチップにする(押すとそのパラメータを開く)
//   - 著作権ゲート: 書き出し・共有の機能は付けない。資料の文を長く引用させない
//
// データ: { id, type: 'chat', moduleId, topic, messages: [{ id, role: 'user'|'ai', text, paramIds?, createdAt }],
//           x, y, width, height, createdAt }

(function () {
  const REPLY_MAX = 900;
  const QUESTION_MAX = 1000;
  const HISTORY_CHARS = 6000;
  const DEFAULT_SIZE = { width: 360, height: 440 };

  const inFlight = new Set(); // 返事を待っているチャットのid
  const drafts = new Map(); // 入力途中の文(Driveには残さない。描き直しで消えないようにだけ覚える)
  const contexts = new Map(); // chat.id → { soul, openParam }(描き直しのたびに更新)

  const REPLY_SCHEMA = {
    type: 'OBJECT',
    properties: {
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
    required: ['text', 'params'],
  };

  function expertName(soul) {
    return `${soul.name}の専門AI`;
  }

  function makeChat(soul, module, topic, pos) {
    return {
      id: newId(),
      type: 'chat',
      moduleId: module.id,
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

  /**
   * カードの中身を作る(js/screens/soul.js の buildCard から)。
   * ctx: { soul, openParam(paramId), onChanged(chat) }
   */
  function buildCard(chat, el, ctx) {
    contexts.set(chat.id, ctx);
    const { soul } = ctx;
    el.classList.add('star-card--chat');
    el.innerHTML =
      `<div class="chat-head">${soulOrbSvg(soul, 18)}` +
      `<div class="chat-head-text"><div class="star-card-kind">${escapeHtml(expertName(soul))}</div>` +
      `<div class="chat-topic">${escapeHtml(chat.topic || '(トピックなし)')}</div></div></div>` +
      `<div class="chat-log"></div>` +
      `<div class="chat-composer">` +
      `<textarea class="chat-input" rows="2" spellcheck="false" placeholder="${escapeHtml(soul.name)}について聞く(Enterで送信・Shift+Enterで改行)"></textarea>` +
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
    renderLog(chat, el);
  }

  function renderLog(chat, el) {
    const ctx = contexts.get(chat.id);
    const log = el.querySelector('.chat-log');
    if (!ctx || !log) return;
    const { soul } = ctx;
    const busy = inFlight.has(chat.id);
    const module = soul.modules.find((m) => m.id === chat.moduleId);
    const msgs = chat.messages.map((m) => {
      if (m.role === 'user') {
        return `<div class="chat-msg chat-msg--user"><div class="chat-text">${escapeHtml(m.text)}</div></div>`;
      }
      const chips = (m.paramIds || [])
        .map((id) => soul.params.find((p) => p.id === id))
        .filter(Boolean)
        .map((p) => {
          const pm = soul.modules.find((x) => x.id === p.moduleId);
          return `<button type="button" class="chat-param" data-param="${p.id}" title="${escapeHtml(modulePath(pm))}">` +
            `${pm && pm.id !== chat.moduleId ? `${escapeHtml(pm.name)} › ` : ''}${escapeHtml(p.name)}</button>`;
        })
        .join('');
      return `<div class="chat-msg chat-msg--ai"><div class="chat-text">${escapeHtml(m.text)}</div>` +
        (chips ? `<div class="chat-params">${chips}</div>` : '') + `</div>`;
    });
    log.innerHTML =
      (msgs.length
        ? msgs.join('')
        : `<div class="chat-empty">「${escapeHtml(chat.topic || '')}」について、${escapeHtml(expertName(soul))}に聞いてみましょう。` +
          `解体した知識(このページ: ${escapeHtml(module ? modulePath(module) : '')})をもとに答えます。` +
          `ASTRでパラメータをこのカードにつなぐと、そのパラメータを詳しく踏まえます。1回の送信でGeminiを1回呼びます。</div>`) +
      (busy ? '<div class="chat-msg chat-msg--ai chat-typing"><span></span><span></span><span></span></div>' : '');
    log.querySelectorAll('.chat-param').forEach((btn) => {
      btn.addEventListener('click', () => ctx.openParam(btn.dataset.param));
    });
    log.scrollTop = log.scrollHeight;
    const sendBtn = el.querySelector('.chat-send');
    if (sendBtn) sendBtn.disabled = busy;
  }

  function refresh(chat) {
    const el = cardElById(chat.id);
    if (el) renderLog(chat, el);
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

  /** ASTRでこのチャットにつないだパラメータ */
  function linkedParams(soul, chat) {
    const ids = new Set();
    soul.connections.forEach((c) => {
      if (c.cardIdA === chat.id) ids.add(c.cardIdB);
      if (c.cardIdB === chat.id) ids.add(c.cardIdA);
    });
    return soul.params.filter((p) => ids.has(p.id));
  }

  function historyText(soul, chat) {
    const lines = chat.messages.slice(0, -1).map((m) => `${m.role === 'user' ? 'ユーザー' : expertName(soul)}: ${m.text}`);
    const kept = [];
    let total = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      total += lines[i].length;
      if (total > HISTORY_CHARS) break;
      kept.unshift(lines[i]);
    }
    return kept.join('\n');
  }

  function buildPrompt(soul, chat, question) {
    const module = soul.modules.find((m) => m.id === chat.moduleId);
    const linked = linkedParams(soul, chat);
    const focus = new Set([...soul.params.filter((p) => p.moduleId === chat.moduleId), ...linked].map((p) => p.id));
    const material = window.LyraSoulMaterial ? window.LyraSoulMaterial(soul, focus) : '';
    const history = historyText(soul, chat);
    return `あなたは「${soul.name}」(${categoryLabel(soul.category)})の専門家です。ユーザーは作曲支援アプリLYRAで、Cubase Pro 15とMax 9を使って作曲しながら${soul.name}を学んでいます。
このチャットのトピック: 「${chat.topic}」
このチャットを置いてあるページ: ${module ? modulePath(module) : '(なし)'}
${linked.length ? `ユーザーがこのチャットに線でつないだパラメータ: ${linked.map((p) => p.name).join('、')}\n` : ''}
ユーザーが資料から解体して整理した、${soul.name}についての知識:
${material || '  (まだ解体した知識がない)'}

${history ? `ここまでの会話:\n${history}\n\n` : ''}ユーザーの質問: ${question}

答え方:
- 最初の一文から質問に直接答える。前置き・挨拶・質問の言い直しはしない
- 上の知識にあるパラメータ・モジュールは画面上の名前で指し示し、どのページにあるかも添える
- 知識に無いこと(一般的な音作りの知識や推測)で補う時は、その文の末尾に「(推測)」と付ける。無い機能・パラメータ名・プリセット名・サンプル名を作らない
- 資料の文を長く引用しない。自分の言葉で短く説明する
- 手順が要る時だけ「1. 2. 3.」の短い手順にする。全体で400字以内。見出しや太字の記号は使わない
出力: text(答え)、params(答えの中で触れた、上の知識にあるパラメータ。module=モジュール名、name=パラメータ名。最大6個。無ければ空の配列)`;
  }

  async function send(chat, textArg) {
    const ctx = contexts.get(chat.id);
    if (!ctx) return;
    const { soul } = ctx;
    const el = cardElById(chat.id);
    const input = el && el.querySelector('.chat-input');
    const question = String(textArg != null ? textArg : (input ? input.value : '')).trim().slice(0, QUESTION_MAX);
    if (!question || inFlight.has(chat.id)) return;

    const userMsg = { id: newId(), role: 'user', text: question, createdAt: new Date().toISOString() };
    chat.messages.push(userMsg);
    if (textArg == null) {
      drafts.delete(chat.id);
      if (input) input.value = '';
    }
    inFlight.add(chat.id);
    refresh(chat);
    scheduleAutoSave();
    setStatus(`${expertName(soul)}が考えています…`, { busy: true });
    try {
      const prompt = buildPrompt(soul, chat, question);
      // 「考え中」の点々が一瞬で消えないよう、実際の返事と短い間の長い方を待つ(音は結果がそろった瞬間に鳴らす)
      const [raw] = await Promise.all([
        askGeminiJson({ prompt, responseSchema: REPLY_SCHEMA, maxOutputTokens: 2048, label: '専門AIチャット' }),
        wait(600 + Math.random() * 600),
      ]);
      const text = String(raw.text || '').trim().slice(0, REPLY_MAX);
      if (!text) throw new Error('返事が空でした');
      chat.messages.push({
        id: newId(),
        role: 'ai',
        text,
        paramIds: resolveParams(soul, chat, raw.params),
        createdAt: new Date().toISOString(),
      });
      playChatReplySound();
      setStatus(`${expertName(soul)}から返事が届きました`);
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

  /* ---------------- 追加・編集・削除(ソウル画面から) ---------------- */

  async function askNewChat(soul, module) {
    const values = await showFormDialog({
      title: `${expertName(soul)}とのチャット`,
      message: `「${modulePath(module)}」のページに、トピックごとのチャットカードを置きます。` +
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
    const topicEl = el && el.querySelector('.chat-topic');
    if (topicEl) topicEl.textContent = chat.topic;
    scheduleAutoSave();
    return true;
  }

  async function confirmDelete(chat) {
    const choice = await showChoiceDialog({
      title: `チャット「${chat.topic}」を削除しますか?`,
      message: `このカードのやり取り(${chat.messages.length}件)が消えます。`,
      options: [
        { label: 'やめる', value: 'cancel', secondary: true },
        { label: '削除する', value: 'delete', danger: true },
      ],
    });
    if (choice !== 'delete') return false;
    drafts.delete(chat.id);
    contexts.delete(chat.id);
    return true;
  }

  window.LyraSoulChat = { makeChat, buildCard, send, askNewChat, editTopic, confirmDelete, expertName };
})();
