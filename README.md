# Foodiet

食事と体重を記録して、「今日食べていい量」がひと目でわかる個人用の体重管理アプリです。iPhone のホーム画面に追加して使う Web アプリ（PWA）で、データは Cloudflare に保存します。

- **今日のサマリー**: 今日の枠に対する摂取カロリーのゲージ、枠の内訳、借金、体重、PFC バランス、食事の一覧
- **通算記録**: 摂取・消費カロリー、体重と予定ライン、PFC バランス、借金の推移（日・週・月・年）
- **食事登録**: 日本食品標準成分表（約 2,500 品目）の検索、自分の食品、履歴、お気に入り、よく食べる組み合わせ

仕様は [docs/SPEC.md](docs/SPEC.md)、公開と iPhone での設定手順は [docs/SETUP.md](docs/SETUP.md) にあります。

## 今日の枠の計算

```
今日の枠 = 基礎代謝 + 今日のアクティブカロリー − 1日の赤字 − 借金の返済
```

- 基礎代謝: Mifflin-St Jeor 式（性別・年齢・身長・最新の体重）
- アクティブカロリー: ヘルスケアからショートカットで送られた値
- 1日の赤字: `(最新の体重 − 目標体重) × 7,200kcal ÷ 期限までの日数`
- 借金: 枠を超えた分。期限までの残り日数で割って、毎日少しずつ枠から返す
- 枠は基礎代謝の 8 割を下回らない

1 日を締めるのは翌日です（翌日になってからヘルスケアの同期があるか、12 時を過ぎた時点）。記録が 1 件もない日は借金を動かしません。計算は [shared/calc.ts](shared/calc.ts) と [functions/lib/ledger.ts](functions/lib/ledger.ts) にあります。

## 構成

| 場所 | 内容 |
|---|---|
| `src/` | 画面（React + TypeScript + Vite、グラフは Recharts） |
| `functions/` | API（Cloudflare Pages Functions + Hono） |
| `shared/` | 画面と API の両方で使う型と計算 |
| `migrations/` | D1（SQLite）のテーブル定義 |
| `public/foods-mext.json` | 食品成分表のデータ（`scripts/gen-mext-foods.mjs` で生成） |

## 開発

```sh
npm install
cp .dev.vars.example .dev.vars      # ローカルでは認証しない
npm run db:migrate:local            # ローカルの D1 にテーブルを作る
npm run build
npx wrangler pages dev dist         # http://localhost:8788
```

画面だけを編集するときは、`npx wrangler pages dev dist` を動かしたまま別の端末で `npm run dev` を実行すると、Vite の開発サーバー（API は 8788 に転送）で確認できます。

```sh
npm test         # 計算と検索のテスト
npm run typecheck
```

## 食品データ

[日本食品標準成分表2020年版（八訂）](https://www.mext.go.jp/a_menu/syokuhinseibun/mext_01110.html)（文部科学省）を、[katoharu432/standards-tables-of-food-composition-in-japan](https://github.com/katoharu432/standards-tables-of-food-composition-in-japan)（CC BY 4.0）の JSON から変換しています。再生成するときは、そのリポジトリの `data.json` を指定します。

```sh
npm run gen:foods -- path/to/data.json
```

よく食べる食品の目安量（茶碗 1 杯 = 150g など）と検索用の別名（ごはん → こめ [水稲めし] など）は、スクリプトの中で定義しています。
