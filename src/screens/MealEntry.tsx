import { useCallback, useEffect, useMemo, useState } from 'react';
import { nutrientsFor, sumInputs } from '../../shared/calc';
import { MEALS, MEAL_LABEL, type Combo, type EntryInput, type Food, type Meal } from '../../shared/types';
import { api, type RecentFood } from '../api';
import { FoodForm } from '../components/FoodForm';
import { QuantityPicker, type QtyValue } from '../components/QuantityPicker';
import { Icon, Notice, Sheet, useToast } from '../components/ui';
import { loadMext, search, toSearchable, type Searchable } from '../foods';
import { dateLabel, kcal, localDate, localTime, qtyLabel } from '../format';

type Tab = 'recent' | 'favorites' | 'mine' | 'combos';
const TABS: [Tab, string][] = [
  ['recent', '履歴'],
  ['favorites', 'お気に入り'],
  ['mine', 'マイ食品'],
  ['combos', 'セット'],
];

const SKIP_FOOD: Food = { ref: 'skip', name: '食べなかった', unit: '', baseQty: 1, kcal: 0, protein: 0, fat: 0, carbs: 0, servings: [], source: 'custom' };

/** 時刻から区分を推測する */
function guessMeal(d = new Date()): Meal {
  const h = d.getHours();
  if (h >= 4 && h < 10) return 'breakfast';
  if (h >= 10 && h < 15) return 'lunch';
  if (h >= 17 && h < 23) return 'dinner';
  return 'snack';
}

interface Props {
  initial: { meal?: Meal; date?: string };
  onDone: (date: string) => void;
}

export function MealEntry({ initial, onDone }: Props) {
  const toast = useToast();
  const today = localDate();
  const [date, setDate] = useState(initial.date ?? today);
  const [meal, setMeal] = useState<Meal>(initial.meal ?? guessMeal());
  const [time, setTime] = useState(localTime());
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('recent');
  const [cart, setCart] = useState<EntryInput[]>([]);
  const [picking, setPicking] = useState<{ food: Food; value: QtyValue; index?: number } | null>(null);
  const [formFood, setFormFood] = useState<Food | 'new' | null>(null);
  const [showCart, setShowCart] = useState(false);
  const [saving, setSaving] = useState(false);

  const [mext, setMext] = useState<Searchable[]>([]);
  const [mine, setMine] = useState<Food[]>([]);
  const [recent, setRecent] = useState<RecentFood[]>([]);
  const [favorites, setFavorites] = useState<Food[]>([]);
  const [combos, setCombos] = useState<Combo[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    Promise.all([api.foods(), api.recent(), api.favorites(), api.combos()])
      .then(([f, r, fav, c]) => {
        setMine(f);
        setRecent(r);
        setFavorites(fav);
        setCombos(c);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    reload();
    loadMext().then(setMext).catch(() => setError('食品データを読み込めませんでした'));
  }, [reload]);

  const favRefs = useMemo(() => new Set(favorites.map((f) => f.ref)), [favorites]);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    // 自分の食品・お気に入り・履歴を成分表より先に出す
    const own = [...mine, ...favorites, ...recent.map((r) => r.food)].map(toSearchable);
    const seen = new Set<string>();
    return [...search(own, query, 30), ...search(mext, query)].filter((f) => !seen.has(f.ref) && seen.add(f.ref));
  }, [query, mine, favorites, recent, mext]);

  const open = (food: Food, value?: QtyValue) => {
    const s = food.servings[0];
    setPicking({ food, value: value ?? (s ? { qty: s.qty, servingLabel: s.label } : { qty: food.baseQty, servingLabel: null }) });
  };

  const openRecent = (r: RecentFood) => open(r.food, { qty: r.qty, servingLabel: r.serving_label });

  const addToCart = () => {
    if (!picking) return;
    const item: EntryInput = { food: picking.food, qty: picking.value.qty, serving_label: picking.value.servingLabel };
    setCart((c) => (picking.index === undefined ? [...c, item] : c.map((x, i) => (i === picking.index ? item : x))));
    setPicking(null);
    setQuery('');
  };

  const toggleFavorite = async (food: Food) => {
    if (favRefs.has(food.ref)) await api.removeFavorite(food.ref);
    else await api.addFavorite(food);
    setFavorites(await api.favorites());
  };

  const submit = async (items: EntryInput[]) => {
    setSaving(true);
    try {
      await api.addEntries(date, meal, items[0].food.ref === 'skip' ? null : time, items);
      toast(`${MEAL_LABEL[meal]}を登録しました`);
      setCart([]);
      onDone(date);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const saveCombo = async () => {
    const name = prompt('セットの名前（例：いつもの朝食）');
    if (!name?.trim()) return;
    await api.createCombo(name.trim(), cart);
    toast('セットを保存しました');
    setCombos(await api.combos());
  };

  const total = sumInputs(cart);

  return (
    <>
      <header className="topbar">
        <span className="spacer" />
        <h1>食事登録</h1>
        <span className="spacer" />
      </header>

      <section className="card">
        <div className="segmented" role="group" aria-label="区分" style={{ marginBottom: 10 }}>
          {MEALS.map((m) => (
            <button key={m} aria-pressed={meal === m} onClick={() => setMeal(m)}>
              {MEAL_LABEL[m]}
            </button>
          ))}
        </div>
        <div className="grid-2">
          <label>
            <span className="sub">日付</span>
            <input className="input" type="date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </label>
          <label>
            <span className="sub">時刻</span>
            <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        </div>
        {date !== today && <p className="sub" style={{ margin: '6px 0 0' }}>{dateLabel(date, today)}の記録として登録します</p>}
      </section>

      <div className="search">
        <div style={{ position: 'relative' }}>
          <span className="search-icon">
            <Icon name="search" size={18} />
          </span>
          <input className="input" type="search" placeholder="食品を検索（例：ごはん、卵、バナナ）" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="食品を検索" />
        </div>
      </div>

      {error && <Notice kind="error">{error}</Notice>}

      {query.trim() ? (
        <section className="card">
          {results.length === 0 ? (
            <div className="empty">
              見つかりませんでした。
              <br />
              <button className="link-btn" onClick={() => setFormFood('new')}>
                「{query}」を自分の食品として登録
              </button>
            </div>
          ) : (
            <FoodList foods={results} onPick={(f) => open(f)} />
          )}
        </section>
      ) : (
        <>
          <div className="segmented" role="tablist" style={{ marginBottom: 12 }}>
            {TABS.map(([t, label]) => (
              <button key={t} role="tab" aria-pressed={tab === t} aria-selected={tab === t} onClick={() => setTab(t)}>
                {label}
              </button>
            ))}
          </div>
          <section className="card">
            {tab === 'recent' &&
              (recent.length ? (
                <ul className="list">
                  {recent.slice(0, 50).map((r) => (
                    <li key={r.food.ref}>
                      <button className="list-item" onClick={() => openRecent(r)}>
                        <span className="main">
                          <span className="name">{r.food.name}</span>
                          <span className="meta">
                            {qtyLabel(r.qty, r.food.unit, r.serving_label, r.food.servings.find((s) => s.label === r.serving_label)?.qty)}・{r.n}回
                          </span>
                        </span>
                        <span className="kcal">{kcal(nutrientsFor(r.food, r.qty).kcal)} kcal</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="empty">登録した食品がここに出ます。上の検索から探してください。</div>
              ))}
            {tab === 'favorites' && (favorites.length ? <FoodList foods={favorites} onPick={(f) => open(f)} /> : <div className="empty">食品を選ぶ画面の ☆ でお気に入りに追加できます。</div>)}
            {tab === 'mine' && (
              <>
                <button className="btn block" style={{ marginBottom: 8 }} onClick={() => setFormFood('new')}>
                  <Icon name="plus" size={18} />
                  食品を登録
                </button>
                {mine.length ? (
                  <FoodList foods={mine} onPick={(f) => open(f)} onEdit={(f) => setFormFood(f)} />
                ) : (
                  <div className="empty">コンビニの商品などを、パッケージの栄養成分表示から登録できます。</div>
                )}
              </>
            )}
            {tab === 'combos' &&
              (combos.length ? (
                <ul className="list">
                  {combos.map((c) => (
                    <li key={c.id} className="row">
                      <button
                        className="list-item"
                        onClick={() => {
                          setCart((x) => [...x, ...c.items]);
                          toast(`「${c.name}」を追加しました`);
                        }}
                      >
                        <span className="main">
                          <span className="name">{c.name}</span>
                          <span className="meta">{c.items.map((i) => i.food.name).join('、')}</span>
                        </span>
                        <span className="kcal">{kcal(sumInputs(c.items).kcal)} kcal</span>
                      </button>
                      <button
                        className="icon-btn"
                        aria-label={`${c.name}を削除`}
                        onClick={async () => {
                          if (!confirm(`「${c.name}」を削除しますか？`)) return;
                          await api.deleteCombo(c.id);
                          setCombos(await api.combos());
                        }}
                      >
                        <Icon name="trash" size={18} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="empty">いくつか食品を選んだあと、「セットとして保存」で登録できます。</div>
              ))}
          </section>
          {cart.length === 0 && (
            <button className="btn block" disabled={saving} onClick={() => submit([{ food: SKIP_FOOD, qty: 0 }])}>
              {MEAL_LABEL[meal]}は食べなかった
            </button>
          )}
        </>
      )}

      {cart.length > 0 && (
        <div className="cart">
          <div>
            <button className="grow link-btn" style={{ textAlign: 'left', color: 'var(--text)' }} onClick={() => setShowCart(true)}>
              <span className="sub">{cart.length}品</span> <b className="num">{kcal(total.kcal)} kcal</b>
              <span className="sub"> ・中身を見る</span>
            </button>
            <button className="btn primary" disabled={saving} onClick={() => submit(cart)}>
              登録
            </button>
          </div>
        </div>
      )}

      {picking && (
        <Sheet
          title={
            <span className="row" style={{ alignItems: 'flex-start' }}>
              <span className="grow">{picking.food.name}</span>
              {picking.food.ref !== 'skip' && (
                <button className="icon-btn" style={{ marginTop: -8, color: favRefs.has(picking.food.ref) ? 'var(--warning)' : undefined }} onClick={() => toggleFavorite(picking.food)} aria-label="お気に入り" aria-pressed={favRefs.has(picking.food.ref)}>
                  <Icon name="star" filled={favRefs.has(picking.food.ref)} />
                </button>
              )}
            </span>
          }
          onClose={() => setPicking(null)}
        >
          <QuantityPicker food={picking.food} value={picking.value} onChange={(value) => setPicking((p) => p && { ...p, value })} />
          <button className="btn primary block" disabled={picking.value.qty <= 0} onClick={addToCart}>
            {picking.index === undefined ? '追加' : '変更'}
          </button>
        </Sheet>
      )}

      {showCart && (
        <Sheet title={`${MEAL_LABEL[meal]}・${cart.length}品`} onClose={() => setShowCart(false)}>
          <ul className="list">
            {cart.map((item, i) => (
              <li key={i} className="row">
                <button
                  className="list-item"
                  onClick={() => {
                    setShowCart(false);
                    setPicking({ food: item.food, value: { qty: item.qty, servingLabel: item.serving_label ?? null }, index: i });
                  }}
                >
                  <span className="main">
                    <span className="name">{item.food.name}</span>
                    <span className="meta">{qtyLabel(item.qty, item.food.unit, item.serving_label, item.food.servings.find((s) => s.label === item.serving_label)?.qty)}</span>
                  </span>
                  <span className="kcal">{kcal(nutrientsFor(item.food, item.qty).kcal)} kcal</span>
                </button>
                <button className="icon-btn" aria-label="外す" onClick={() => setCart((c) => c.filter((_, j) => j !== i))}>
                  <Icon name="close" size={18} />
                </button>
              </li>
            ))}
          </ul>
          <div className="grid-2" style={{ marginTop: 12 }}>
            <button className="btn" onClick={saveCombo} disabled={cart.length === 0}>
              セットとして保存
            </button>
            <button
              className="btn primary"
              disabled={saving || cart.length === 0}
              onClick={() => {
                setShowCart(false);
                submit(cart);
              }}
            >
              登録
            </button>
          </div>
        </Sheet>
      )}

      {formFood && (
        <FoodForm
          food={formFood === 'new' ? undefined : formFood}
          onClose={() => {
            setFormFood(null);
            reload();
          }}
          onSaved={(f) => {
            setFormFood(null);
            setQuery('');
            reload();
            open(f);
          }}
        />
      )}
    </>
  );
}

function FoodList({ foods, onPick, onEdit }: { foods: Food[]; onPick: (f: Food) => void; onEdit?: (f: Food) => void }) {
  return (
    <ul className="list">
      {foods.map((f) => {
        const s = f.servings[0];
        const n = nutrientsFor(f, s ? s.qty : f.baseQty);
        return (
          <li key={f.ref} className="row">
            <button className="list-item" onClick={() => onPick(f)}>
              <span className="main">
                <span className="name">
                  {f.source !== 'mext' && <span className="badge">{f.source === 'ai' ? 'AI' : 'マイ'}</span>}
                  {f.name}
                </span>
                <span className="meta">{s ? s.label : `${f.baseQty}${f.unit}`}あたり</span>
              </span>
              <span className="kcal">{kcal(n.kcal)} kcal</span>
            </button>
            {onEdit && (
              <button className="icon-btn" aria-label={`${f.name}を編集`} onClick={() => onEdit(f)}>
                <Icon name="edit" size={18} />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
