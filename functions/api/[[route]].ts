import { Hono, type Context } from 'hono';
import { handle } from 'hono/cloudflare-pages';
import { calcBmr, goalCheck, nutrientsFor, pfcTarget, planDay, sumNutrients } from '../../shared/calc';
import { addDays, dateIn, isDate, timeIn } from '../../shared/date';
import {
  MEALS,
  MEAL_LABEL,
  type DayStat,
  type Entry,
  type EntryInput,
  type Food,
  type Meal,
  type Profile,
  type Serving,
  type Summary,
} from '../../shared/types';
import { auth } from '../lib/auth';
import type { AppEnv } from '../lib/env';
import { debtBefore, ensureLedger, getProfile, invalidateFrom, loadWeightsUntil, weightOn } from '../lib/ledger';

const app = new Hono<AppEnv>().basePath('/api');
app.use('*', auth);
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 500);
});

type C = Context<AppEnv>;
const nowIso = () => new Date().toISOString();
const today = (c: C) => dateIn(c.env.TIME_ZONE);
const bad = (c: C, message: string) => c.json({ error: message }, 400);

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    // ショートカットからは "523.4 kcal" や "65,2" のような文字列が来ることがある
    const n = parseFloat(v.replace(',', '.').replace(/[^\d.\-]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseFood(v: unknown): Food | null {
  if (!v || typeof v !== 'object') return null;
  const f = v as Record<string, unknown>;
  const nums = ['baseQty', 'kcal', 'protein', 'fat', 'carbs'].map((k) => toNumber(f[k]));
  if (typeof f.ref !== 'string' || typeof f.name !== 'string' || typeof f.unit !== 'string') return null;
  if (nums.some((n) => n === null || n < 0) || nums[0] === 0) return null;
  const servings = Array.isArray(f.servings)
    ? (f.servings as Serving[]).filter((s) => typeof s?.label === 'string' && (toNumber(s.qty) ?? 0) > 0)
    : [];
  return {
    ref: f.ref,
    name: f.name.trim(),
    unit: f.unit,
    baseQty: nums[0]!,
    kcal: nums[1]!,
    protein: nums[2]!,
    fat: nums[3]!,
    carbs: nums[4]!,
    servings,
    source: f.source === 'custom' || f.source === 'ai' ? f.source : 'mext',
    note: typeof f.note === 'string' ? f.note : null,
  };
}

function parseInputs(v: unknown): EntryInput[] | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const out: EntryInput[] = [];
  for (const item of v) {
    const food = parseFood(item?.food);
    const qty = toNumber(item?.qty);
    if (!food || qty === null || qty < 0) return null;
    out.push({ food, qty, serving_label: typeof item.serving_label === 'string' ? item.serving_label : null });
  }
  return out;
}

type EntryRow = Omit<Entry, 'food'> & { food: string };
const rowToEntry = (r: EntryRow): Entry => ({ ...r, food: JSON.parse(r.food) });

async function entriesOn(db: D1Database, date: string): Promise<Entry[]> {
  const { results } = await db
    .prepare('SELECT * FROM entries WHERE date = ? ORDER BY time IS NULL, time, id')
    .bind(date)
    .all<EntryRow>();
  return results.map(rowToEntry);
}

// ---------- 初期設定 ----------

app.get('/profile', async (c) => {
  const profile = await getProfile(c.env.DB);
  return c.json({ profile, today: today(c) });
});

app.put('/profile', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const sex = body.sex === 'male' || body.sex === 'female' ? body.sex : null;
  const age = toNumber(body.age);
  const height = toNumber(body.height_cm);
  const target = toNumber(body.target_weight);
  const current = toNumber(body.current_weight);
  if (!sex || !age || !height || !target || !isDate(body.target_date)) return bad(c, '入力内容を確認してください');
  const db = c.env.DB;
  const t = today(c);
  const existing = await getProfile(db);
  // 初回と「目標を設定し直す」ときは、今日を開始日にして借金もリセットする
  const reset = !existing || body.reset === true;
  if (reset && !current) return bad(c, '現在の体重を入力してください');
  const profile: Profile = {
    sex,
    age,
    height_cm: height,
    target_weight: target,
    target_date: body.target_date,
    start_date: reset ? t : existing!.start_date,
    start_weight: reset ? current! : existing!.start_weight,
  };
  const check = goalCheck(profile, t);
  if (check.level === 'error') return bad(c, check.message!);
  const stmts = [
    db
      .prepare(
        `INSERT OR REPLACE INTO profile (id, sex, age, height_cm, start_date, start_weight, target_weight, target_date, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(sex, age, height, profile.start_date, profile.start_weight, target, profile.target_date, nowIso()),
  ];
  if (reset) {
    stmts.push(db.prepare('DELETE FROM day_ledger'));
    stmts.push(
      db
        .prepare(`INSERT OR REPLACE INTO weights (date, kg, source, updated_at) VALUES (?, ?, 'manual', ?)`)
        .bind(t, current, nowIso()),
    );
  }
  await db.batch(stmts);
  return c.json({ profile, check });
});

// ---------- 今日のサマリー ----------

app.get('/summary', async (c) => {
  const db = c.env.DB;
  const profile = await getProfile(db);
  if (!profile) return c.json({ needsSetup: true });
  const date = c.req.query('date') ?? today(c);
  if (!isDate(date)) return bad(c, 'date が不正です');
  const { pendingYesterday } = await ensureLedger(db, profile, c.env.TIME_ZONE);
  const [weights, health, entries, debt, lastSync] = await Promise.all([
    loadWeightsUntil(db, date),
    db.prepare('SELECT active_kcal, resting_kcal FROM health_daily WHERE date = ?').bind(date).first<{ active_kcal: number; resting_kcal: number | null }>(),
    entriesOn(db, date),
    debtBefore(db, date),
    db.prepare('SELECT MAX(updated_at) AS t FROM health_daily').first<{ t: string | null }>(),
  ]);
  const weight = weightOn(date, weights, profile.start_weight);
  const plan = planDay({ profile, date, weight, activeKcal: health?.active_kcal ?? 0, debtBefore: debt });
  const summary: Summary = {
    date,
    plan,
    intake: sumNutrients(entries),
    pfcTarget: pfcTarget(plan.allowance),
    debt,
    pendingYesterday: date === today(c) && pendingYesterday,
    weightToday: weights.find((w) => w.date === date)?.kg ?? null,
    restingKcal: health?.resting_kcal ?? null,
    lastSync: lastSync?.t ?? null,
    entries,
    profile,
  };
  return c.json(summary);
});

// ---------- 食事の記録 ----------

app.get('/entries', async (c) => {
  const date = c.req.query('date') ?? today(c);
  if (!isDate(date)) return bad(c, 'date が不正です');
  return c.json(await entriesOn(c.env.DB, date));
});

app.post('/entries', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const meal = body.meal as Meal;
  const date = body.date;
  const time = typeof body.time === 'string' && /^\d{2}:\d{2}$/.test(body.time) ? body.time : null;
  const items = parseInputs(body.items);
  if (!MEALS.includes(meal) || !isDate(date) || !items) return bad(c, '入力内容を確認してください');
  const db = c.env.DB;
  const stmt = db.prepare(
    `INSERT INTO entries (date, meal, time, food_ref, name, qty, unit, serving_label, kcal, protein, fat, carbs, food, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const now = nowIso();
  await db.batch(
    items.map((i) => {
      const n = nutrientsFor(i.food, i.qty);
      return stmt.bind(date, meal, time, i.food.ref, i.food.name, i.qty, i.food.unit, i.serving_label ?? null, n.kcal, n.protein, n.fat, n.carbs, JSON.stringify(i.food), now);
    }),
  );
  await invalidateFrom(db, date);
  return c.json({ ok: true });
});

app.put('/entries/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<Record<string, unknown>>();
  const db = c.env.DB;
  const row = await db.prepare('SELECT * FROM entries WHERE id = ?').bind(id).first<EntryRow>();
  if (!row) return c.json({ error: 'not found' }, 404);
  const entry = rowToEntry(row);
  const qty = body.qty === undefined ? entry.qty : toNumber(body.qty);
  const meal = (body.meal ?? entry.meal) as Meal;
  const date = body.date ?? entry.date;
  const time = body.time === undefined ? entry.time : typeof body.time === 'string' && /^\d{2}:\d{2}$/.test(body.time) ? body.time : null;
  const servingLabel = body.serving_label === undefined ? entry.serving_label : (body.serving_label as string | null);
  if (qty === null || qty < 0 || !MEALS.includes(meal) || !isDate(date)) return bad(c, '入力内容を確認してください');
  const n = nutrientsFor(entry.food, qty);
  await db
    .prepare('UPDATE entries SET qty = ?, meal = ?, date = ?, time = ?, serving_label = ?, kcal = ?, protein = ?, fat = ?, carbs = ? WHERE id = ?')
    .bind(qty, meal, date, time, servingLabel, n.kcal, n.protein, n.fat, n.carbs, id)
    .run();
  await invalidateFrom(db, date < entry.date ? date : entry.date);
  return c.json({ ok: true });
});

app.delete('/entries/:id', async (c) => {
  const db = c.env.DB;
  const row = await db.prepare('SELECT date FROM entries WHERE id = ?').bind(Number(c.req.param('id'))).first<{ date: string }>();
  if (!row) return c.json({ error: 'not found' }, 404);
  await db.prepare('DELETE FROM entries WHERE id = ?').bind(Number(c.req.param('id'))).run();
  await invalidateFrom(db, row.date);
  return c.json({ ok: true });
});

// ---------- 食品 ----------

type FoodRow = { id: number; name: string; unit: string; base_qty: number; kcal: number; protein: number; fat: number; carbs: number; servings: string; source: string; note: string | null };
const rowToFood = (r: FoodRow): Food => ({
  ref: `custom:${r.id}`,
  name: r.name,
  unit: r.unit,
  baseQty: r.base_qty,
  kcal: r.kcal,
  protein: r.protein,
  fat: r.fat,
  carbs: r.carbs,
  servings: JSON.parse(r.servings),
  source: r.source === 'ai' ? 'ai' : 'custom',
  note: r.note,
});

app.get('/foods', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM foods WHERE deleted = 0 ORDER BY name').all<FoodRow>();
  return c.json(results.map(rowToFood));
});

app.post('/foods', async (c) => {
  const food = parseFood({ ...(await c.req.json()), ref: 'custom:new' });
  if (!food || !food.name) return bad(c, '入力内容を確認してください');
  const row = await c.env.DB
    .prepare(
      `INSERT INTO foods (name, unit, base_qty, kcal, protein, fat, carbs, servings, source, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    )
    .bind(food.name, food.unit, food.baseQty, food.kcal, food.protein, food.fat, food.carbs, JSON.stringify(food.servings), food.source === 'ai' ? 'ai' : 'custom', food.note ?? null, nowIso())
    .first<FoodRow>();
  return c.json(rowToFood(row!));
});

app.put('/foods/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const food = parseFood({ ...(await c.req.json()), ref: `custom:${id}` });
  if (!food || !food.name) return bad(c, '入力内容を確認してください');
  const row = await c.env.DB
    .prepare('UPDATE foods SET name = ?, unit = ?, base_qty = ?, kcal = ?, protein = ?, fat = ?, carbs = ?, servings = ?, note = ? WHERE id = ? RETURNING *')
    .bind(food.name, food.unit, food.baseQty, food.kcal, food.protein, food.fat, food.carbs, JSON.stringify(food.servings), food.note ?? null, id)
    .first<FoodRow>();
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json(rowToFood(row));
});

app.delete('/foods/:id', async (c) => {
  // 過去の記録は登録時の値を持っているので、食品は論理削除だけでよい
  await c.env.DB.prepare('UPDATE foods SET deleted = 1 WHERE id = ?').bind(Number(c.req.param('id'))).run();
  return c.json({ ok: true });
});

/** 最近食べたもの（食品ごとに最後の記録） */
app.get('/foods/recent', async (c) => {
  const { results } = await c.env.DB
    .prepare(
      `SELECT e.food, e.qty, e.serving_label, e.meal, x.n, x.last_date
       FROM entries e
       JOIN (SELECT food_ref, COUNT(*) AS n, MAX(id) AS last_id, MAX(date) AS last_date FROM entries WHERE food_ref != 'skip' GROUP BY food_ref) x
         ON e.id = x.last_id
       ORDER BY x.last_id DESC LIMIT 200`,
    )
    .all<{ food: string; qty: number; serving_label: string | null; meal: Meal; n: number; last_date: string }>();
  return c.json(results.map((r) => ({ ...r, food: JSON.parse(r.food) as Food })));
});

app.get('/favorites', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT food FROM favorites ORDER BY created_at DESC').all<{ food: string }>();
  return c.json(results.map((r) => JSON.parse(r.food) as Food));
});

app.put('/favorites', async (c) => {
  const food = parseFood(await c.req.json());
  if (!food) return bad(c, '入力内容を確認してください');
  await c.env.DB.prepare('INSERT OR REPLACE INTO favorites (food_ref, food, created_at) VALUES (?, ?, ?)').bind(food.ref, JSON.stringify(food), nowIso()).run();
  return c.json({ ok: true });
});

app.delete('/favorites', async (c) => {
  await c.env.DB.prepare('DELETE FROM favorites WHERE food_ref = ?').bind(c.req.query('ref') ?? '').run();
  return c.json({ ok: true });
});

// ---------- よく食べる組み合わせ ----------

app.get('/combos', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, name, items FROM combos ORDER BY name').all<{ id: number; name: string; items: string }>();
  return c.json(results.map((r) => ({ ...r, items: JSON.parse(r.items) })));
});

app.post('/combos', async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  const items = parseInputs(body.items);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || !items) return bad(c, '入力内容を確認してください');
  await c.env.DB.prepare('INSERT INTO combos (name, items, created_at) VALUES (?, ?, ?)').bind(name, JSON.stringify(items), nowIso()).run();
  return c.json({ ok: true });
});

app.delete('/combos/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM combos WHERE id = ?').bind(Number(c.req.param('id'))).run();
  return c.json({ ok: true });
});

// ---------- 体重 ----------

app.put('/weights/:date', async (c) => {
  const date = c.req.param('date');
  const kg = toNumber((await c.req.json<Record<string, unknown>>()).kg);
  if (!isDate(date) || !kg || kg < 20 || kg > 300) return bad(c, '体重を確認してください');
  await c.env.DB.prepare(`INSERT OR REPLACE INTO weights (date, kg, source, updated_at) VALUES (?, ?, 'manual', ?)`).bind(date, kg, nowIso()).run();
  await invalidateFrom(c.env.DB, date);
  return c.json({ ok: true });
});

app.delete('/weights/:date', async (c) => {
  const date = c.req.param('date');
  await c.env.DB.prepare('DELETE FROM weights WHERE date = ?').bind(date).run();
  await invalidateFrom(c.env.DB, date);
  return c.json({ ok: true });
});

// ---------- 通算記録 ----------

app.get('/stats', async (c) => {
  const db = c.env.DB;
  const profile = await getProfile(db);
  if (!profile) return c.json({ needsSetup: true });
  const t = today(c);
  const to = c.req.query('to') ?? t;
  const from = c.req.query('from') ?? addDays(to, -30);
  if (!isDate(from) || !isDate(to) || from > to) return bad(c, '期間が不正です');
  await ensureLedger(db, profile, c.env.TIME_ZONE);

  const [intake, health, ledger, weights] = await Promise.all([
    db.prepare('SELECT date, SUM(kcal) AS kcal, SUM(protein) AS p, SUM(fat) AS f, SUM(carbs) AS c, COUNT(*) AS n FROM entries WHERE date BETWEEN ? AND ? GROUP BY date').bind(from, to).all<{ date: string; kcal: number; p: number; f: number; c: number; n: number }>(),
    db.prepare('SELECT date, active_kcal, resting_kcal FROM health_daily WHERE date BETWEEN ? AND ?').bind(from, to).all<{ date: string; active_kcal: number; resting_kcal: number | null }>(),
    db.prepare('SELECT date, allowance, debt_after, overage FROM day_ledger WHERE date BETWEEN ? AND ?').bind(from, to).all<{ date: string; allowance: number; debt_after: number; overage: number }>(),
    loadWeightsUntil(db, to),
  ]);
  const intakeMap = new Map(intake.results.map((r) => [r.date, r]));
  const healthMap = new Map(health.results.map((r) => [r.date, r]));
  const ledgerMap = new Map(ledger.results.map((r) => [r.date, r]));
  const weightMap = new Map(weights.map((w) => [w.date, w.kg]));
  const openDebt = await debtBefore(db, addDays(to, 1));

  const days: DayStat[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const i = intakeMap.get(d);
    const h = healthMap.get(d);
    const l = ledgerMap.get(d);
    const w = weightOn(d, weights, profile.start_weight);
    let allowance = l?.allowance ?? null;
    // まだ締めていない日（今日・昨日）はその場で計算する
    if (!l && d >= profile.start_date && d <= t) {
      allowance = planDay({ profile, date: d, weight: w, activeKcal: h?.active_kcal ?? 0, debtBefore: openDebt }).allowance;
    }
    days.push({
      date: d,
      intake: i?.kcal ?? 0,
      protein: i?.p ?? 0,
      fat: i?.f ?? 0,
      carbs: i?.c ?? 0,
      recorded: !!i && i.n > 0,
      activeKcal: h?.active_kcal ?? null,
      restingKcal: h?.resting_kcal ?? null,
      burn: h ? h.active_kcal + (h.resting_kcal ?? calcBmr(profile, w)) : null,
      allowance,
      weight: weightMap.get(d) ?? null,
      debt: l?.debt_after ?? (d >= profile.start_date && d <= t ? openDebt : null),
      overage: l?.overage ?? null,
    });
  }
  return c.json({ profile, days });
});

// ---------- バックアップ ----------

app.get('/export', async (c) => {
  const db = c.env.DB;
  const tables = ['profile', 'weights', 'health_daily', 'foods', 'entries', 'favorites', 'combos', 'day_ledger'];
  const out: Record<string, unknown[]> = {};
  for (const t of tables) out[t] = (await db.prepare(`SELECT * FROM ${t}`).all()).results;
  c.header('content-disposition', `attachment; filename="foodiet-${today(c)}.json"`);
  return c.json({ exportedAt: nowIso(), ...out });
});

// ---------- ショートカット用 ----------

/** 未入力の食事を知らせる文面（なければ空文字） */
async function reminderText(c: C): Promise<string> {
  const t = today(c);
  const hour = Number(timeIn(c.env.TIME_ZONE).slice(0, 2));
  const { results } = await c.env.DB.prepare('SELECT DISTINCT meal FROM entries WHERE date = ?').bind(t).all<{ meal: Meal }>();
  const done = new Set(results.map((r) => r.meal));
  const due: [Meal, number][] = [['breakfast', 10], ['lunch', 14], ['dinner', 21]];
  const missing = due.filter(([m, h]) => hour >= h && !done.has(m)).map(([m]) => MEAL_LABEL[m]);
  return missing.length ? `${missing.join('・')}が未入力です` : '';
}

/**
 * ヘルスケアの値を受け取る。項目はすべて省略できる
 *   active / resting: 今日のアクティブ・安静時エネルギー（kcal）
 *   yesterday_active / yesterday_resting: 昨日の分
 *   weight: 最新の体重（kg）
 */
app.post('/shortcut/health', async (c) => {
  const db = c.env.DB;
  const ct = c.req.header('content-type') ?? '';
  const body: Record<string, unknown> = ct.includes('json') ? await c.req.json() : Object.fromEntries(await c.req.formData());
  const t = isDate(body.date) ? body.date : today(c);
  const y = addDays(t, -1);
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [];
  const upsert = (date: string, active: number | null, resting: number | null) => {
    if (active === null && resting === null) return;
    stmts.push(
      db
        .prepare(
          `INSERT INTO health_daily (date, active_kcal, resting_kcal, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (date) DO UPDATE SET
             active_kcal = COALESCE(?, active_kcal), resting_kcal = COALESCE(?, resting_kcal), updated_at = excluded.updated_at`,
        )
        .bind(date, active ?? 0, resting, now, active, resting),
    );
  };
  upsert(y, toNumber(body.yesterday_active), toNumber(body.yesterday_resting));
  upsert(t, toNumber(body.active), toNumber(body.resting));
  const weight = toNumber(body.weight);
  if (weight && weight >= 20 && weight <= 300) {
    // 手入力した体重は上書きしない
    stmts.push(
      db
        .prepare(
          `INSERT INTO weights (date, kg, source, updated_at) VALUES (?, ?, 'health', ?)
           ON CONFLICT (date) DO UPDATE SET kg = excluded.kg, updated_at = excluded.updated_at WHERE weights.source = 'health'`,
        )
        .bind(t, weight, now),
    );
  }
  if (stmts.length) {
    await db.batch(stmts);
    await invalidateFrom(db, y);
  }

  let remaining = '';
  const profile = await getProfile(db);
  if (profile) {
    await ensureLedger(db, profile, c.env.TIME_ZONE);
    const [weights, health, intake, debt] = await Promise.all([
      loadWeightsUntil(db, t),
      db.prepare('SELECT active_kcal FROM health_daily WHERE date = ?').bind(t).first<{ active_kcal: number }>(),
      db.prepare('SELECT COALESCE(SUM(kcal), 0) AS kcal FROM entries WHERE date = ?').bind(t).first<{ kcal: number }>(),
      debtBefore(db, t),
    ]);
    const plan = planDay({ profile, date: t, weight: weightOn(t, weights, profile.start_weight), activeKcal: health?.active_kcal ?? 0, debtBefore: debt });
    const rest = Math.round(plan.allowance - (intake?.kcal ?? 0));
    remaining = rest >= 0 ? `今日はあと${rest}kcal食べられます` : `今日は${-rest}kcalオーバーしています`;
  }
  return c.json({ ok: true, remaining, reminder: await reminderText(c) });
});

app.get('/shortcut/reminders', async (c) => c.json({ reminder: await reminderText(c) }));

export const onRequest = handle(app);
