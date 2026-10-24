import { useState } from 'react';
import type { Food } from '../../shared/types';
import { api } from '../api';
import { Notice, NumberInput, Sheet, useToast } from './ui';

const UNITS = ['個', '本', '枚', '袋', '杯', '食', '缶', 'g', 'ml'];

/** 自分の食品を登録・編集する（パッケージの栄養成分表示を写す想定） */
export function FoodForm({ food, onClose, onSaved }: { food?: Food; onClose: () => void; onSaved: (f: Food) => void }) {
  const toast = useToast();
  const [name, setName] = useState(food?.name ?? '');
  const [unit, setUnit] = useState(food?.unit ?? '個');
  const [baseQty, setBaseQty] = useState<number | null>(food?.baseQty ?? 1);
  const [kcal, setKcal] = useState<number | null>(food?.kcal ?? null);
  const [protein, setProtein] = useState<number | null>(food?.protein ?? null);
  const [fat, setFat] = useState<number | null>(food?.fat ?? null);
  const [carbs, setCarbs] = useState<number | null>(food?.carbs ?? null);
  // g / ml のときは「1個 = ○g」のような目安を1つ登録できる
  const [servingLabel, setServingLabel] = useState(food?.servings[0]?.label ?? '');
  const [servingQty, setServingQty] = useState<number | null>(food?.servings[0]?.qty ?? null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const byWeight = unit === 'g' || unit === 'ml';
  const ready = name.trim() && baseQty && baseQty > 0 && kcal !== null;

  const save = async () => {
    if (!ready) return;
    setSaving(true);
    setError(null);
    const body: Omit<Food, 'ref'> = {
      name: name.trim(),
      unit,
      baseQty: baseQty!,
      kcal: kcal!,
      protein: protein ?? 0,
      fat: fat ?? 0,
      carbs: carbs ?? 0,
      servings: byWeight && servingLabel.trim() && servingQty ? [{ label: servingLabel.trim(), qty: servingQty }] : [],
      source: food?.source ?? 'custom',
    };
    try {
      const saved = food ? await api.updateFood(Number(food.ref.split(':')[1]), body) : await api.createFood(body);
      toast(food ? '更新しました' : '登録しました');
      onSaved(saved);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!food || !confirm(`「${food.name}」を削除しますか？（過去の記録は残ります）`)) return;
    await api.deleteFood(Number(food.ref.split(':')[1]));
    toast('削除しました');
    onClose();
  };

  return (
    <Sheet title={food ? '食品を編集' : '食品を登録'} onClose={onClose}>
      <label className="field">
        <span>名前</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例：スーパーカップ 超バニラ" />
      </label>
      <div className="field">
        <span>栄養成分表示の基準</span>
        <div className="row">
          <div style={{ width: 110 }}>
            <NumberInput value={baseQty} onChange={setBaseQty} ariaLabel="基準の量" />
          </div>
          <select className="input grow" value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="単位">
            {UNITS.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
          <span className="sub" style={{ whiteSpace: 'nowrap' }}>
            あたり
          </span>
        </div>
      </div>
      <div className="grid-2">
        <label className="field">
          <span>エネルギー</span>
          <NumberInput value={kcal} onChange={setKcal} unit="kcal" />
        </label>
        <label className="field">
          <span>たんぱく質</span>
          <NumberInput value={protein} onChange={setProtein} unit="g" />
        </label>
        <label className="field">
          <span>脂質</span>
          <NumberInput value={fat} onChange={setFat} unit="g" />
        </label>
        <label className="field">
          <span>炭水化物</span>
          <NumberInput value={carbs} onChange={setCarbs} unit="g" />
        </label>
      </div>
      {byWeight && (
        <div className="field">
          <span>量の目安（任意）</span>
          <div className="row">
            <input className="input grow" value={servingLabel} onChange={(e) => setServingLabel(e.target.value)} placeholder="1袋" aria-label="目安の名前" />
            <span>＝</span>
            <div style={{ width: 120 }}>
              <NumberInput value={servingQty} onChange={setServingQty} unit={unit} ariaLabel="目安の量" />
            </div>
          </div>
        </div>
      )}
      {error && <Notice kind="error">{error}</Notice>}
      <div className={food ? 'grid-2' : undefined}>
        {food && (
          <button className="btn danger" onClick={remove}>
            削除
          </button>
        )}
        <button className="btn primary block" disabled={!ready || saving} onClick={save}>
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </Sheet>
  );
}
