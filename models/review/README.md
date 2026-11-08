# 音楽史マップの文章の監修 — 手順書

あなたは、音楽史 MIDI 生成モデルの説明文を、**書いた本人とは別の目で**、出典を当たって見直す監修者です。
モデルを作った時の経緯は知らないまま、書かれている文だけを疑ってください。

ユーザーがセッションの最初に貼る文の例:

> `models/review/README.md` に従って、次の id を監修して: ives whole_tone octatonic bitonality webern cluster additive nancarrow feldman satie

## 守ること
- **読むのは、この手順書と、下の「監修の材料」だけ**。`docs/duo/`・`docs/midi*.md`・`js/` は読まない(作った側の思い込みを引き継がないため)。AGENTS.md の「`docs/duo/` のタスクを先に読む」は、この作業には当てはめない
- 書き足すのは `models/review/<id>.json` だけ。プリセット・解説・お手本・`models/review/index.json` は変えない
- 作業は `review/midi-history-<日付>` のブランチ、別のフォルダの worktree で行う(まだなら、ユーザーに `git worktree add ../lyra-review -b review/midi-history-<日付>` を頼む)
- サブエージェントに任せない。1回のセッションで10件まで
- 返事は日本語。このリポジトリは公開なので、秘密の情報・個人情報を書かない
- **著作権: 出典の原文を写さない**。`reason` は自分の言葉の要約(240字まで)。引用が要る時だけ `sources[].quote` に、英語15語・日本語40字まで。楽譜・旋律も写さない
- 音は聴けない。聴いた印象を書かない。分かるのは文・設計図・実測の値まで

## 手順
1. `node models/checks/run.cjs --packet <id...>` で材料を出す
2. 1件ごとに、下の観点で主張を選び、出典を当たって判定する
3. `models/review/<id>.json` を書く
4. `node models/checks/run.cjs --validate-review <id...>` が OK になるまで直す
5. 1件ごとの結果(特に wrong と overstated)を日本語の短い一覧にして、ユーザーに見せる。コミット・マージはユーザーが読んでから

## 材料の欄
| 欄 | 中身 |
|---|---|
| `label` `short` | モデルの名前 |
| `mapText` `era` | 音楽史マップの説明と時代の区分 |
| `text` | 画面に出る説明 |
| `kids` | 小学生向けの解説(`userKids: true` はユーザーが書いた文。指摘は書いてよいが、直す対象にはならない) |
| `works` | 参照曲 |
| `style` `guide` | 生成の AI に渡す技法の説明・組み立ての指示 |
| `listen` | お手本の聴きどころ |
| `demo` | お手本の設計図 |
| `measured` | お手本の実測の値(パートごとの音の種類・強さ・音の間隔) |
| `textHash` | 記録にそのまま写す |

## 見る観点
1. **音楽史の事実**: 人名・年代・地域・用語
2. **参照曲(`works`)**: 曲が実在するか・作曲者と題名・楽章が合っているか・その技法がその曲で本当に聞き取れると言えるか。1曲につき1つの主張にする
3. **技法の説明**: 「〇〇の技法」として挙げたものが、その作曲家・様式の代表的な特徴と言えるか。単純化しすぎて誤解を生まないか
4. **お手本の適切さ**: `demo` と `listen`・`measured` を読み、その技法の例として適切か
5. **子どもの解説**: たとえが技法と合っているか・事実の誤りがないか。言い回しの好みには踏み込まない
6. **著作権の線**: お手本の旋律が既存の有名曲をなぞっていないか(気づいた範囲で)

## 主張の選び方
- 誤りがありうる事実の主張を中心に、1件につきおおむね10件まで
- 同じ内容が複数の欄にあれば1つの主張にまとめ、`fields` に全部書く
- 材料の欄はすべて、`claims` の `fields` か `noClaims` のどちらかに入れる。`noClaims` は「読んだが、確かめる事実が無かった欄」(`guide` の組み立ての指示など)

## 出典
- Web 検索で、事典・大学や図書館の資料・研究書の紹介など、信頼できるものを優先する。個人のブログ・AI の生成文は根拠にしない
- 見つからなかった指摘も隠さず、`sources: []` で出す(「出典なし」として表示される)

## 判定
| 値 | 意味 |
|---|---|
| `ok` | 正しい |
| `overstated` | 言い過ぎ・単純化しすぎ。`suggestion` に直し方の案を1〜2文 |
| `wrong` | 誤り。`suggestion` に直し方の案を1〜2文 |
| `unsure` | 判断できない |

## 記録の形(`models/review/<id>.json`)
```json
{
 "id": "ives",
 "reviewedAt": "2026-11-09",
 "reviewer": "Claude Code(別のセッション)",
 "target": "<git rev-parse --short HEAD の値>",
 "textHash": "<材料の textHash>",
 "noClaims": ["guide"],
 "claims": [
  {
   "fields": ["style", "text"],
   "claim": "層ごとに違うテンポと違う調",
   "verdict": "ok",
   "reason": "自分の言葉の要約",
   "sources": [{ "title": "資料の名前", "url": "https://…", "where": "どの項目・章か", "quote": "短い引用(任意)" }]
  }
 ]
}
```
- `status` は書かない(`run.cjs` が計算する)
- `url` は Web の資料なら書く。書籍なら省いて `where` に章やページを書く

## 監修の後(監修のセッションでは行わない)
- ユーザーが記録を読んで main へ取り込み、`node models/checks/run.cjs --update-review-index` で `index.json` を作り直す
- 直すと決めた指摘を直したら、その claim に `"fixed": "YYYY-MM-DD"` を足し、記録の `textHash` を新しい材料の値にする
- ユーザーが書いた子どもの解説(`userKids: true`)は、指摘があっても直さない
