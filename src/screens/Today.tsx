import { useCallback, useEffect, useState } from 'react';
import { addDays } from '../../shared/date';
import { MEALS, MEAL_LABEL, type Entry, type Meal, type Summary } from '../../shared/types';
import { api } from '../api';
import { Gauge } from '../components/Gauge';
import { QuantityPicker, type QtyValue } from '../components/QuantityPicker';
import { ErrorNotice, Icon, Notice, NumberInput, Sheet, useToast } from '../components/ui';
import { dateLabel, g1, kcal, localDate, qtyLabel } from '../format';

/** ヘルスケア送信用ショートカットの名前（README の手順と合わせる） */
export const SHORTCUT_NAME = 'Foodiet同期';

interface Props {
  date: string;
  onDateChange: (d: string) => void;
  onAdd: (meal: Meal, date: string) => void;
  onSettings: () => void;
  onNeedsSetup: () => void;
}

export function Today({ date, onDateChange, onAdd, onSettings, onNeedsSetup }: Props) {
  const today = localDate();
  const [s, setS] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Entry | null>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.summary(date);
      if ('needsSetup' in res) return onNeedsSetup();
      setS(res);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [date, onNeedsSetup]);

  useEffect(() => {
    load();
    // ショートカットから戻ってきたときなどに読み直す
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  return (
    <>
      <header className="topbar">
        <button className="icon-btn" onClick={() => onDateChange(addDays(date, -1))} aria-label="前の日">
          <Icon name="left" />
        </button>
        <h1>{dateLabel(date, today)}</h1>
        <button className="icon-btn" onClick={() => onDateChange(addDays(date, 1))} disabled={date >= today} aria-label="次の日">
          <Icon name="right" />
        </button>
        <button className="icon-btn" onClick={onSettings} aria-label="設定">
          <Icon name="gear" />
        </button>
      </header>

      {error && <ErrorNotice message={error} />}
      {!s ? (
        !error && <div className="loading">読み込み中…</div>
      ) : (
        <>
          {s.plan.pastDeadline && (
            <Notice kind="warn">
              目標の期限を過ぎました。設定から目標を設定し直してください。
            </Notice>
          )}
          {s.plan.floorApplied && !s.plan.pastDeadline && (
            <Notice kind="warn">
              枠が基礎代謝の8割を下回るため、下限の {kcal(s.plan.floor)} kcal にしています。期限を延ばすことを検討してください。
            </Notice>
          )}

          <section className="card">
            <Gauge intake={s.intake.kcal} allowance={s.plan.allowance} />
            <button className="link-btn" style={{ display: 'block', margin: '0 auto' }} onClick={() => setShowBreakdown((v) => !v)} aria-expanded={showBreakdown}>
              {showBreakdown ? '内訳を閉じる' : '枠の内訳を見る'}
            </button>
            {showBreakdown && (
              <table className="breakdown" style={{ marginTop: 8 }}>
                <tbody>
                  <tr>
                    <td>基礎代謝</td>
                    <td>{kcal(s.plan.bmr)} kcal</td>
                  </tr>
                  <tr>
                    <td>アクティブ（ヘルスケア）</td>
                    <td>＋{kcal(s.plan.activeKcal)} kcal</td>
                  </tr>
                  <tr>
                    <td>1日の赤字（残り{s.plan.daysLeft}日）</td>
                    <td>−{kcal(s.plan.deficit)} kcal</td>
                  </tr>
                  <tr>
                    <td>借金の返済</td>
                    <td>−{kcal(s.plan.repayment)} kcal</td>
                  </tr>
                  {s.plan.floorApplied && (
                    <tr>
                      <td>下限による調整</td>
                      <td>＋{kcal(s.plan.allowance - s.plan.rawAllowance)} kcal</td>
                    </tr>
                  )}
                  <tr className="total">
                    <td>今日の枠</td>
                    <td>{kcal(s.plan.allowance)} kcal</td>
                  </tr>
                </tbody>
              </table>
            )}
          </section>

          <div className="grid-2">
            <DebtCard debt={s.debt} pending={s.pendingYesterday} />
            <WeightCard key={date} date={date} weight={s.weightToday} latest={s.plan.weight} target={s.profile.target_weight} onSaved={load} />
          </div>

          <section className="card">
            <h2>PFC バランス</h2>
            <PfcBar label="たんぱく質" value={s.intake.protein} target={s.pfcTarget.protein} color="var(--series-1)" />
            <PfcBar label="脂質" value={s.intake.fat} target={s.pfcTarget.fat} color="var(--series-2)" />
            <PfcBar label="炭水化物" value={s.intake.carbs} target={s.pfcTarget.carbs} color="var(--series-3)" />
          </section>

          <section className="card">
            <h2>食事</h2>
            {MEALS.map((meal) => (
              <MealBlock key={meal} meal={meal} entries={s.entries.filter((e) => e.meal === meal)} onAdd={() => onAdd(meal, date)} onEdit={setEditing} />
            ))}
          </section>

          <SyncCard lastSync={s.lastSync} />
        </>
      )}

      {editing && (
        <EntrySheet
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </>
  );
}

function DebtCard({ debt, pending }: { debt: number; pending: boolean }) {
  return (
    <section className="card">
      <div className="sub">借金</div>
      <div style={{ fontSize: 22, fontWeight: 700 }} className="num">
        {kcal(debt)}
        <small style={{ fontSize: 13, marginLeft: 2 }}>kcal</small>
      </div>
      <div className="sub">{pending ? '昨日の分は同期後に確定' : debt > 0 ? '毎日少しずつ返済中' : '借金なし'}</div>
    </section>
  );
}

function WeightCard({ date, weight, latest, target, onSaved }: { date: string; weight: number | null; latest: number; target: number; onSaved: () => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<number | null>(weight ?? latest);
  const save = async () => {
    if (!value) return;
    try {
      await api.saveWeight(date, value);
      toast('体重を記録しました');
      setEditing(false);
      onSaved();
    } catch (e) {
      toast((e as Error).message);
    }
  };
  return (
    <section className="card">
      <div className="sub">体重</div>
      {editing ? (
        <div className="row" style={{ marginTop: 4 }}>
          <div className="grow">
            <NumberInput value={value} onChange={setValue} unit="kg" ariaLabel="体重" />
          </div>
          <button className="icon-btn" onClick={save} aria-label="保存" style={{ color: 'var(--brand)' }}>
            <Icon name="check" />
          </button>
        </div>
      ) : weight !== null ? (
        <>
          <button className="link-btn" style={{ color: 'var(--text)', fontSize: 22, fontWeight: 700, padding: 0 }} onClick={() => setEditing(true)}>
            {g1(weight)}
            <small style={{ fontSize: 13, marginLeft: 2 }}>kg</small>
          </button>
          <div className="sub">目標まで {g1(Math.max(weight - target, 0))} kg</div>
        </>
      ) : (
        <>
          <button className="btn small" style={{ marginTop: 4 }} onClick={() => setEditing(true)}>
            記録する
          </button>
          <div className="sub">前回 {g1(latest)} kg</div>
        </>
      )}
    </section>
  );
}

function PfcBar({ label, value, target, color }: { label: string; value: number; target: number; color: string }) {
  const ratio = target > 0 ? value / target : 0;
  return (
    <div className="bar-row">
      <div className="bar-label">
        <span>{label}</span>
        <span className="num">
          {g1(value)} / {g1(target)} g{ratio > 1.2 && <span className="badge" style={{ marginLeft: 6 }}>多め</span>}
        </span>
      </div>
      <div className="bar">
        <div style={{ width: `${Math.min(ratio, 1) * 100}%`, background: color }} />
      </div>
    </div>
  );
}

function MealBlock({ meal, entries, onAdd, onEdit }: { meal: Meal; entries: Entry[]; onAdd: () => void; onEdit: (e: Entry) => void }) {
  const total = entries.reduce((a, e) => a + e.kcal, 0);
  const skipped = entries.length > 0 && entries.every((e) => e.food_ref === 'skip');
  return (
    <div className="meal-block">
      <div className="meal-title">
        <span>
          {MEAL_LABEL[meal]} <span className="sub num">{entries.length > 0 && !skipped && `${kcal(total)} kcal`}</span>
        </span>
        <button className="btn small" onClick={onAdd} aria-label={`${MEAL_LABEL[meal]}を追加`}>
          <Icon name="plus" size={16} />
          追加
        </button>
      </div>
      {entries.length > 0 && (
        <ul className="list">
          {entries.map((e) => (
            <li key={e.id}>
              <button className="list-item" onClick={() => onEdit(e)}>
                <span className="main">
                  <span className="name">{e.name}</span>
                  {e.food_ref !== 'skip' && (
                    <span className="meta">
                      {e.time && `${e.time}・`}
                      {qtyLabel(e.qty, e.unit, e.serving_label, e.food.servings.find((s) => s.label === e.serving_label)?.qty)}
                    </span>
                  )}
                </span>
                {e.food_ref !== 'skip' && <span className="kcal">{kcal(e.kcal)} kcal</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SyncCard({ lastSync }: { lastSync: string | null }) {
  const label = lastSync
    ? new Date(lastSync).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : 'まだ同期していません';
  return (
    <section className="card row">
      <div className="grow">
        <div className="sub">ヘルスケアの最終同期</div>
        <div>{label}</div>
      </div>
      <a className="btn small" href={`shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_NAME)}`}>
        <Icon name="sync" size={16} />
        今すぐ同期
      </a>
    </section>
  );
}

function EntrySheet({ entry, onClose, onSaved }: { entry: Entry; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [qty, setQty] = useState<QtyValue>({ qty: entry.qty, servingLabel: entry.serving_label });
  const [meal, setMeal] = useState<Meal>(entry.meal);
  const [time, setTime] = useState(entry.time ?? '');
  const skip = entry.food_ref === 'skip';

  const save = async () => {
    try {
      await api.updateEntry(entry.id, { qty: qty.qty, serving_label: qty.servingLabel, meal, time: time || null });
      toast('更新しました');
      onSaved();
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const remove = async () => {
    try {
      await api.deleteEntry(entry.id);
      toast('削除しました');
      onSaved();
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <Sheet title={entry.name} onClose={onClose}>
      {!skip && <QuantityPicker food={entry.food} value={qty} onChange={setQty} />}
      <div className="field">
        <span>区分</span>
        <div className="segmented">
          {MEALS.map((m) => (
            <button key={m} aria-pressed={meal === m} onClick={() => setMeal(m)}>
              {MEAL_LABEL[m]}
            </button>
          ))}
        </div>
      </div>
      {!skip && (
        <label className="field">
          <span>時刻</span>
          <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      )}
      <div className="grid-2">
        <button className="btn danger" onClick={remove}>
          <Icon name="trash" size={18} />
          削除
        </button>
        <button className="btn primary" onClick={save}>
          保存
        </button>
      </div>
    </Sheet>
  );
}
