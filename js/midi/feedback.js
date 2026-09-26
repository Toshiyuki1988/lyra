// LYRA — MIDIカードの★評価と、それをそのまま次の生成へのフィードバックにする仕組み。
//
// 2026-09-26追加(ユーザー要望「カードに最大5個の星ボタンを実装して、ユーザーが評価できるようにして。星をつけたらそれが
// そのままフィードバックになるよう設計して」)。コメントを書かなくても、星を付けるだけで次の生成が変わるようにする:
//   - MIDIカード(BEATも)とパネルに ★1〜5。同じ星をもう一度押すと評価を外す。card.rating に残す
//   - 星を付けた時点で、そのカードの設計図の要約(モデル・音高・層と生成器のパラメータ・時間の設計図・ゲージ)を
//     state.prefs.midiRatings(Driveに保存。最大80件)に記録する。カードを消しても記録は残る
//   - 次に同じモデルで作る時、★4〜5の要約を「寄せる傾向」、★1〜2の要約を「避ける傾向」としてプロンプトに入れる
//     (呼び出しは増やさない。同じモデルの評価が無ければ、ほかのモデルの★5を好みの手がかりとして少しだけ渡す)
//   - 生成前の質問のゲージの初期値は、そのモデルの★4以上の平均にする
//   - モデルのピッカーに、モデルごとの平均の星と件数を出す。作り直しでは、元のカードの星も伝える
//   - アンサンブルへの説明(describe)にも評価を添える

(function () {
  const M = (window.LyraMidi = window.LyraMidi || {});
  const T = window.LyraTheory;
  const P = window.LyraPresets;
  const MAX_LOG = 80;

  const log = () => {
    if (!Array.isArray(state.prefs.midiRatings)) state.prefs.midiRatings = [];
    return state.prefs.midiRatings;
  };
  const ratingOf = (card) => (Number.isInteger(card.rating) && card.rating >= 1 && card.rating <= 5 ? card.rating : 0);

  /** そのカードの設計図の要約(プロンプトに入れる。1件300字程度) */
  function digest(card) {
    const cur = M.designOf(card);
    if (!cur) return `${card.name}: テンポ${Math.round(card.midi.tempo)}、${card.midi.notes.length}音`;
    const d = cur.design;
    const parts = [
      `テンポ${Math.round(card.midi.tempo)}`,
      T.meterLabel(card.midi).length > 30 ? '変拍子' : T.meterLabel(card.midi),
      `音高 ${M.pitchLabel(d)}`,
      `層 ${d.layers.filter((l) => !l.muted).map((l) => `${l.name || l.generator}=${l.generator}(${M.paramSummary(l).slice(0, 70)})`).join(' / ')}`,
      d.arc ? `時間 ${d.arc.form}(緊張 ${d.arc.sections.map((x) => x.tension).join('→')})` : '',
      cur.gauges ? `ゲージ ${M.gaugeLabel(cur.gauges)}` : '',
      card.concept ? `コンセプト ${card.concept.slice(0, 50)}` : '',
      card.midi.edited ? '手で編集済み' : '',
    ].filter(Boolean);
    return parts.join('、').slice(0, 420);
  }

  /** 評価を付ける(同じ星なら外す)。記録を更新し、カードとパネルを描き直す */
  function setRating(card, n) {
    const next = ratingOf(card) === n ? 0 : n;
    card.rating = next || null;
    const list = log();
    const i = list.findIndex((x) => x.cardId === card.id);
    if (i >= 0) list.splice(i, 1);
    if (next) {
      const cur = M.designOf(card);
      list.push({
        cardId: card.id,
        model: cur ? cur.model : 'gakuten',
        rating: next,
        name: card.name,
        digest: digest(card),
        gauges: cur && cur.gauges ? { ...cur.gauges } : null,
        at: new Date().toISOString(),
      });
      if (list.length > MAX_LOG) list.splice(0, list.length - MAX_LOG);
    }
    scheduleAutoSave();
    if (window.refreshEnsembleCard) window.refreshEnsembleCard(card);
    if (window.refreshEnsemblePanel) window.refreshEnsemblePanel(card);
    setStatus(next ? `「${card.name}」を★${next}にしました。次に${(P.byId(list[list.length - 1].model) || { short: 'この' }).short}モデルで作る時の手がかりになります` : `「${card.name}」の評価を外しました`);
  }

  /* ---------------- 星のボタン ---------------- */

  function starsHtml(card, size) {
    const r = ratingOf(card);
    return `<div class="midi-stars${size === 'large' ? ' midi-stars--large' : ''}" role="group" aria-label="評価">` +
      [1, 2, 3, 4, 5].map((n) => `<button type="button" class="midi-star${n <= r ? ' midi-star--on' : ''}" data-star="${n}" title="★${n}${n === r ? '(もう一度押すと評価を外す)' : ''}" aria-label="★${n}">${n <= r ? '★' : '☆'}</button>`).join('') +
      `</div>`;
  }

  function bindStars(root, card) {
    root.querySelectorAll('[data-star]').forEach((b) => b.addEventListener('click', (event) => {
      event.stopPropagation();
      setRating(card, Number(b.dataset.star));
    }));
  }

  /* ---------------- 次の生成へ ---------------- */

  /** そのモデルの評価(同じカードの記録は最新だけ) */
  function entriesFor(model) {
    return log().filter((x) => x.model === model);
  }

  /** プロンプトに入れるフィードバックの節(評価が無ければ空) */
  function feedbackRule(model) {
    const mine = entriesFor(model);
    const byNew = (a, b) => String(b.at).localeCompare(String(a.at));
    const liked = mine.filter((x) => x.rating >= 4).sort((a, b) => b.rating - a.rating || byNew(a, b)).slice(0, 3);
    const disliked = mine.filter((x) => x.rating <= 2).sort((a, b) => a.rating - b.rating || byNew(a, b)).slice(0, 2);
    const lines = [];
    if (liked.length || disliked.length) {
      lines.push('ユーザーの評価(このモデルで前に作ったMIDIに付けた★。星がそのままフィードバック):');
      liked.forEach((x) => lines.push(`- 気に入った(★${x.rating}): ${x.digest}`));
      disliked.forEach((x) => lines.push(`- 気に入らなかった(★${x.rating}): ${x.digest}`));
      lines.push('気に入った設計図の傾向(音高の器、生成器とパラメータの選び方と範囲、時間の設計、テンポ)に寄せ、気に入らなかった傾向は避ける。ただし同じ設計図を写さず、今回の入力に合わせて新しく作る。評価と今回の入力・注文がぶつかる時は、今回の入力・注文を優先する');
    } else {
      // 同じモデルの評価が無い時は、ほかのモデルの★5を好みの手がかりとして少しだけ
      const top = log().filter((x) => x.rating === 5).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 2);
      if (top.length) {
        lines.push('ユーザーの好みの手がかり(ほかのモデルで作って★5を付けたMIDI。モデルが違うので、音の雰囲気・テンポ・密度の好みとしてだけ参考にする):');
        top.forEach((x) => lines.push(`- ${(P.byId(x.model) || { short: x.model }).short}: ${x.digest}`));
      }
    }
    return lines.join('\n');
  }

  /** 生成前の質問のゲージの初期値(そのモデルの★4以上の平均。5刻み)。評価が無ければ null */
  function likedGauges(model) {
    const list = entriesFor(model).filter((x) => x.rating >= 4 && x.gauges);
    if (!list.length) return null;
    const out = {};
    M.GAUGES.forEach((g) => {
      const vals = list.map((x) => x.gauges[g.name]).filter(Number.isFinite);
      if (vals.length) out[g.name] = Math.round(T.mean(vals) / 5) * 5;
    });
    return Object.keys(out).length ? out : null;
  }

  /** モデルごとの平均の星と件数(ピッカー用) */
  function modelStats() {
    const out = {};
    log().forEach((x) => {
      const s = (out[x.model] = out[x.model] || { sum: 0, n: 0 });
      s.sum += x.rating;
      s.n += 1;
    });
    Object.values(out).forEach((s) => { s.avg = Math.round((s.sum / s.n) * 10) / 10; });
    return out;
  }

  Object.assign(M, { ratingOf, setRating, starsHtml, bindStars, feedbackRule, likedGauges, modelStats, ratingDigest: digest });
})();
