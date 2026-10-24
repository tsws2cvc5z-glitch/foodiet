import { diffDays } from './date';
import type { DayPlan, EntryInput, Food, Nutrients, Profile } from './types';

/** 体脂肪1kgあたりのエネルギー */
export const KCAL_PER_KG = 7200;
/** 枠の下限（基礎代謝に対する割合） */
export const FLOOR_RATIO = 0.8;
/** 期限を過ぎたあとに借金を返す日数 */
export const REPAY_DAYS_AFTER_DEADLINE = 7;
/** PFC の目標（エネルギー比）。日本人の食事摂取基準の目標量の中ほど */
export const PFC_RATIO = { protein: 0.2, fat: 0.25, carbs: 0.55 };

/** Mifflin-St Jeor 式による基礎代謝 */
export function calcBmr(p: Pick<Profile, 'sex' | 'age' | 'height_cm'>, weightKg: number): number {
  const base = 10 * weightKg + 6.25 * p.height_cm - 5 * p.age;
  return base + (p.sex === 'male' ? 5 : -161);
}

export interface PlanInput {
  profile: Profile;
  date: string;
  weight: number;
  activeKcal: number;
  debtBefore: number;
}

/**
 * その日の枠
 *   基礎代謝 + アクティブ − 1日の赤字 − 借金の返済（下限: 基礎代謝 × FLOOR_RATIO）
 */
export function planDay({ profile, date, weight, activeKcal, debtBefore }: PlanInput): DayPlan {
  const bmr = calcBmr(profile, weight);
  const remaining = diffDays(date, profile.target_date);
  const pastDeadline = remaining <= 0;
  const daysLeft = Math.max(remaining, 0);
  const toLose = Math.max(weight - profile.target_weight, 0);
  const deficit = pastDeadline ? 0 : (toLose * KCAL_PER_KG) / daysLeft;
  const repayment =
    debtBefore <= 0 ? 0 : debtBefore / (pastDeadline ? REPAY_DAYS_AFTER_DEADLINE : daysLeft);
  const rawAllowance = bmr + activeKcal - deficit - repayment;
  const floor = bmr * FLOOR_RATIO;
  const floorApplied = rawAllowance < floor;
  return {
    bmr,
    activeKcal,
    deficit,
    repayment,
    rawAllowance,
    allowance: floorApplied ? floor : rawAllowance,
    floor,
    floorApplied,
    daysLeft,
    pastDeadline,
    weight,
  };
}

/**
 * 1日を締める。記録がない日は借金を動かさない（返済もしない）
 */
export function closeDay(plan: DayPlan, debtBefore: number, intake: number, recorded: boolean) {
  if (!recorded) return { overage: 0, repayment: 0, debtAfter: debtBefore };
  const overage = Math.max(intake - plan.allowance, 0);
  // 下限で枠を引き上げた分は返済できなかったとみなす
  const lifted = plan.allowance - plan.rawAllowance;
  const repayment = Math.min(Math.max(plan.repayment - lifted, 0), debtBefore);
  const debtAfter = debtBefore - repayment + overage;
  return { overage, repayment, debtAfter };
}

export function pfcTarget(allowance: number): Nutrients {
  return {
    kcal: allowance,
    protein: (allowance * PFC_RATIO.protein) / 4,
    fat: (allowance * PFC_RATIO.fat) / 9,
    carbs: (allowance * PFC_RATIO.carbs) / 4,
  };
}

export interface GoalCheck {
  level: 'ok' | 'warn' | 'error';
  message: string | null;
  perWeek: number;
  dailyDeficit: number;
}

/** 目標の妥当性チェック。週あたりの減量が体重の1%を超えたら警告 */
export function goalCheck(p: Profile, today: string): GoalCheck {
  const days = diffDays(today, p.target_date);
  if (days <= 0) return { level: 'error', message: '期限は今日より後の日付にしてください', perWeek: 0, dailyDeficit: 0 };
  const toLose = Math.max(p.start_weight - p.target_weight, 0);
  const perWeek = (toLose / days) * 7;
  const dailyDeficit = (toLose * KCAL_PER_KG) / days;
  const limit = p.start_weight * 0.01;
  if (perWeek > limit) {
    return {
      level: 'warn',
      message: `1週間に${perWeek.toFixed(2)}kgのペースです。体重の1%（${limit.toFixed(2)}kg）を超えるので、期限を延ばすことをおすすめします`,
      perWeek,
      dailyDeficit,
    };
  }
  return { level: 'ok', message: null, perWeek, dailyDeficit };
}

export function nutrientsFor(food: Food, qty: number): Nutrients {
  const f = food.baseQty > 0 ? qty / food.baseQty : 0;
  return {
    kcal: food.kcal * f,
    protein: food.protein * f,
    fat: food.fat * f,
    carbs: food.carbs * f,
  };
}

export function sumNutrients(items: Nutrients[]): Nutrients {
  return items.reduce(
    (a, b) => ({
      kcal: a.kcal + b.kcal,
      protein: a.protein + b.protein,
      fat: a.fat + b.fat,
      carbs: a.carbs + b.carbs,
    }),
    { kcal: 0, protein: 0, fat: 0, carbs: 0 },
  );
}

export function sumInputs(items: EntryInput[]): Nutrients {
  return sumNutrients(items.map((i) => nutrientsFor(i.food, i.qty)));
}
