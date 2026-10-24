import { describe, expect, it } from 'vitest';
import { normalize, search, type Searchable } from './foods';
import type { Food } from '../shared/types';

const item = (name: string, aliases = '', rank = 2000): Searchable => ({
  food: { ref: name, name, unit: 'g', baseQty: 100, kcal: 0, protein: 0, fat: 0, carbs: 0, servings: [], source: 'mext' } as Food,
  key: normalize(`${name} ${aliases}`),
  rank,
});

describe('search', () => {
  const items = [
    item('こめ [水稲めし] 玄米', 'ごはん ご飯 白米', 1000),
    item('こめ [水稲めし] 精白米 うるち米', 'ごはん ご飯 白米', 0),
    item('<魚類> (さけ･ます類) しろさけ 生', '鮭 サーモン'),
    item('ウインナーソーセージ'),
  ];

  it('別名で探せて、定番の食品が先に出る', () => {
    expect(search(items, 'ごはん').map((f) => f.name)[0]).toBe('こめ [水稲めし] 精白米 うるち米');
  });
  it('カタカナとひらがなを区別しない', () => {
    expect(search(items, 'ういんなー')).toHaveLength(1);
    expect(search(items, 'サケ')).toHaveLength(1);
  });
  it('空白区切りはすべての語を含むもの', () => {
    expect(search(items, 'ごはん 玄米').map((f) => f.name)).toEqual(['こめ [水稲めし] 玄米']);
  });
});
