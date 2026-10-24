export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export const MEALS: Meal[] = ['breakfast', 'lunch', 'dinner', 'snack'];
export const MEAL_LABEL: Record<Meal, string> = {
  breakfast: '朝食',
  lunch: '昼食',
  dinner: '夕食',
  snack: '間食',
};

export type Sex = 'male' | 'female';

export interface Profile {
  sex: Sex;
  age: number;
  height_cm: number;
  start_date: string;
  start_weight: number;
  target_weight: number;
  target_date: string;
}

/** 量の目安。qty は食品の unit 単位 */
export interface Serving {
  label: string;
  qty: number;
}

/** 食品。栄養は baseQty（unit 単位）あたり。ref は "mext:1088" / "custom:3" */
export interface Food {
  ref: string;
  name: string;
  unit: string;
  baseQty: number;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  servings: Serving[];
  source: 'mext' | 'custom' | 'ai';
  note?: string | null;
}

export interface Nutrients {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
}

/** 登録する1品 */
export interface EntryInput {
  food: Food;
  qty: number;
  serving_label?: string | null;
}

export interface Entry extends Nutrients {
  id: number;
  date: string;
  meal: Meal;
  time: string | null;
  food_ref: string;
  name: string;
  qty: number;
  unit: string;
  serving_label: string | null;
  food: Food;
}

export interface Combo {
  id: number;
  name: string;
  items: EntryInput[];
}

export interface DayPlan {
  bmr: number;
  activeKcal: number;
  deficit: number;
  repayment: number;
  /** 下限をかける前の枠 */
  rawAllowance: number;
  allowance: number;
  floor: number;
  floorApplied: boolean;
  daysLeft: number;
  pastDeadline: boolean;
  weight: number;
}

export interface Summary {
  date: string;
  plan: DayPlan;
  intake: Nutrients;
  pfcTarget: Nutrients;
  debt: number;
  /** 昨日の借金がまだ確定していない */
  pendingYesterday: boolean;
  weightToday: number | null;
  restingKcal: number | null;
  lastSync: string | null;
  entries: Entry[];
  profile: Profile;
}

export interface DayStat {
  date: string;
  intake: number;
  protein: number;
  fat: number;
  carbs: number;
  recorded: boolean;
  activeKcal: number | null;
  restingKcal: number | null;
  /** 消費カロリー（安静時がなければ計算した基礎代謝で代用） */
  burn: number | null;
  allowance: number | null;
  weight: number | null;
  debt: number | null;
  overage: number | null;
}
