import { closeDay, planDay } from '../../shared/calc';
import { addDays, dateIn } from '../../shared/date';
import type { Profile } from '../../shared/types';

export async function getProfile(db: D1Database): Promise<Profile | null> {
  return db
    .prepare('SELECT sex, age, height_cm, start_date, start_weight, target_weight, target_date FROM profile WHERE id = 1')
    .first<Profile>();
}

/** date 以前で最新の体重（なければ開始時の体重） */
export function weightOn(date: string, weights: { date: string; kg: number }[], fallback: number): number {
  let w = fallback;
  for (const row of weights) {
    if (row.date > date) break;
    w = row.kg;
  }
  return w;
}

export async function loadWeightsUntil(db: D1Database, date: string) {
  const { results } = await db
    .prepare('SELECT date, kg FROM weights WHERE date <= ? ORDER BY date')
    .bind(date)
    .all<{ date: string; kg: number }>();
  return results;
}

/** date 以降の締めを取り消す（過去のデータが変わったとき） */
export async function invalidateFrom(db: D1Database, date: string) {
  await db.prepare('DELETE FROM day_ledger WHERE date >= ?').bind(date).run();
}

/** date より前に締めた日の借金残高 */
export async function debtBefore(db: D1Database, date: string): Promise<number> {
  const row = await db
    .prepare('SELECT debt_after FROM day_ledger WHERE date < ? ORDER BY date DESC LIMIT 1')
    .bind(date)
    .first<{ debt_after: number }>();
  return row?.debt_after ?? 0;
}

/**
 * 昨日までの締めを進める。
 * 昨日は、今日になってからヘルスケアの同期があるか、今日の12時を過ぎたら締める
 * （前日のアクティブカロリーを確定させてから借金を決めるため）
 */
export async function ensureLedger(
  db: D1Database,
  profile: Profile,
  timeZone: string,
  now = new Date(),
): Promise<{ pendingYesterday: boolean }> {
  const today = dateIn(timeZone, now);
  const yesterday = addDays(today, -1);
  const last = await db
    .prepare('SELECT date, debt_after FROM day_ledger ORDER BY date DESC LIMIT 1')
    .first<{ date: string; debt_after: number }>();
  let from = last ? addDays(last.date, 1) : profile.start_date;
  if (from < profile.start_date) from = profile.start_date;
  let debt = last?.debt_after ?? 0;

  let until = yesterday;
  if (from <= yesterday) {
    // 今日になってから一度でも同期があれば、昨日の分は送り終わっている
    const lastSync = await db.prepare('SELECT MAX(updated_at) AS t FROM health_daily').first<{ t: string | null }>();
    const syncedToday = lastSync?.t ? dateIn(timeZone, new Date(lastSync.t)) > yesterday : false;
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now));
    if (!syncedToday && hour < 12) until = addDays(today, -2);
  }
  const pendingYesterday = from <= yesterday && until < yesterday;
  if (from > until) return { pendingYesterday };

  const [intakeRows, healthRows, weights] = await Promise.all([
    db
      .prepare('SELECT date, SUM(kcal) AS kcal, COUNT(*) AS n FROM entries WHERE date BETWEEN ? AND ? GROUP BY date')
      .bind(from, until)
      .all<{ date: string; kcal: number; n: number }>(),
    db
      .prepare('SELECT date, active_kcal FROM health_daily WHERE date BETWEEN ? AND ?')
      .bind(from, until)
      .all<{ date: string; active_kcal: number }>(),
    loadWeightsUntil(db, until),
  ]);
  const intake = new Map(intakeRows.results.map((r) => [r.date, r]));
  const active = new Map(healthRows.results.map((r) => [r.date, r.active_kcal]));

  const stmt = db.prepare(
    `INSERT OR REPLACE INTO day_ledger
     (date, allowance, intake, recorded, repayment, overage, debt_before, debt_after, bmr, active_kcal, deficit, weight)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const inserts: D1PreparedStatement[] = [];
  for (let d = from; d <= until; d = addDays(d, 1)) {
    const weight = weightOn(d, weights, profile.start_weight);
    const plan = planDay({ profile, date: d, weight, activeKcal: active.get(d) ?? 0, debtBefore: debt });
    const day = intake.get(d);
    const recorded = !!day && day.n > 0;
    const kcal = day?.kcal ?? 0;
    const closed = closeDay(plan, debt, kcal, recorded);
    inserts.push(
      stmt.bind(
        d,
        plan.allowance,
        kcal,
        recorded ? 1 : 0,
        closed.repayment,
        closed.overage,
        debt,
        closed.debtAfter,
        plan.bmr,
        plan.activeKcal,
        plan.deficit,
        weight,
      ),
    );
    debt = closed.debtAfter;
  }
  // D1 の batch は 1 回あたりの文の数に上限があるので分ける
  for (let i = 0; i < inserts.length; i += 50) await db.batch(inserts.slice(i, i + 50));
  return { pendingYesterday };
}
