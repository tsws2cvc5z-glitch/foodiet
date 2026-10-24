export const kcal = (n: number) => Math.round(n).toLocaleString('ja-JP');
export const g1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString('ja-JP');

/** 量の表示（例: 茶碗1杯 / 150g / 1.5個） */
export function qtyLabel(qty: number, unit: string, servingLabel?: string | null, servingQty?: number) {
  if (servingLabel && servingQty) {
    const count = Math.round((qty / servingQty) * 100) / 100;
    return count === 1 ? servingLabel : `${servingLabel}×${count}`;
  }
  return `${g1(qty)}${unit}`;
}

export function dateLabel(date: string, today: string) {
  if (date === today) return '今日';
  const d = new Date(`${date}T00:00:00`);
  const w = '日月火水木金土'[d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日（${w}）`;
}

export function localDate(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function localTime(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
