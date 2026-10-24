import { useState } from 'react';
import { nutrientsFor } from '../../shared/calc';
import type { Food } from '../../shared/types';
import { g1, kcal } from '../format';
import { NumberInput } from './ui';

export interface QtyValue {
  qty: number;
  servingLabel: string | null;
}

/** 目安量（茶碗1杯など）×個数、または g などの単位で量を選ぶ */
export function QuantityPicker({ food, value, onChange }: { food: Food; value: QtyValue; onChange: (v: QtyValue) => void }) {
  const serving = food.servings.find((s) => s.label === value.servingLabel) ?? null;
  const [count, setCount] = useState<number | null>(serving ? value.qty / serving.qty : null);
  const n = nutrientsFor(food, value.qty);

  const pickServing = (label: string | null) => {
    const s = food.servings.find((x) => x.label === label);
    if (s) {
      setCount(1);
      onChange({ qty: s.qty, servingLabel: s.label });
    } else {
      onChange({ qty: value.qty, servingLabel: null });
    }
  };

  const setCountValue = (c: number | null) => {
    setCount(c);
    if (serving && c !== null) onChange({ qty: serving.qty * c, servingLabel: serving.label });
  };

  const step = (d: number) => {
    if (serving) setCountValue(Math.max(0.5, Math.round(((count ?? 1) + d * 0.5) * 2) / 2));
    else {
      const unitStep = food.unit === 'g' || food.unit === 'ml' ? 10 : 1;
      onChange({ qty: Math.max(0, Math.round(value.qty + d * unitStep)), servingLabel: null });
    }
  };

  return (
    <div>
      {food.servings.length > 0 && (
        <div className="chips" style={{ marginBottom: 12 }} role="group" aria-label="量の目安">
          {food.servings.map((s) => (
            <button key={s.label} className="chip" aria-pressed={value.servingLabel === s.label} onClick={() => pickServing(s.label)}>
              {s.label}
              <span className="muted">（{g1(s.qty)}{food.unit}）</span>
            </button>
          ))}
          <button className="chip" aria-pressed={!serving} onClick={() => pickServing(null)}>
            {food.unit}で入力
          </button>
        </div>
      )}
      <div className="stepper">
        <button className="btn" onClick={() => step(-1)} aria-label="減らす">
          −
        </button>
        <div className="grow">
          {serving ? (
            <NumberInput value={count} onChange={setCountValue} unit="倍" ariaLabel="個数" />
          ) : (
            <NumberInput value={value.qty} onChange={(q) => onChange({ qty: q ?? 0, servingLabel: null })} unit={food.unit} ariaLabel="量" />
          )}
        </div>
        <button className="btn" onClick={() => step(1)} aria-label="増やす">
          ＋
        </button>
      </div>
      {serving && (
        <p className="sub" style={{ margin: '6px 0 0', textAlign: 'center' }}>
          {g1(value.qty)}
          {food.unit}
        </p>
      )}
      <div className="nutri">
        <div>
          <b>{kcal(n.kcal)}</b>
          <span>kcal</span>
        </div>
        <div>
          <b>{g1(n.protein)}</b>
          <span>たんぱく質g</span>
        </div>
        <div>
          <b>{g1(n.fat)}</b>
          <span>脂質g</span>
        </div>
        <div>
          <b>{g1(n.carbs)}</b>
          <span>炭水化物g</span>
        </div>
      </div>
    </div>
  );
}
