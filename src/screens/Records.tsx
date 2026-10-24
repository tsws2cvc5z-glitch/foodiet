import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts';
import { addDays, diffDays } from '../../shared/date';
import type { DayStat, Profile } from '../../shared/types';
import { api } from '../api';
import { ErrorNotice, Icon } from '../components/ui';
import { g1, kcal, localDate } from '../format';

type Period = 'day' | 'week' | 'month' | 'year';
const PERIODS: [Period, string][] = [
  ['day', '日'],
  ['week', '週'],
  ['month', '月'],
  ['year', '年'],
];

/** 表示範囲（offset 0 が最新） */
function range(period: Period, offset: number, startDate: string): { from: string; to: string } {
  const today = localDate();
  if (period === 'day') {
    const to = addDays(today, -14 * offset);
    return { from: addDays(to, -13), to };
  }
  if (period === 'week') {
    const dow = (new Date(`${today}T00:00:00`).getDay() + 6) % 7; // 月曜始まり
    const thisMonday = addDays(today, -dow);
    const to = addDays(thisMonday, 6 - 7 * 12 * offset);
    return { from: addDays(to, -7 * 12 + 1), to };
  }
  if (period === 'month') {
    const d = new Date(`${today}T00:00:00`);
    const end = new Date(d.getFullYear(), d.getMonth() - 12 * offset + 1, 0);
    const begin = new Date(end.getFullYear(), end.getMonth() - 11, 1);
    return { from: localDate(begin), to: localDate(end) };
  }
  const y = new Date().getFullYear();
  const startYear = Math.max(Number(startDate.slice(0, 4)), y - 4);
  return { from: `${startYear}-01-01`, to: `${y}-12-31` };
}

function groupKey(period: Period, date: string): string {
  if (period === 'day') return date;
  if (period === 'week') {
    const dow = (new Date(`${date}T00:00:00`).getDay() + 6) % 7;
    return addDays(date, -dow);
  }
  if (period === 'month') return date.slice(0, 7);
  return date.slice(0, 4);
}

function tickLabel(period: Period, key: string): string {
  if (period === 'day') return `${Number(key.slice(5, 7))}/${Number(key.slice(8))}`;
  if (period === 'week') return `${Number(key.slice(5, 7))}/${Number(key.slice(8))}〜`;
  if (period === 'month') return `${Number(key.slice(5))}月`;
  return `${key}年`;
}

interface Point {
  key: string;
  label: string;
  intake: number | null;
  burn: number | null;
  allowance: number | null;
  weight: number | null;
  plan: number | null;
  debt: number | null;
  p: number | null;
  f: number | null;
  c: number | null;
  recordedDays: number;
  overDays: number;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sum = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) : null);

function aggregate(days: DayStat[], period: Period, mode: 'avg' | 'sum', profile: Profile): Point[] {
  const groups = new Map<string, DayStat[]>();
  for (const d of days) {
    const k = groupKey(period, d.date);
    groups.set(k, [...(groups.get(k) ?? []), d]);
  }
  const totalDays = diffDays(profile.start_date, profile.target_date);
  const planOn = (date: string) => {
    const t = diffDays(profile.start_date, date);
    if (t < 0 || t > totalDays) return null;
    return profile.start_weight + ((profile.target_weight - profile.start_weight) * t) / totalDays;
  };
  const agg = mode === 'avg' || period === 'day' ? avg : sum;
  return [...groups.entries()].map(([key, ds]) => {
    const rec = ds.filter((d) => d.recorded);
    const burns = ds.flatMap((d) => (d.burn === null ? [] : [d.burn]));
    const allowances = rec.flatMap((d) => (d.allowance === null ? [] : [d.allowance]));
    const weights = ds.flatMap((d) => (d.weight === null ? [] : [d.weight]));
    const debts = ds.flatMap((d) => (d.debt === null ? [] : [d.debt]));
    const pk = sum(rec.map((d) => d.protein * 4)) ?? 0;
    const fk = sum(rec.map((d) => d.fat * 9)) ?? 0;
    const ck = sum(rec.map((d) => d.carbs * 4)) ?? 0;
    const tot = pk + fk + ck;
    const last = ds[ds.length - 1].date;
    return {
      key,
      label: tickLabel(period, key),
      intake: agg(rec.map((d) => d.intake)),
      burn: agg(burns),
      allowance: agg(allowances),
      weight: avg(weights),
      plan: planOn(period === 'day' ? key : last),
      debt: debts.length ? debts[debts.length - 1] : null,
      p: tot ? (pk / tot) * 100 : null,
      f: tot ? (fk / tot) * 100 : null,
      c: tot ? (ck / tot) * 100 : null,
      recordedDays: rec.length,
      overDays: ds.filter((d) => (d.overage ?? 0) > 0).length,
    };
  });
}

const axis = { stroke: 'var(--muted)', fontSize: 11, tickLine: false };
const grid = <CartesianGrid stroke="var(--line)" vertical={false} />;

function Tip({ active, payload, label, unit, names }: TooltipProps<number, string> & { unit: string; names: Record<string, string> }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="tooltip">
      <b>{label}</b>
      {payload
        .filter((p) => p.value !== null && p.value !== undefined && names[String(p.dataKey)])
        .map((p) => (
          <div key={String(p.dataKey)} className="num">
            {names[String(p.dataKey)]}：{unit === 'kg' || unit === '%' ? g1(Number(p.value)) : kcal(Number(p.value))}
            {unit}
          </div>
        ))}
    </div>
  );
}

export function Records({ onNeedsSetup }: { onNeedsSetup: () => void }) {
  const [period, setPeriod] = useState<Period>('day');
  const [offset, setOffset] = useState(0);
  const [mode, setMode] = useState<'avg' | 'sum'>('avg');
  const [data, setData] = useState<{ profile: Profile; days: DayStat[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startDate, setStartDate] = useState<string | null>(null);

  useEffect(() => {
    api.profile().then((r) => (r.profile ? setStartDate(r.profile.start_date) : onNeedsSetup()));
  }, [onNeedsSetup]);

  const r = useMemo(() => (startDate ? range(period, offset, startDate) : null), [period, offset, startDate]);

  useEffect(() => {
    if (!r) return;
    let alive = true;
    setData(null);
    api
      .stats(r.from, r.to)
      .then((res) => {
        if (!alive) return;
        if ('needsSetup' in res) return onNeedsSetup();
        setData(res);
        setError(null);
      })
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [r, onNeedsSetup]);

  const today = localDate();
  const points = useMemo(() => {
    if (!data) return [];
    // 未来の日は集計に含めない
    const days = data.days.filter((d) => d.date <= today);
    return days.length ? aggregate(days, period, mode, data.profile) : [];
  }, [data, period, mode, today]);

  const summary = useMemo(() => {
    if (!data) return null;
    const days = data.days.filter((d) => d.date <= today);
    const rec = days.filter((d) => d.recorded);
    const weights = days.filter((d) => d.weight !== null);
    return {
      intake: avg(rec.map((d) => d.intake)),
      burn: avg(days.flatMap((d) => (d.burn === null ? [] : [d.burn]))),
      overDays: days.filter((d) => (d.overage ?? 0) > 0).length,
      recorded: rec.length,
      total: days.length,
      weightChange: weights.length >= 2 ? weights[weights.length - 1].weight! - weights[0].weight! : null,
    };
  }, [data, today]);

  const rangeLabel = r ? `${r.from.replaceAll('-', '/')} 〜 ${(r.to > today ? today : r.to).replaceAll('-', '/')}` : '';
  const kcalUnit = period !== 'day' && mode === 'sum' ? '合計' : period === 'day' ? '' : '1日平均';
  const hasWeight = points.some((p) => p.weight !== null);

  return (
    <>
      <header className="topbar">
        <span className="spacer" />
        <h1>通算記録</h1>
        <span className="spacer" />
      </header>

      <div className="segmented" role="group" aria-label="期間" style={{ marginBottom: 8 }}>
        {PERIODS.map(([p, label]) => (
          <button
            key={p}
            aria-pressed={period === p}
            onClick={() => {
              setPeriod(p);
              setOffset(0);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="icon-btn" disabled={period === 'year'} onClick={() => setOffset((o) => o + 1)} aria-label="前の期間">
          <Icon name="left" />
        </button>
        <div className="grow sub num" style={{ textAlign: 'center' }}>
          {rangeLabel}
        </div>
        <button className="icon-btn" disabled={offset === 0} onClick={() => setOffset((o) => o - 1)} aria-label="次の期間">
          <Icon name="right" />
        </button>
      </div>

      {error && <ErrorNotice message={error} />}
      {!data ? (
        !error && <div className="loading">読み込み中…</div>
      ) : (
        <>
          {summary && (
            <section className="card">
              <div className="stats-grid">
                <div className="stat">
                  <span>平均摂取</span>
                  <b className="num">
                    {summary.intake === null ? '—' : kcal(summary.intake)}
                    <small>kcal</small>
                  </b>
                </div>
                <div className="stat">
                  <span>平均消費</span>
                  <b className="num">
                    {summary.burn === null ? '—' : kcal(summary.burn)}
                    <small>kcal</small>
                  </b>
                </div>
                <div className="stat">
                  <span>体重の変化</span>
                  <b className="num">
                    {summary.weightChange === null ? '—' : `${summary.weightChange > 0 ? '+' : ''}${g1(summary.weightChange)}`}
                    <small>kg</small>
                  </b>
                </div>
                <div className="stat">
                  <span>記録した日</span>
                  <b className="num">
                    {summary.recorded}
                    <small>/{summary.total}日</small>
                  </b>
                </div>
                <div className="stat">
                  <span>枠を超えた日</span>
                  <b className="num" style={{ color: summary.overDays ? 'var(--critical)' : undefined }}>
                    {summary.overDays}
                    <small>日</small>
                  </b>
                </div>
                <div className="stat">
                  <span>借金（期間末）</span>
                  <b className="num">
                    {kcal(points.at(-1)?.debt ?? 0)}
                    <small>kcal</small>
                  </b>
                </div>
              </div>
            </section>
          )}

          <section className="card">
            <div className="card-head">
              <h2>摂取と消費{kcalUnit && <span className="sub">（{kcalUnit}）</span>}</h2>
              {period !== 'day' && (
                <div className="segmented" style={{ width: 130 }}>
                  <button aria-pressed={mode === 'avg'} onClick={() => setMode('avg')}>
                    平均
                  </button>
                  <button aria-pressed={mode === 'sum'} onClick={() => setMode('sum')}>
                    合計
                  </button>
                </div>
              )}
            </div>
            <div className="legend">
              <span>
                <i style={{ background: 'var(--series-1)' }} />
                摂取
              </span>
              <span>
                <i className="line" style={{ background: 'var(--series-2)' }} />
                消費
              </span>
              <span>
                <i className="dash" />
                枠
              </span>
            </div>
            <div className="chart">
              <ResponsiveContainer>
                <ComposedChart data={points} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
                  {grid}
                  <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={8} />
                  <YAxis {...axis} width={44} tickFormatter={(v) => (v >= 10000 ? `${Math.round(v / 1000)}k` : String(v))} />
                  <Tooltip content={<Tip unit="kcal" names={{ intake: '摂取', burn: '消費', allowance: '枠' }} />} cursor={{ fill: 'var(--surface-2)' }} />
                  <Bar isAnimationActive={false} dataKey="intake" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={24} />
                  <Line isAnimationActive={false} dataKey="burn" stroke="var(--series-2)" strokeWidth={2} dot={false} connectNulls />
                  <Line isAnimationActive={false} dataKey="allowance" stroke="var(--muted)" strokeWidth={2} strokeDasharray="4 4" dot={false} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="card">
            <h2>体重</h2>
            <div className="legend">
              <span>
                <i className="line" style={{ background: 'var(--series-1)' }} />
                体重{period !== 'day' && '（平均）'}
              </span>
              <span>
                <i className="dash" />
                予定ライン
              </span>
            </div>
            {hasWeight ? (
              <div className="chart">
                <ResponsiveContainer>
                  <LineChart data={points} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
                    {grid}
                    <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={8} />
                    <YAxis {...axis} width={44} domain={['dataMin - 1', 'dataMax + 1']} tickFormatter={(v) => g1(v)} />
                    <Tooltip content={<Tip unit="kg" names={{ weight: '体重', plan: '予定' }} />} />
                    <Line isAnimationActive={false} dataKey="plan" stroke="var(--muted)" strokeWidth={2} strokeDasharray="4 4" dot={false} connectNulls />
                    <Line isAnimationActive={false} dataKey="weight" stroke="var(--series-1)" strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)', fill: 'var(--series-1)' }} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="empty">この期間の体重の記録はありません</div>
            )}
          </section>

          <section className="card">
            <h2>PFC バランス（エネルギー比）</h2>
            <div className="legend">
              <span>
                <i style={{ background: 'var(--series-1)' }} />
                たんぱく質
              </span>
              <span>
                <i style={{ background: 'var(--series-2)' }} />
                脂質
              </span>
              <span>
                <i style={{ background: 'var(--series-3)' }} />
                炭水化物
              </span>
              <span className="muted">目安 20 : 25 : 55</span>
            </div>
            <div className="chart" style={{ height: 180 }}>
              <ResponsiveContainer>
                <BarChart data={points} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
                  {grid}
                  <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={8} />
                  <YAxis {...axis} width={44} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} unit="%" />
                  <Tooltip content={<Tip unit="%" names={{ p: 'たんぱく質', f: '脂質', c: '炭水化物' }} />} cursor={{ fill: 'var(--surface-2)' }} />
                  <Bar isAnimationActive={false} dataKey="p" stackId="pfc" fill="var(--series-1)" stroke="var(--surface)" strokeWidth={1} maxBarSize={24} />
                  <Bar isAnimationActive={false} dataKey="f" stackId="pfc" fill="var(--series-2)" stroke="var(--surface)" strokeWidth={1} maxBarSize={24} />
                  <Bar isAnimationActive={false} dataKey="c" stackId="pfc" fill="var(--series-3)" stroke="var(--surface)" strokeWidth={1} radius={[4, 4, 0, 0]} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="card">
            <h2>借金の推移</h2>
            <div className="chart" style={{ height: 160 }}>
              <ResponsiveContainer>
                <AreaChart data={points} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
                  {grid}
                  <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={8} />
                  <YAxis {...axis} width={44} allowDecimals={false} />
                  <Tooltip content={<Tip unit="kcal" names={{ debt: '借金' }} />} />
                  <Area isAnimationActive={false} dataKey="debt" stroke="var(--series-1)" strokeWidth={2} fill="var(--series-1)" fillOpacity={0.15} connectNulls />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>
        </>
      )}
    </>
  );
}
