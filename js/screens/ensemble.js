// LYRA — アンサンブル画面(ハンドオフ4.3節)。舞台のソウルごとに1つ(「アンサンブル in 〇〇」)。
// 自由配置キャンバスに、パラメータ・気づき・出典・オーディオ・MIDI・課題カードが散らばる。
//
// 招集(どのソウルが参加するか)は自動: 線(Asterism)でつながったカードのまとまりのうち、
// いま注目しているまとまり(最後に触ったカード、なければ最後に結んだ線のもの)に含まれるカードの
// 持ち主のソウルが招集される。手動でソウルを選ぶ操作はない。
// 発言は「アンサンブルを聴く」ボタンを押した時だけGeminiを呼ぶ(無料枠保護、2026-09-25決定)。
// ホームの舞台自身のソウルは、その場そのもの(発言者「場」)として毎回参加する。別の舞台のソウルは
// カードとして持ち込まれ、線でつながった時にゲストとして招集される(舞台のソウルの二重役割)。
//
// グラウンディング(ハンドオフ5節): 各ソウルには自分の出典・テキスト由来の知識だけを渡し、それ以外を
// 根拠にしないよう指示する。汎用ペルソナ「楽典」だけは一般的な音楽理論の知識を使ってよい。
//
// カードのデータ(state.ensembles[舞台ID].cards):
//   text   { text }                            気づき
//   task   { text, origin: 'user'|'app', soulId?, paramId?, reason?, date? }  課題
//   param  { soulId, paramId }                  ソウルから持ち出したパラメータ
//   source { soulId, sourceId }                 出典
//   soul   { soulId }                           ソウルそのもの(別の舞台のゲスト参加など)
//   speech { voices, chain, recipe, memberIds, triggerCardIds, feedback }  アンサンブルの発言
//   midi   { name, midi, speechId? }            js/midi.js
//   audio  { name, fileId, mimeType, peaks, duration, hqFileId? }  js/audio.js

(function () {
  const SPEECH_SCHEMA = {
    type: 'OBJECT',
    properties: {
      voices: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: { speaker: { type: 'STRING' }, text: { type: 'STRING' } },
          required: ['speaker', 'text'],
        },
      },
      chain: {
        type: 'OBJECT',
        properties: {
          concept: { type: 'STRING' },
          structure: { type: 'STRING' },
          operations: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['concept', 'structure', 'operations'],
      },
      recipe: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            soul: { type: 'STRING' },
            module: { type: 'STRING' },
            param: { type: 'STRING' },
            value: { type: 'STRING' },
            intent: { type: 'STRING' },
          },
          required: ['soul', 'param', 'value'],
        },
      },
    },
    required: ['voices', 'chain'],
  };

  const THEORY_ID = 'theory';
  const THEORY_COLOR = '#8a8171';
  const VOICE_MAX = 170;

  let stage = null;
  let focusCardId = null;
  let listening = false;

  const screen = {
    fitMaxScale: 1,

    enter(route) {
      stage = route.stageId ? getSoul(route.stageId) : null;
      if (!stage || stage.category !== 'stage') {
        const fallback = defaultStage();
        if (!fallback) {
          navigate('#/');
          return false;
        }
        navigate(ensembleHash(fallback));
        return false;
      }
      const ens = getEnsemble(stage.id);
      scope = { cards: ens.cards, connections: ens.connections };
      focusCardId = null;
      setCrumbs([{ label: `アンサンブル in ${stage.name}` }]);
      els.viewport.style.setProperty('--stage-ambience', hexToRgba(stage.color, 0.07));
      els.viewport.classList.add('canvas-viewport--ambience');
      buildOverlay();
      setTools([
        { id: 'text', label: '気づき', icon: '<path d="M5 6h14M12 6v13M9 19h6"/>', onClick: () => addTextCard() },
        { id: 'task', label: '課題', icon: '<path d="M9 11l2 2 4-4"/><rect x="4" y="4" width="16" height="16" rx="3"/>', onClick: () => addUserTask() },
        { id: 'audio', label: 'オーディオ', icon: '<path d="M4 12h2l2-6 3 12 3-9 2 3h4"/>', onClick: () => pickAudio() },
      ]);
      els.viewport.addEventListener('dragover', onDragOver);
      els.viewport.addEventListener('drop', onDrop);
      return true;
    },

    leave() {
      els.viewport.removeEventListener('dragover', onDragOver);
      els.viewport.removeEventListener('drop', onDrop);
      if (window.LyraMidi) window.LyraMidi.stopAll();
      if (window.LyraAudio) window.LyraAudio.stop();
    },

    buildCard(card, el) {
      el.classList.add('star-card--ens', `star-card--ens-${card.type}`);
      if (typeof card.tilt !== 'number') card.tilt = randomTilt();
      el.style.setProperty('rotate', `${card.type === 'speech' ? 0 : card.tilt}deg`);
      if (!card.width) el.style.width = `${defaultWidth(card)}px`;
      const builder = CARD_BUILDERS[card.type];
      if (builder) builder(card, el);
      else el.innerHTML = `<div class="ens-card-kind">${escapeHtml(card.type)}</div>`;
      if (card.id === focusCardId) el.classList.add('star-card--focus');
    },

    cardHexes(card) {
      const editable = card.type === 'text' || (card.type === 'task' && card.origin !== 'app');
      return (editable ? hexHtml('edit', 'Edit') : '') + hexHtml('astr') + hexHtml('delete', 'Delete');
    },

    onHexAction(action, card, el) {
      if (action === 'edit') startEditingCard(el);
      else if (action === 'delete') confirmDeleteCard(card);
    },

    onCardTap(card) {
      focusCardId = card.id;
      renderMembers();
      showCardPanel(card);
    },

    afterRender() {
      renderMembers();
    },

    onConnectionsChanged() {
      renderMembers();
    },

    onCardMoved(card) {
      focusCardId = card.id;
      renderMembers();
    },
  };

  function defaultWidth(card) {
    if (card.type === 'speech') return 360;
    if (card.type === 'soul') return 190;
    if (card.type === 'audio' || card.type === 'midi') return 210;
    return 180;
  }

  function randomTilt() {
    return Math.round((Math.random() * 4 - 2) * 10) / 10;
  }

  function hexToRgba(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  /* ---------------- カードの中身 ---------------- */

  function findParam(card) {
    const owner = getSoul(card.soulId);
    const p = owner && owner.params.find((x) => x.id === card.paramId);
    return { owner, p };
  }

  const CARD_BUILDERS = {
    text(card, el) {
      el.innerHTML =
        `<div class="ens-card-kind">気づき</div>` +
        `<textarea class="star-card-memo" spellcheck="false" data-field="text" placeholder="気づいたこと">${escapeHtml(card.text || '')}</textarea>`;
    },

    task(card, el) {
      const fromApp = card.origin === 'app';
      el.classList.toggle('star-card--ens-task-app', fromApp);
      if (fromApp) {
        el.innerHTML =
          `<div class="ens-card-kind ens-card-kind--accent">課題 · アプリから${card.date ? ` · ${escapeHtml(card.date.slice(5).replace('-', '/'))}` : ''}</div>` +
          `<div class="ens-card-title">${escapeHtml(card.text || '')}</div>` +
          (card.reason ? `<div class="ens-card-sub">${escapeHtml(card.reason)}</div>` : '');
      } else {
        el.innerHTML =
          `<div class="ens-card-kind">課題 · あなたから</div>` +
          `<textarea class="star-card-memo" spellcheck="false" data-field="text" placeholder="いま取り組みたいこと">${escapeHtml(card.text || '')}</textarea>`;
      }
    },

    param(card, el) {
      const { owner, p } = findParam(card);
      el.classList.toggle('star-card--ens-missing', !p);
      el.innerHTML =
        `<div class="ens-card-kind">パラメータ · ${escapeHtml(owner ? owner.name : '(削除されたソウル)')}</div>` +
        `<div class="ens-card-title">${p && p.verified ? '' : '<span class="ens-dot-unverified"></span>'}${escapeHtml(p ? p.name : '(削除されたパラメータ)')}</div>`;
    },

    source(card, el) {
      const owner = getSoul(card.soulId);
      const src = owner && owner.sources.find((s) => s.id === card.sourceId);
      el.classList.toggle('star-card--ens-missing', !src);
      el.innerHTML =
        `<div class="ens-card-kind">出典 · ${escapeHtml(owner ? owner.name : '(削除されたソウル)')}</div>` +
        `<div class="ens-card-title">${escapeHtml(src ? src.title : '(外された資料)')}</div>` +
        (src && src.type === 'youtube' ? `<div class="ens-card-sub">▶ YouTube</div>` : '');
    },

    soul(card, el) {
      const owner = getSoul(card.soulId);
      el.style.setProperty('--soul-color', owner ? owner.color : '#b3a98f');
      const role = owner && owner.category === 'stage'
        ? `舞台のソウル · ${escapeHtml(owner.name)}(ゲスト参加)`
        : `${escapeHtml(owner ? categoryLabel(owner.category) : '')}のソウル`;
      const vocab = owner && owner.vocabulary && owner.vocabulary.find((v) => v.meaning && !v.meaning.includes('手持ちの知識なし'));
      el.innerHTML =
        `<div class="ens-card-soulhead">${owner ? soulOrbSvg(owner, 20) : ''}<span>${role}</span></div>` +
        `<div class="ens-card-title">${escapeHtml(owner ? owner.name : '(削除されたソウル)')}</div>` +
        (vocab ? `<div class="ens-card-sub">${escapeHtml(vocab.term)}: ${escapeHtml(vocab.meaning)}</div>` : '');
    },

    speech(card, el) {
      const members = (card.memberIds || []).map((id) => getSoul(id)).filter(Boolean);
      const avatars = members.map((s) => soulOrbSvg(s, 22)).join('');
      const names = members.map((s) => `${s.name}のソウル`).join(' & ');
      const voices = (card.voices || [])
        .map((v) => {
          const s = v.speaker === THEORY_ID ? null : getSoul(v.speaker);
          const label = v.speaker === THEORY_ID ? '楽典' : s ? s.name : '?';
          const color = v.speaker === THEORY_ID ? THEORY_COLOR : s ? shadeColor(s.color, -0.25) : THEORY_COLOR;
          return `<div class="speech-voice"><span class="speech-speaker" style="color:${color}">${escapeHtml(label)}:</span> ${escapeHtml(v.text)}</div>`;
        })
        .join('');
      const chain = card.chain
        ? `<div class="speech-chain">` +
          `<div><span class="speech-chain-label">コンセプト</span>${escapeHtml(card.chain.concept || '')}</div>` +
          `<div><span class="speech-chain-label">構造語彙</span>${escapeHtml(card.chain.structure || '')}</div>` +
          `<div><span class="speech-chain-label">操作</span>${escapeHtml((card.chain.operations || []).join(' / '))}</div></div>`
        : '';
      const feedback = card.feedback
        ? `<div class="speech-feedback speech-feedback--${card.feedback}">${card.feedback === 'worked' ? '効いた' : '効かなかった'} · ソウルに書き戻し済み</div>`
        : '';
      el.innerHTML =
        `<div class="speech-head"><div class="speech-avatars">${avatars}</div>` +
        `<span>自動招集 · ${escapeHtml(names || '楽典')}</span></div>` +
        voices + chain + feedback +
        `<div class="speech-actions">` +
        (card.recipe && card.recipe.length ? `<button type="button" class="btn-small" data-speech="recipe">レシピ</button>` : '') +
        `<button type="button" class="btn-small" data-speech="midi">MIDIにする</button>` +
        (card.feedback ? '' : `<button type="button" class="btn-small" data-speech="worked">効いた</button>` +
          `<button type="button" class="btn-small" data-speech="not">効かなかった</button>`) +
        `</div>`;
      el.querySelectorAll('[data-speech]').forEach((btn) => {
        btn.addEventListener('click', (event) => {
          event.stopPropagation();
          const action = btn.dataset.speech;
          if (action === 'recipe') showRecipe(card);
          else if (action === 'midi') makeMidiFromSpeech(card);
          else giveFeedback(card, action === 'worked' ? 'worked' : 'not');
        });
      });
    },

    midi(card, el) {
      if (window.LyraMidi) window.LyraMidi.buildCard(card, el);
      else el.innerHTML = `<div class="ens-card-kind">MIDI</div><div class="ens-card-title">${escapeHtml(card.name || '')}</div>`;
    },

    audio(card, el) {
      if (window.LyraAudio) window.LyraAudio.buildCard(card, el);
      else el.innerHTML = `<div class="ens-card-kind">オーディオ</div><div class="ens-card-title">${escapeHtml(card.name || '')}</div>`;
    },
  };

  /* ---------------- 浮遊UI: 見出しと招集パネル ---------------- */

  function buildOverlay() {
    els.overlay.classList.add('screen-overlay--ensemble');
    els.overlay.innerHTML =
      `<div class="ens-heading">` +
      `<div class="ens-title">アンサンブル · ${escapeHtml(stage.name)}</div>` +
      `<div class="ens-subtitle">偶然の接続から、必然の一手へ</div>` +
      `</div>` +
      `<div class="ens-members" id="ens-members"></div>`;
    renderMembers();
  }

  /** 線でつながったカードのまとまり(連結成分)の一覧。1枚だけのカードは含めない */
  function components() {
    const adj = new Map();
    scope.connections.forEach((c) => {
      if (!getCardById(c.cardIdA) || !getCardById(c.cardIdB)) return;
      if (!adj.has(c.cardIdA)) adj.set(c.cardIdA, []);
      if (!adj.has(c.cardIdB)) adj.set(c.cardIdB, []);
      adj.get(c.cardIdA).push(c.cardIdB);
      adj.get(c.cardIdB).push(c.cardIdA);
    });
    const seen = new Set();
    const result = [];
    adj.forEach((_, start) => {
      if (seen.has(start)) return;
      const comp = [];
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const id = stack.pop();
        comp.push(id);
        adj.get(id).forEach((n) => {
          if (!seen.has(n)) {
            seen.add(n);
            stack.push(n);
          }
        });
      }
      result.push(comp);
    });
    return result;
  }

  /** いま注目しているまとまり(カードIDの配列)。無ければnull */
  function focusComponent() {
    const comps = components();
    if (comps.length === 0) return null;
    if (focusCardId) {
      const hit = comps.find((c) => c.includes(focusCardId));
      if (hit) return hit;
    }
    const last = scope.connections[scope.connections.length - 1];
    return (last && comps.find((c) => c.includes(last.cardIdA))) || comps[comps.length - 1];
  }

  function ownerIdsOf(card) {
    if (card.type === 'speech') return [];
    if (card.type === 'midi' && card.memberIds) return card.memberIds;
    return card.soulId ? [card.soulId] : [];
  }

  /** まとまりに含まれるカードの持ち主のソウル(ホームの舞台自身は「場」なので除く) */
  function recruitedSouls(compIds) {
    const ids = new Set();
    compIds.forEach((id) => {
      const card = getCardById(id);
      if (card) ownerIdsOf(card).forEach((sid) => ids.add(sid));
    });
    ids.delete(stage.id);
    return [...ids].map((id) => getSoul(id)).filter(Boolean);
  }

  function renderMembers() {
    const wrap = document.getElementById('ens-members');
    if (!wrap) return;
    const comp = focusComponent();
    els.content.querySelectorAll('.star-card--in-focus').forEach((el) => el.classList.remove('star-card--in-focus'));
    if (!comp) {
      wrap.innerHTML =
        `<div class="ens-members-label">招集はここでは自動</div>` +
        `<div class="ens-members-text">カード同士をASTRで線につなぐと、つないだカードの持ち主のソウルが自動で招集されます。` +
        `別の舞台のソウルも、カードとして持ち込んでつなげばゲスト参加します。</div>`;
      return;
    }
    comp.forEach((id) => {
      const el = cardElById(id);
      if (el) el.classList.add('star-card--in-focus');
    });
    const souls = recruitedSouls(comp);
    const people = [
      `<span class="ens-member ens-member--stage">${soulOrbSvg(stage, 20)}<span>${escapeHtml(stage.name)}(場)</span></span>`,
      ...souls.map((s) => `<span class="ens-member">${soulOrbSvg(s, 20)}<span>${escapeHtml(s.name)}</span></span>`),
      `<span class="ens-member ens-member--theory"><span class="ens-member-theory-dot"></span><span>楽典</span></span>`,
    ];
    wrap.innerHTML =
      `<div class="ens-members-label">招集中 · つながった${comp.length}枚のカード</div>` +
      `<div class="ens-member-list">${people.join('')}</div>` +
      `<button type="button" class="btn-primary ens-listen" ${listening ? 'disabled' : ''}>${listening ? 'アンサンブルが話し合っています…' : 'アンサンブルを聴く'}</button>`;
    wrap.querySelector('.ens-listen').addEventListener('click', () => listen(comp));
  }

  /* ---------------- アンサンブルを聴く ---------------- */

  function cardLine(card) {
    switch (card.type) {
      case 'text':
        return card.text ? `[気づき] ${card.text}` : null;
      case 'task':
        return card.text ? `[課題 · ${card.origin === 'app' ? 'アプリから' : 'あなたから'}] ${card.text}${card.reason ? `(${card.reason})` : ''}` : null;
      case 'param': {
        const { owner, p } = findParam(card);
        if (!p) return null;
        const r = p.readings.find((x) => x.effect) || p.readings[0] || {};
        return `[パラメータ · ${owner.name} / ${p.name}] 効果: ${r.effect || '(未記入)'} 意図: ${r.intent || '(未記入)'}` +
          (p.analog ? ` 奏法対応の仮説: ${p.analog}` : '') + (p.verified ? '(確認済み)' : '(未確認)');
      }
      case 'source': {
        const owner = getSoul(card.soulId);
        const src = owner && owner.sources.find((s) => s.id === card.sourceId);
        return src ? `[出典 · ${owner.name}] ${src.title}` : null;
      }
      case 'soul': {
        const owner = getSoul(card.soulId);
        return owner ? `[ソウル] ${owner.name}(${categoryLabel(owner.category)})` : null;
      }
      case 'midi':
        return window.LyraMidi ? window.LyraMidi.describe(card) : `[MIDI] ${card.name}`;
      case 'audio':
        return `[オーディオ] ${card.name}${card.duration ? `(${Math.round(card.duration)}秒)` : ''}`;
      case 'speech':
        return null;
      default:
        return null;
    }
  }

  /**
   * ソウル1体ぶんの「手持ちの知識」。解体した全パラメータをモジュールごとにまとめて渡す。
   * 線でつながったカードに出てくるパラメータは詳しく(説明全文・奏法対応・気づき)、他は短く(効果80字・意図40字)。
   * 2026-09-25: 以前は「他」を先頭40件に切っていたため、Serum2(229件)では後ろのモジュールが
   * ソウルから見えなかった。全件でも1〜2万トークン程度で、無料枠でも問題なく送れる。
   */
  function soulMaterial(soul, focusParamIds) {
    const vocab = (soul.vocabulary || []).map((v) => `${v.term}=${v.meaning}`).join('; ');
    const cut = (text, max) => {
      const t = String(text || '').trim();
      return t.length > max ? `${t.slice(0, max)}…` : t;
    };
    const line = (p) => {
      const r = p.readings.find((x) => x.effect) || p.readings[0] || {};
      const head = `     - ${p.verified ? '✓' : ''}${p.name}${p.range ? ` [${p.range}]` : ''}`;
      if (focusParamIds.has(p.id)) {
        return `${head}: ${r.effect || '(説明なし)'}` +
          (r.intent ? ` 意図: ${r.intent}` : '') +
          (p.analog ? ` 奏法対応: ${p.analog}` : '') +
          (p.notes.length ? ` 気づき: ${p.notes.slice(-3).map((n) => n.text).join(' / ')}` : '');
      }
      return `${head}: ${cut(r.effect, 80) || '(説明なし)'}` +
        (r.intent ? ` / 意図: ${cut(r.intent, 40)}` : '') +
        (p.notes.length ? ` / 気づき: ${cut(p.notes[p.notes.length - 1].text, 60)}` : '');
    };
    const groups = soul.modules
      .map((m) => {
        const params = soul.params.filter((p) => p.moduleId === m.id);
        return params.length ? `   [${modulePath(m)}]\n${params.map(line).join('\n')}` : '';
      })
      .filter(Boolean);
    const notes = soul.notes.slice(-5).map((n) => `   - ${n.text}`).join('\n');
    return (vocab ? `  共通語彙: ${vocab}\n` : '') +
      `  手持ちの知識(✓は実機で確認済み、それ以外は資料から抽出しただけの未確認):\n${groups.join('\n') || '   (まだ解体した知識がない)'}` +
      (notes ? `\n  このソウルへの気づき:\n${notes}` : '');
  }

  function previousSpeech(compIds) {
    const set = new Set(compIds);
    const prev = scope.cards
      .filter((c) => c.type === 'speech' && (c.triggerCardIds || []).some((id) => set.has(id)))
      .slice(-1)[0];
    if (!prev) return '';
    const fb = prev.feedback === 'worked' ? '(ユーザーの評価: 効いた)' : prev.feedback === 'not' ? '(ユーザーの評価: 効かなかった)' : '';
    return `\n前回このカードたちで話した内容${fb}: ${prev.chain ? `${prev.chain.concept} → ${prev.chain.structure} → ${(prev.chain.operations || []).join(' / ')}` : ''}\n`;
  }

  function buildPrompt(compIds, souls) {
    const cards = compIds.map((id) => getCardById(id)).filter(Boolean);
    const cardLines = cards.map(cardLine).filter(Boolean).map((l) => `- ${l}`).join('\n');
    const focusParamIds = new Set(cards.filter((c) => c.type === 'param').map((c) => c.paramId));
    const speakers = souls.map((s, i) => ({ key: `S${i + 1}`, soul: s }));
    const soulBlocks = speakers
      .map(({ key, soul }) => `[${key}] ${soul.name}(${categoryLabel(soul.category)}${soul.category === 'stage' ? '、ゲスト参加の舞台' : ''})\n${soulMaterial(soul, focusParamIds)}`)
      .join('\n\n');
    const stageBlock = `[STAGE] ${stage.name}(この場=ホームの舞台)\n${soulMaterial(stage, focusParamIds)}`;
    const prompt = `あなたは作曲支援アプリLYRAの「アンサンブル」です。ユーザーはCubase Pro 15とMax 9で作曲しています。
ユーザーが線でつないだカードを見て、招集された専門家(ソウル)たちがそれぞれの立場から短く発言し、次の一手を提案します。

ユーザーがつないだカード:
${cardLines || '(内容のないカード)'}
${previousSpeech(compIds)}
参加者:
${stageBlock}

${soulBlocks}

[${THEORY_ID}] 楽典(汎用の音楽理論の専門家)。一般的な楽典・音楽理論の知識を使ってよい。

ルール:
1. S1, S2… と STAGE は、それぞれの「手持ちの知識」に書かれていることだけを根拠に話す。手持ちにないプラグイン・機能・数値を持ち出さない。根拠がなければ「手持ちの知識では言えない」と正直に言う
2. ${THEORY_ID} だけは一般知識を使ってよいが、特定のプラグインや製品の機能には触れない
3. STAGE は「この部屋(${stage.name})で鳴らす前提」での助言をする
4. voices の speaker には上の角括弧の記号(${[...speakers.map((s) => s.key), 'STAGE', THEORY_ID].join(', ')})だけを使う。1人1回、各${VOICE_MAX - 30}字以内。互いの発言に反応してよい。全員が話す必要はない
5. chain は「楽曲コンセプト・文脈(concept) → 星図の構造語彙(structure: 密度・明度・動き・空間・緊張・滲み・間・揺らぎ などで) → 具体的な音色・操作(operations)」の3段階
6. recipe は、MIDIで表せない離散選択式のパラメータやマクロの設定を value と一言の intent で。soul にはそのパラメータを持つソウルの記号(S1 など)、module には手持ちの知識の [ ] 内の表記、param にはその下のパラメータ名を、どちらも一字一句そのまま書く。発言の中でパラメータに触れる時も「FXタブのUTILITY」のように場所を添える。手持ちの知識に載っていない名前(フィルターの種類名など)を param にしない。選択肢の値は value に書く(例: param「FILTER TYPE」value「LPF」)。無ければ空の配列
7. 資料の文章を長く引用しない。自分の言葉で短く`;
    return { prompt, speakers };
  }

  async function listen(compIds) {
    if (listening) return;
    const souls = recruitedSouls(compIds);
    const { prompt, speakers } = buildPrompt(compIds, souls);
    listening = true;
    renderMembers();
    setStatus('アンサンブルが話し合っています…', { busy: true });
    const targetStage = stage;
    try {
      const result = await askGeminiJson({ prompt, responseSchema: SPEECH_SCHEMA, maxOutputTokens: 4096 });
      const idOf = (speaker) => {
        if (speaker === 'STAGE') return targetStage.id;
        if (speaker === THEORY_ID || speaker === '楽典') return THEORY_ID;
        const hit = speakers.find((s) => s.key === speaker);
        return hit ? hit.soul.id : THEORY_ID;
      };
      const card = {
        id: newId(),
        type: 'speech',
        voices: (result.voices || []).map((v) => ({ speaker: idOf(v.speaker), text: String(v.text || '').slice(0, VOICE_MAX) })),
        chain: result.chain || null,
        recipe: (result.recipe || []).slice(0, 12).map((r) => resolveRecipeItem(r, idOf(r.soul), souls)),
        memberIds: [targetStage.id, ...souls.map((s) => s.id)],
        triggerCardIds: compIds.slice(),
        feedback: null,
        tilt: 0,
        width: 360,
        height: null,
        createdAt: new Date().toISOString(),
      };
      const pos = speechPosition(compIds);
      card.x = pos.x;
      card.y = pos.y;
      const ens = getEnsemble(targetStage.id);
      ens.cards.push(card);
      scheduleAutoSave();
      setStatus('アンサンブルが話しました');
      if (stage === targetStage && currentRoute.screen === 'ensemble') {
        renderCard(card);
        const el = cardElById(card.id);
        if (el) {
          const c = getCardCenterFromEl(el);
          animateViewportTo(c.x, c.y);
          el.classList.add('star-card--found');
        }
      }
    } catch (err) {
      console.error(err);
      setStatus(`アンサンブルを聴けませんでした: ${err.message}`, { important: true });
    } finally {
      listening = false;
      renderMembers();
    }
  }

  /** 発言カードの置き場所: まとまりの右上あたり */
  function speechPosition(compIds) {
    let maxX = -Infinity;
    let minY = Infinity;
    compIds.forEach((id) => {
      const card = getCardById(id);
      if (!card) return;
      maxX = Math.max(maxX, (card.x || 0) + (card.width || 180));
      minY = Math.min(minY, card.y || 0);
    });
    if (!isFinite(maxX)) return newCardSpawnPos();
    return { x: maxX + 40, y: minY - 40 };
  }

  /* ---------------- 発言カードの操作 ---------------- */

  /* ---- パラメータレシピ ----
   * 2026-09-25: 「UNISON: 4」「LPF: 3kHz」だけではプラグインのどこの何か分かりにくい、という実機の指摘を受け、
   * Geminiにソウル・モジュール・パラメータ名を解体した時の表記どおりに出させ、アプリ側で実際のパラメータと
   * 突き合わせる(一致したものはソウル画面の該当パラメータへ飛べる。一致しないものはそう明示する)。 */

  function normalizeKey(text) {
    return String(text || '').toLowerCase().replace(/[\s_\-・/]/g, '');
  }

  /** レシピの1行を実際のパラメータと突き合わせる。soulIdが分からなければ招集された全ソウルから探す */
  function resolveRecipeItem(item, soulId, candidates) {
    const souls = candidates.filter((s) => !soulId || s.id === soulId);
    const pool = souls.length ? souls : candidates;
    const key = normalizeKey(item.param);
    const moduleKey = normalizeKey(item.module);
    // module は「FXタブ › UTILITY」の形でも「UTILITY」だけでも来うるので、どちらでも一致とみなす
    const sameModule = (m) => {
      const name = normalizeKey(m.name);
      return name === moduleKey || normalizeKey(modulePath(m)) === moduleKey || (moduleKey && moduleKey.endsWith(name));
    };
    let hit = null;
    for (const s of pool) {
      const matches = s.params.filter((p) => normalizeKey(p.name) === key);
      if (!matches.length) continue;
      const inModule = matches.find((p) => {
        const m = s.modules.find((x) => x.id === p.moduleId);
        return m && sameModule(m);
      });
      hit = { soul: s, param: inModule || matches[0] };
      break;
    }
    const hitModule = hit ? hit.soul.modules.find((m) => m.id === hit.param.moduleId) : null;
    return {
      param: String(item.param || ''),
      value: String(item.value || ''),
      intent: String(item.intent || ''),
      moduleName: hitModule ? modulePath(hitModule) : String(item.module || ''),
      soulId: hit ? hit.soul.id : soulId && soulId !== THEORY_ID ? soulId : null,
      paramId: hit ? hit.param.id : null,
    };
  }

  /** 古い発言カード(ソウル・モジュールを持たないレシピ)は、表示の時に招集メンバーから探し直す */
  function recipeItems(card) {
    const members = (card.memberIds || []).map((id) => getSoul(id)).filter(Boolean);
    return (card.recipe || []).map((r) => {
      if (!r.paramId && !r.moduleName) return resolveRecipeItem(r, r.soulId || null, members);
      // 一致済みの行は、今のモジュールの場所(あとから整理されたUI上の場所)で表示し直す
      const s = r.soulId ? getSoul(r.soulId) : null;
      const p = s && r.paramId ? s.params.find((x) => x.id === r.paramId) : null;
      const m = p ? s.modules.find((x) => x.id === p.moduleId) : null;
      return m ? { ...r, moduleName: modulePath(m) } : r;
    });
  }

  function recipeLine(r) {
    const s = r.soulId ? getSoul(r.soulId) : null;
    const where = [s ? s.name : '', r.moduleName].filter(Boolean).join(' / ');
    return `${where ? `${where} / ` : ''}${r.param}: ${r.value}${r.intent ? ` — ${r.intent}` : ''}${r.paramId ? '' : '(手持ちのパラメータと一致せず)'}`;
  }

  function showRecipe(card) {
    const items = recipeItems(card);
    // ソウル → モジュールの順にまとめて表示する
    const groups = [];
    items.forEach((r) => {
      const key = `${r.soulId || ''}|${r.moduleName || ''}`;
      let g = groups.find((x) => x.key === key);
      if (!g) {
        g = { key, soul: r.soulId ? getSoul(r.soulId) : null, moduleName: r.moduleName, items: [] };
        groups.push(g);
      }
      g.items.push(r);
    });
    const body = groups
      .map((g) => `<div class="recipe-group">` +
        `<div class="recipe-where">${g.soul ? soulOrbSvg(g.soul, 16) : ''}<span>${escapeHtml(g.soul ? g.soul.name : '(ソウル不明)')}</span>` +
        `${g.moduleName ? `<span class="recipe-sep">›</span><span>${escapeHtml(g.moduleName)}</span>` : ''}</div>` +
        g.items.map((r) => {
          const inner = `<div class="recipe-row-main"><span class="recipe-param">${escapeHtml(r.param)}</span>` +
            `<span class="recipe-value">${escapeHtml(r.value)}</span></div>` +
            (r.intent ? `<div class="recipe-intent">${escapeHtml(r.intent)}</div>` : '') +
            (r.paramId ? '' : `<div class="recipe-miss">手持ちのパラメータ名と一致しませんでした(資料での表記と違う名前の可能性があります)</div>`);
          const p = r.paramId && g.soul ? g.soul.params.find((x) => x.id === r.paramId) : null;
          return p
            ? `<a class="recipe-row recipe-row--link" href="#/soul/${encodeURIComponent(g.soul.id)}/${encodeURIComponent(p.moduleId)}/${encodeURIComponent(p.id)}" title="ソウル画面でこのパラメータを開く">${inner}</a>`
            : `<div class="recipe-row">${inner}</div>`;
        }).join('') +
        `</div>`)
      .join('');
    const panel = openSidePanel(
      `<div class="panel-head"><div class="panel-title-wrap"><div class="panel-title">パラメータレシピ</div>` +
      `<div class="panel-sub">MIDIで表せない設定の一覧。行をタップすると、そのパラメータをソウル画面で開きます</div></div>` +
      `<button type="button" class="panel-close" aria-label="閉じる">×</button></div>` +
      body +
      `<div class="panel-actions"><button type="button" class="btn-primary" data-action="copy">テキストでコピー</button></div>`
    );
    panel.querySelector('.panel-close').addEventListener('click', closeSidePanel);
    panel.querySelector('[data-action="copy"]').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(items.map(recipeLine).join('\n'));
        setStatus('レシピをコピーしました');
      } catch (err) {
        setStatus('コピーできませんでした(ブラウザが許可していません)', { important: true });
      }
    });
  }

  function makeMidiFromSpeech(card) {
    if (!window.LyraMidi) {
      setStatus('MIDIの機能を読み込めていません');
      return;
    }
    window.LyraMidi.createFromSpeech(card, stage);
  }

  /**
   * 「効いた/効かなかった」をソウルへ書き戻す(ハンドオフ6節の成長軸「検証」)。
   * 招集されたソウル全体への気づきと、まとまりに含まれていたパラメータの気づきに残す。
   */
  async function giveFeedback(card, outcome) {
    const values = await showFormDialog({
      title: outcome === 'worked' ? '効いた' : '効かなかった',
      message: 'ひとことあれば残してください(招集されたソウルと、つないだパラメータに気づきとして書き戻します)。',
      submitLabel: '書き戻す',
      fields: [{ name: 'comment', label: 'ひとこと(任意)', type: 'textarea' }],
    });
    if (!values) return;
    const date = formatDate(new Date().toISOString());
    const summary = card.chain ? `${card.chain.concept} → ${(card.chain.operations || []).join(' / ')}` : '';
    const text = `アンサンブル in ${stage.name}(${date})で試した「${summary}」→ ${outcome === 'worked' ? '効いた' : '効かなかった'}` +
      (values.comment ? `。${values.comment}` : '');
    const now = new Date().toISOString();
    (card.memberIds || []).forEach((id) => {
      const s = getSoul(id);
      if (s) s.notes.push({ id: newId(), text, createdAt: now, origin: 'ensemble' });
    });
    (card.triggerCardIds || []).forEach((id) => {
      const c = getCardById(id);
      if (!c || c.type !== 'param') return;
      const { p } = findParam(c);
      if (p) p.notes.push({ id: newId(), text, createdAt: now, origin: 'ensemble' });
    });
    card.feedback = outcome;
    scheduleAutoSave();
    rerenderCard(card);
    setStatus('ソウルに書き戻しました');
  }

  function rerenderCard(card) {
    const el = cardElById(card.id);
    if (el) {
      deactivateEditGuide(el);
      el.remove();
    }
    card.height = null;
    renderCard(card);
    redrawAsterismLines();
  }

  /* ---------------- カードの詳細パネル ---------------- */

  function youtubeId(url) {
    const m = String(url || '').match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/);
    return m ? m[1] : null;
  }

  function showCardPanel(card) {
    const head = (title, sub) => `<div class="panel-head"><div class="panel-title-wrap"><div class="panel-title">${title}</div>` +
      (sub ? `<div class="panel-sub">${sub}</div>` : '') +
      `</div><button type="button" class="panel-close" aria-label="閉じる">×</button></div>`;
    let html = null;
    let soulLink = null;

    if (card.type === 'param') {
      const { owner, p } = findParam(card);
      if (!p) return;
      const m = owner.modules.find((x) => x.id === p.moduleId);
      soulLink = `#/soul/${encodeURIComponent(owner.id)}/${encodeURIComponent(p.moduleId)}`;
      html = head(escapeHtml(p.name), `${escapeHtml(owner.name)} · ${escapeHtml(m ? modulePath(m) : '')}${p.range ? ` · ${escapeHtml(p.range)}` : ''}`) +
        p.readings.map((r) => `<div class="panel-section">` +
          (p.readings.length > 1 ? `<div class="reading-source">${escapeHtml(sourceTitle(owner, r))}</div>` : '') +
          `<div class="panel-label">音響的効果</div><div class="panel-readonly">${escapeHtml(r.effect || '(未記入)')}</div>` +
          `<div class="panel-label">音楽的意図</div><div class="panel-readonly">${escapeHtml(r.intent || '(未記入)')}</div></div>`).join('') +
        (p.analog ? `<div class="analog-box"><div class="panel-label panel-label--accent">実楽器の奏法対応</div><div class="panel-readonly">${escapeHtml(p.analog)}</div></div>` : '');
    } else if (card.type === 'source') {
      const owner = getSoul(card.soulId);
      const src = owner && owner.sources.find((s) => s.id === card.sourceId);
      if (!src) return;
      soulLink = `#/soul/${encodeURIComponent(owner.id)}`;
      const yt = src.type === 'youtube' ? youtubeId(src.url) : null;
      html = head(escapeHtml(src.title), `出典 · ${escapeHtml(owner.name)}`) +
        (yt ? `<div class="yt-embed"><iframe src="https://www.youtube-nocookie.com/embed/${yt}" title="YouTube" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe></div>` : '') +
        (src.url ? `<div class="panel-section"><a class="source-url" href="${escapeHtml(src.url)}" target="_blank" rel="noopener">${escapeHtml(src.url)}</a></div>` : '') +
        (src.decomposedAt ? `<div class="panel-empty">${formatDate(src.decomposedAt)}に解体 · ${src.extractedCount}件</div>` : '');
    } else if (card.type === 'soul') {
      const owner = getSoul(card.soulId);
      if (!owner) return;
      soulLink = `#/soul/${encodeURIComponent(owner.id)}`;
      const prog = soulProgress(owner);
      html = head(`${escapeHtml(owner.name)}のソウル`, `${escapeHtml(categoryLabel(owner.category))} · 解体の進行 ${Math.round(prog.ratio * 100)}%`) +
        ((owner.vocabulary || []).length
          ? `<div class="panel-section"><div class="panel-label">共通語彙</div>${owner.vocabulary.map((v) => `<div class="vocab-row"><div class="vocab-term">${escapeHtml(v.term)}</div><div class="panel-readonly">${escapeHtml(v.meaning)}</div></div>`).join('')}</div>`
          : '');
    } else if (card.type === 'task' && card.origin === 'app') {
      const { owner, p } = findParam(card);
      if (owner && p) soulLink = `#/soul/${encodeURIComponent(owner.id)}/${encodeURIComponent(p.moduleId)}`;
      html = head('今日の課題', 'アプリから') +
        `<div class="panel-section"><div class="panel-readonly">${escapeHtml(card.text || '')}</div></div>` +
        (card.reason ? `<div class="panel-section"><div class="panel-label">なぜ今日これを</div><div class="panel-readonly">${escapeHtml(card.reason)}</div></div>` : '') +
        (p ? `<div class="panel-empty">試したら、ソウル画面で「確認済みにする」を押すと進行度が育ちます。</div>` : '');
    } else if (card.type === 'midi' && window.LyraMidi) {
      html = window.LyraMidi.panelHtml(card);
    } else if (card.type === 'audio' && window.LyraAudio) {
      html = window.LyraAudio.panelHtml(card);
    }
    if (!html) {
      closeSidePanel();
      return;
    }
    const panel = openSidePanel(
      html +
      `<div class="panel-actions">` +
      (soulLink ? `<a class="btn-secondary" href="${soulLink}">ソウルで開く</a>` : '') +
      `</div>`
    );
    panel.querySelector('.panel-close').addEventListener('click', closeSidePanel);
    if (card.type === 'midi' && window.LyraMidi) window.LyraMidi.bindPanel(panel, card);
    if (card.type === 'audio' && window.LyraAudio) window.LyraAudio.bindPanel(panel, card);
  }

  function sourceTitle(owner, reading) {
    if (!reading.sourceId) return '手入力';
    const src = owner.sources.find((s) => s.id === reading.sourceId);
    return `${src ? src.title : '(外された資料)'}${reading.page ? ` ${reading.page}` : ''}`;
  }

  /* ---------------- カードの追加・削除 ---------------- */

  function pushCard(fields) {
    const pos = newCardSpawnPos();
    const card = {
      id: newId(),
      x: pos.x - 90,
      y: pos.y - 30,
      width: null,
      height: null,
      tilt: randomTilt(),
      createdAt: new Date().toISOString(),
      ...fields,
    };
    scope.cards.push(card);
    const el = renderCard(card);
    scheduleAutoSave();
    return { card, el };
  }

  function addTextCard() {
    const { el } = pushCard({ type: 'text', text: '' });
    startEditingCard(el);
  }

  function addUserTask() {
    const { el } = pushCard({ type: 'task', origin: 'user', text: '' });
    startEditingCard(el);
  }

  async function pickAudio() {
    if (!window.LyraAudio) return;
    const file = await pickFile('audio/*,.wav,.mp3,.m4a,.aif,.aiff,.flac,.ogg');
    if (file) window.LyraAudio.importFile(file, stage, newCardSpawnPos());
  }

  function onDragOver(event) {
    if ([...(event.dataTransfer?.items || [])].some((i) => i.kind === 'file')) event.preventDefault();
  }

  function onDrop(event) {
    const files = [...(event.dataTransfer?.files || [])].filter((f) => f.type.startsWith('audio/') || /\.(wav|aiff?|mp3|m4a|flac|ogg)$/i.test(f.name));
    if (!files.length || !window.LyraAudio) return;
    event.preventDefault();
    const pos = clientToContent(event.clientX, event.clientY);
    files.forEach((f, i) => window.LyraAudio.importFile(f, stage, { x: pos.x + i * 30, y: pos.y + i * 30 }));
  }

  async function confirmDeleteCard(card) {
    const choice = await showChoiceDialog({
      title: 'このカードを削除しますか?',
      message: card.type === 'param' || card.type === 'soul' || card.type === 'source'
        ? 'アンサンブルからカードを外します(ソウル側の記録はそのまま残ります)。'
        : card.type === 'audio'
          ? 'カードとそこから伸びている線が消えます。Driveに保存した音声の実体は残ります。'
          : 'カードとそこから伸びている線が消えます。',
      options: [
        { label: 'やめる', value: 'cancel', secondary: true },
        { label: '削除する', value: 'delete', danger: true },
      ],
    });
    if (choice !== 'delete') return;
    if (focusCardId === card.id) focusCardId = null;
    removeCardFromScope(card);
    closeSidePanel();
    renderMembers();
    setStatus('削除しました');
    scheduleAutoSave();
  }

  /** 他のファイル(js/midi.js・js/audio.js・js/daily.js)から、今開いているアンサンブルへカードを足すための入口 */
  function addCardToEnsemble(targetStage, card) {
    const ens = getEnsemble(targetStage.id);
    ens.cards.push(card);
    scheduleAutoSave();
    if (stage === targetStage && currentRoute && currentRoute.screen === 'ensemble') {
      renderCard(card);
      renderMembers();
    }
  }

  function refreshEnsembleCard(card) {
    if (currentRoute && currentRoute.screen === 'ensemble' && cardElById(card.id)) rerenderCard(card);
  }

  /** アプリ側から2枚のカードを線でつなぐ(MIDIの改善版を元のカードにつなぐ時など) */
  function connectEnsembleCards(targetStage, cardIdA, cardIdB) {
    const ens = getEnsemble(targetStage.id);
    const connection = { id: newId(), cardIdA, cardIdB, auto: true };
    ens.connections.push(connection);
    scheduleAutoSave();
    if (stage === targetStage && currentRoute && currentRoute.screen === 'ensemble') {
      redrawAsterismLines();
      flashConnectedLine(connection.id);
      focusCardId = cardIdB;
      renderMembers();
    }
  }

  window.addCardToEnsemble = addCardToEnsemble;
  window.connectEnsembleCards = connectEnsembleCards;
  window.refreshEnsembleCard = refreshEnsembleCard;
  LYRA.screens.ensemble = screen;
})();
