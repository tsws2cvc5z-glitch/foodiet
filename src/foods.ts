import type { Food } from '../shared/types';

type Row = [number, string, number, number, number, number, string];
interface MextFile {
  source: string;
  foods: Row[];
  servings: Record<string, [string, number][]>;
  popular: number[];
}

export interface Searchable {
  food: Food;
  key: string;
  /** 小さいほど検索で上に出す（定番の食品） */
  rank: number;
}

/** 検索用に正規化する（全角半角・カタカナひらがな・記号の違いを吸収） */
export function normalize(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/[\s・･\[\]\(\)<>（）［］〈〉「」]/g, '');
}

let mext: Promise<Searchable[]> | null = null;

export function loadMext(): Promise<Searchable[]> {
  mext ??= fetch('/foods-mext.json')
    .then((r) => r.json() as Promise<MextFile>)
    .then((data) => {
      const popular = new Map(data.popular.map((id, i) => [id, i]));
      return data.foods.map(([id, name, kcal, protein, fat, carbs, aliases]) => {
        const servings = (data.servings[id] ?? []).map(([label, qty]) => ({ label, qty }));
        return {
          food: { ref: `mext:${id}`, name, unit: 'g', baseQty: 100, kcal, protein, fat, carbs, servings, source: 'mext' as const },
          key: normalize(`${name} ${aliases}`),
          // 定番 → 目安量があるもの → その他
          rank: popular.get(id) ?? (servings.length > 0 ? 1000 : 2000),
        };
      });
    });
  return mext;
}

export function toSearchable(food: Food): Searchable {
  return { food, key: normalize(food.name), rank: 0 };
}

/** 空白区切りの語をすべて含むものを、定番・名前が短いもの順に返す */
export function search(items: Searchable[], query: string, limit = 60): Food[] {
  const tokens = query.split(/[\s　]+/).map(normalize).filter(Boolean);
  if (!tokens.length) return [];
  const hits = items.filter((i) => tokens.every((t) => i.key.includes(t)));
  hits.sort((a, b) => {
    const pa = a.key.startsWith(tokens[0]) ? 0 : 1;
    const pb = b.key.startsWith(tokens[0]) ? 0 : 1;
    return a.rank - b.rank || pa - pb || a.food.name.length - b.food.name.length;
  });
  return hits.slice(0, limit).map((h) => h.food);
}
