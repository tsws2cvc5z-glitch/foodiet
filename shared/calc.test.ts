import { describe, expect, it } from 'vitest';
import { calcBmr, closeDay, goalCheck, nutrientsFor, planDay } from './calc';
import { addDays, diffDays } from './date';
import type { Food, Profile } from './types';

const profile: Profile = {
  sex: 'male',
  age: 35,
  height_cm: 172,
  start_date: '2026-10-01',
  start_weight: 75,
  target_weight: 69,
  target_date: '2027-03-30',
};

describe('calcBmr', () => {
  it('Mifflin-St Jeor 式で計算する', () => {
    expect(calcBmr(profile, 75)).toBeCloseTo(10 * 75 + 6.25 * 172 - 5 * 35 + 5);
    expect(calcBmr({ ...profile, sex: 'female' }, 60)).toBeCloseTo(10 * 60 + 6.25 * 172 - 5 * 35 - 161);
  });
});

describe('planDay', () => {
  it('基礎代謝 + アクティブ − 赤字 − 返済', () => {
    const date = '2026-10-01';
    const days = diffDays(date, profile.target_date);
    const plan = planDay({ profile, date, weight: 75, activeKcal: 400, debtBefore: 1800 });
    expect(plan.daysLeft).toBe(days);
    expect(plan.deficit).toBeCloseTo((6 * 7200) / days);
    expect(plan.repayment).toBeCloseTo(1800 / days);
    expect(plan.allowance).toBeCloseTo(plan.bmr + 400 - plan.deficit - plan.repayment);
    expect(plan.floorApplied).toBe(false);
  });

  it('目標体重に届いていれば赤字は 0', () => {
    const plan = planDay({ profile, date: '2026-12-01', weight: 68.5, activeKcal: 0, debtBefore: 0 });
    expect(plan.deficit).toBe(0);
    expect(plan.allowance).toBeCloseTo(plan.bmr);
  });

  it('枠は基礎代謝の8割を下回らない', () => {
    const plan = planDay({ profile, date: addDays(profile.target_date, -3), weight: 75, activeKcal: 0, debtBefore: 0 });
    expect(plan.floorApplied).toBe(true);
    expect(plan.allowance).toBeCloseTo(plan.bmr * 0.8);
  });

  it('期限を過ぎたら赤字は 0、借金は7日で返す', () => {
    const plan = planDay({ profile, date: addDays(profile.target_date, 1), weight: 72, activeKcal: 0, debtBefore: 700 });
    expect(plan.pastDeadline).toBe(true);
    expect(plan.deficit).toBe(0);
    expect(plan.repayment).toBeCloseTo(100);
  });
});

describe('closeDay', () => {
  const plan = planDay({ profile, date: '2026-10-01', weight: 75, activeKcal: 300, debtBefore: 500 });

  it('枠を超えた分を借金に足し、返済分を引く', () => {
    const r = closeDay(plan, 500, plan.allowance + 200, true);
    expect(r.overage).toBeCloseTo(200);
    expect(r.debtAfter).toBeCloseTo(500 - plan.repayment + 200);
  });

  it('枠内なら返済だけ進む', () => {
    const r = closeDay(plan, 500, plan.allowance - 100, true);
    expect(r.overage).toBe(0);
    expect(r.debtAfter).toBeCloseTo(500 - plan.repayment);
  });

  it('記録がない日は借金を動かさない', () => {
    const r = closeDay(plan, 500, 0, false);
    expect(r).toEqual({ overage: 0, repayment: 0, debtAfter: 500 });
  });

  it('下限で枠を引き上げた分は返済できない', () => {
    const tight = planDay({ profile, date: addDays(profile.target_date, -3), weight: 75, activeKcal: 0, debtBefore: 300 });
    const lifted = tight.allowance - tight.rawAllowance;
    const r = closeDay(tight, 300, tight.allowance, true);
    expect(r.repayment).toBeCloseTo(Math.max(tight.repayment - lifted, 0));
  });
});

describe('goalCheck', () => {
  it('期限が過去ならエラー', () => {
    expect(goalCheck(profile, '2027-04-01').level).toBe('error');
  });
  it('週に体重の1%を超えるペースなら警告', () => {
    expect(goalCheck({ ...profile, target_date: '2026-11-01' }, '2026-10-01').level).toBe('warn');
    expect(goalCheck(profile, '2026-10-01').level).toBe('ok');
  });
});

describe('nutrientsFor', () => {
  it('基準量あたりの値から量に応じて計算する', () => {
    const rice: Food = { ref: 'mext:1088', name: 'ごはん', unit: 'g', baseQty: 100, kcal: 156, protein: 2.5, fat: 0.3, carbs: 37.1, servings: [], source: 'mext' };
    const n = nutrientsFor(rice, 150);
    expect(n.kcal).toBeCloseTo(234);
    expect(n.carbs).toBeCloseTo(55.65);
  });
});
