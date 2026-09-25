// LYRA — アンサンブル画面(ハンドオフ4.3節)。舞台のソウルごとに1つ(「アンサンブル in 〇〇」)。
// 自由配置キャンバスに、パラメータ・気づき・出典・オーディオ・MIDI・課題カードが散らばる。
// 接続(Asterism)は手動。招集(どのソウルが参加するか)だけが自動で、繋いだカードの持ち主の
// ソウルが招集される。発言は「アンサンブルを聴く」ボタンを押した時だけ(2026-09-25決定)。
//
// 背景は白基調+五線譜の罫線に、ホームの舞台自身の色をごく薄く敷く(舞台ごとの暖色アンビエンス)。

(function () {
  // カード種別ごとの見出し・見た目。段階を追って種類を増やしていく
  const KIND_LABELS = {
    text: '気づき',
  };

  let stage = null;

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
      setCrumbs([{ label: `アンサンブル in ${stage.name}` }]);
      els.ensembleNavBtn.classList.add('nav-link--active');
      els.viewport.style.setProperty('--stage-ambience', hexToRgba(stage.color, 0.07));
      els.viewport.classList.add('canvas-viewport--ambience');
      buildOverlay();
      setTools([
        {
          id: 'text',
          label: '気づき',
          icon: '<path d="M5 6h14M12 6v13M9 19h6"/>',
          onClick: () => createTextCard(''),
        },
      ]);
      return true;
    },

    leave() {
      els.ensembleNavBtn.classList.remove('nav-link--active');
    },

    buildCard(card, el) {
      el.classList.add('star-card--ens', `star-card--ens-${card.type}`);
      if (!card.width) el.style.width = card.type === 'soul' ? '190px' : '180px';
      if (typeof card.tilt !== 'number') card.tilt = randomTilt();
      el.style.setProperty('rotate', `${card.tilt}deg`);
      if (card.type === 'text') {
        el.innerHTML =
          `<div class="ens-card-kind">${escapeHtml(KIND_LABELS.text)}</div>` +
          `<textarea class="star-card-memo" spellcheck="false" data-field="text" placeholder="気づいたこと">${escapeHtml(card.text || '')}</textarea>`;
        return;
      }
      const owner = getSoul(card.soulId);
      if (card.type === 'param') {
        const p = owner && owner.params.find((x) => x.id === card.paramId);
        el.classList.toggle('star-card--ens-missing', !p);
        el.innerHTML =
          `<div class="ens-card-kind">パラメータ · ${escapeHtml(owner ? owner.name : '(削除されたソウル)')}</div>` +
          `<div class="ens-card-title">${escapeHtml(p ? p.name : '(削除されたパラメータ)')}</div>`;
        return;
      }
      if (card.type === 'soul') {
        el.style.setProperty('--soul-color', owner ? owner.color : '#b3a98f');
        const role = owner && owner.category === 'stage' ? `舞台のソウル · ${escapeHtml(owner.name)}(ゲスト参加)` : `${escapeHtml(owner ? categoryLabel(owner.category) : '')}のソウル`;
        el.innerHTML =
          `<div class="ens-card-soulhead">${owner ? soulOrbSvg(owner, 20) : ''}<span>${role}</span></div>` +
          `<div class="ens-card-title">${escapeHtml(owner ? owner.name : '(削除されたソウル)')}</div>`;
        return;
      }
      el.innerHTML = `<div class="ens-card-kind">${escapeHtml(card.type)}</div>`;
    },

    cardHexes(card) {
      return (card.type === 'text' ? hexHtml('edit', 'Edit') : '') + hexHtml('astr') + hexHtml('delete', 'Delete');
    },

    onCardTap(card) {
      // パラメータ・ソウルのカードは、タップで持ち主のソウル画面の該当箇所へ
      const owner = getSoul(card.soulId);
      if (!owner) return;
      if (card.type === 'param') {
        const p = owner.params.find((x) => x.id === card.paramId);
        if (p) navigate(`#/soul/${encodeURIComponent(owner.id)}/${encodeURIComponent(p.moduleId)}`);
      } else if (card.type === 'soul') {
        navigate(`#/soul/${encodeURIComponent(owner.id)}`);
      }
    },

    onHexAction(action, card, el) {
      if (action === 'edit') startEditingCard(el);
      else if (action === 'delete') confirmDeleteCard(card);
    },
  };

  function buildOverlay() {
    els.overlay.classList.add('screen-overlay--ensemble');
    els.overlay.innerHTML =
      `<div class="ens-heading">` +
      `<div class="ens-title">アンサンブル · ${escapeHtml(stage.name)}</div>` +
      `<div class="ens-subtitle">偶然の接続から、必然の一手へ</div>` +
      `</div>`;
  }

  function randomTilt() {
    return Math.round((Math.random() * 4 - 2) * 10) / 10;
  }

  function hexToRgba(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  function createTextCard(text) {
    const pos = newCardSpawnPos();
    const card = {
      id: newId(),
      type: 'text',
      x: pos.x - 100,
      y: pos.y - 40,
      width: 200,
      height: null,
      text: text || '',
      tilt: randomTilt(),
      createdAt: new Date().toISOString(),
    };
    scope.cards.push(card);
    const el = renderCard(card);
    scheduleAutoSave();
    if (!card.text) startEditingCard(el);
    return card;
  }

  async function confirmDeleteCard(card) {
    const choice = await showChoiceDialog({
      title: 'このカードを削除しますか?',
      message: 'カードとそこから伸びている線が消えます。',
      options: [
        { label: 'やめる', value: 'cancel', secondary: true },
        { label: '削除する', value: 'delete', danger: true },
      ],
    });
    if (choice !== 'delete') return;
    removeCardFromScope(card);
    setStatus('削除しました');
    scheduleAutoSave();
  }

  LYRA.screens.ensemble = screen;
})();
