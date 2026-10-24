import type { Combo, DayStat, Entry, EntryInput, Food, Meal, Profile, Summary } from '../shared/types';
import type { GoalCheck } from '../shared/calc';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const LOGIN_EXPIRED = 'ログインの有効期限が切れました。再読み込みしてログインし直してください';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      // Cloudflare Access のログインが切れるとログイン画面へリダイレクトされる
      redirect: 'manual',
    });
  } catch {
    throw new ApiError(0, '通信できませんでした。電波の状態を確認してください');
  }
  if (res.type === 'opaqueredirect' || res.status === 401) throw new ApiError(401, LOGIN_EXPIRED);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `通信に失敗しました（${res.status}）`);
  return data as T;
}

export interface RecentFood {
  food: Food;
  qty: number;
  serving_label: string | null;
  meal: Meal;
  n: number;
  last_date: string;
}

export interface ProfileInput extends Omit<Profile, 'start_date' | 'start_weight'> {
  current_weight?: number;
  reset?: boolean;
}

export const api = {
  profile: () => request<{ profile: Profile | null; today: string }>('GET', '/profile'),
  saveProfile: (p: ProfileInput) => request<{ profile: Profile; check: GoalCheck }>('PUT', '/profile', p),
  summary: (date?: string) =>
    request<Summary | { needsSetup: true }>('GET', `/summary${date ? `?date=${date}` : ''}`),
  addEntries: (date: string, meal: Meal, time: string | null, items: EntryInput[]) =>
    request('POST', '/entries', { date, meal, time, items }),
  updateEntry: (id: number, patch: Partial<Pick<Entry, 'qty' | 'meal' | 'time' | 'date' | 'serving_label'>>) =>
    request('PUT', `/entries/${id}`, patch),
  deleteEntry: (id: number) => request('DELETE', `/entries/${id}`),
  foods: () => request<Food[]>('GET', '/foods'),
  createFood: (f: Omit<Food, 'ref'>) => request<Food>('POST', '/foods', f),
  updateFood: (id: number, f: Omit<Food, 'ref'>) => request<Food>('PUT', `/foods/${id}`, f),
  deleteFood: (id: number) => request('DELETE', `/foods/${id}`),
  recent: () => request<RecentFood[]>('GET', '/foods/recent'),
  favorites: () => request<Food[]>('GET', '/favorites'),
  addFavorite: (f: Food) => request('PUT', '/favorites', f),
  removeFavorite: (ref: string) => request('DELETE', `/favorites?ref=${encodeURIComponent(ref)}`),
  combos: () => request<Combo[]>('GET', '/combos'),
  createCombo: (name: string, items: EntryInput[]) => request('POST', '/combos', { name, items }),
  deleteCombo: (id: number) => request('DELETE', `/combos/${id}`),
  saveWeight: (date: string, kg: number) => request('PUT', `/weights/${date}`, { kg }),
  stats: (from: string, to: string) =>
    request<{ profile: Profile; days: DayStat[] } | { needsSetup: true }>('GET', `/stats?from=${from}&to=${to}`),
};
