import { useEffect, useMemo, useState } from 'react';
import { calcBmr, goalCheck } from '../../shared/calc';
import { addDays } from '../../shared/date';
import type { Profile, Sex } from '../../shared/types';
import { api } from '../api';
import { Icon, Notice, NumberInput, useToast } from '../components/ui';
import { kcal, localDate } from '../format';

interface Props {
  /** 既存の設定（なければ初回） */
  profile: Profile | null;
  onDone: () => void;
  onBack?: () => void;
}

export function Setup({ profile, onDone, onBack }: Props) {
  const today = localDate();
  const toast = useToast();
  const [sex, setSex] = useState<Sex>(profile?.sex ?? 'male');
  const [age, setAge] = useState<number | null>(profile?.age ?? null);
  const [height, setHeight] = useState<number | null>(profile?.height_cm ?? null);
  const [current, setCurrent] = useState<number | null>(null);
  const [target, setTarget] = useState<number | null>(profile?.target_weight ?? null);
  const [targetDate, setTargetDate] = useState(profile?.target_date ?? addDays(today, 90));
  const [reset, setReset] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isFirst = !profile;

  // 設定し直すときの初期値として最新の体重を入れておく
  useEffect(() => {
    if (!profile) return;
    api.summary().then((s) => 'plan' in s && setCurrent((c) => c ?? s.plan.weight)).catch(() => {});
  }, [profile]);
  const startWeight = isFirst || reset ? current : profile.start_weight;
  const ready = !!(age && height && target && startWeight && targetDate);

  const preview = useMemo(() => {
    if (!ready) return null;
    const p: Profile = {
      sex,
      age: age!,
      height_cm: height!,
      start_date: today,
      start_weight: startWeight!,
      target_weight: target!,
      target_date: targetDate,
    };
    const check = goalCheck({ ...p, start_weight: current ?? startWeight! }, today);
    const bmr = calcBmr(p, current ?? startWeight!);
    return { check, bmr, base: bmr - check.dailyDeficit };
  }, [ready, sex, age, height, startWeight, current, target, targetDate, today]);

  const save = async () => {
    if (!ready) return;
    setSaving(true);
    setError(null);
    try {
      await api.saveProfile({
        sex,
        age: age!,
        height_cm: height!,
        target_weight: target!,
        target_date: targetDate,
        current_weight: current ?? undefined,
        reset: isFirst || reset,
      });
      toast(isFirst ? '設定しました' : '保存しました');
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const months = (n: number) => {
    const d = new Date();
    d.setMonth(d.getMonth() + n);
    setTargetDate(localDate(d));
  };

  return (
    <>
      <header className="topbar">
        {onBack ? (
          <button className="icon-btn" onClick={onBack} aria-label="戻る">
            <Icon name="left" />
          </button>
        ) : (
          <span className="spacer" />
        )}
        <h1>{isFirst ? 'はじめに' : '設定'}</h1>
        <span className="spacer" />
      </header>

      {isFirst && (
        <p className="sub" style={{ marginTop: 0 }}>
          今日食べていい量を計算するために、あなたのことと目標を教えてください。あとから変更できます。
        </p>
      )}

      <section className="card">
        <h2>あなたについて</h2>
        <div className="field">
          <span>性別（基礎代謝の計算に使います）</span>
          <div className="segmented" role="group" aria-label="性別">
            <button aria-pressed={sex === 'male'} onClick={() => setSex('male')}>
              男性
            </button>
            <button aria-pressed={sex === 'female'} onClick={() => setSex('female')}>
              女性
            </button>
          </div>
        </div>
        <div className="grid-2">
          <label className="field">
            <span>年齢</span>
            <NumberInput value={age} onChange={setAge} unit="歳" step="1" />
          </label>
          <label className="field">
            <span>身長</span>
            <NumberInput value={height} onChange={setHeight} unit="cm" />
          </label>
        </div>
        {(isFirst || reset) && (
          <label className="field" style={{ marginBottom: 0 }}>
            <span>現在の体重</span>
            <NumberInput value={current} onChange={setCurrent} unit="kg" />
          </label>
        )}
      </section>

      <section className="card">
        <h2>目標</h2>
        <div className="grid-2">
          <label className="field">
            <span>目標体重</span>
            <NumberInput value={target} onChange={setTarget} unit="kg" />
          </label>
          <label className="field">
            <span>期限</span>
            <input className="input" type="date" value={targetDate} min={addDays(today, 1)} onChange={(e) => setTargetDate(e.target.value)} />
          </label>
        </div>
        <div className="chips" style={{ marginBottom: 4 }}>
          {[3, 6, 12].map((n) => (
            <button key={n} className="chip" onClick={() => months(n)}>
              {n === 12 ? '1年後' : `${n}か月後`}
            </button>
          ))}
        </div>
        {!isFirst && (
          <label className="row" style={{ marginTop: 12, fontSize: 14 }}>
            <input type="checkbox" checked={reset} onChange={(e) => setReset(e.target.checked)} />
            <span>今日から目標を設定し直す（借金もリセット）</span>
          </label>
        )}
      </section>

      {preview && (
        <section className="card">
          <h2>目安</h2>
          {preview.check.message && <Notice kind={preview.check.level === 'error' ? 'error' : 'warn'}>{preview.check.message}</Notice>}
          {preview.check.level === 'ok' && preview.base < preview.bmr * 0.8 && (
            <Notice kind="warn">運動しない日は枠が基礎代謝の8割を下回るため、下限の値にしています。運動するか、期限を延ばすと目標に近づけます。</Notice>
          )}
          <table className="breakdown">
            <tbody>
              <tr>
                <td>基礎代謝</td>
                <td>{kcal(preview.bmr)} kcal</td>
              </tr>
              <tr>
                <td>1日の赤字（目標達成に必要な分）</td>
                <td>−{kcal(preview.check.dailyDeficit)} kcal</td>
              </tr>
              <tr className="total">
                <td>運動しない日の枠</td>
                <td>{kcal(Math.max(preview.base, preview.bmr * 0.8))} kcal</td>
              </tr>
            </tbody>
          </table>
          <p className="sub" style={{ marginBottom: 0 }}>
            運動したぶん（ヘルスケアのアクティブエネルギー）だけ、その日の枠が増えます。
          </p>
        </section>
      )}

      {error && <Notice kind="error">{error}</Notice>}
      <button className="btn primary block" disabled={!ready || saving || preview?.check.level === 'error'} onClick={save}>
        {saving ? '保存中…' : isFirst ? 'はじめる' : '保存'}
      </button>

      {!isFirst && <Extras />}
    </>
  );
}

/** 設定画面の下の方：ヘルスケア連携とバックアップ */
function Extras() {
  const endpoint = `${location.origin}/api/shortcut/health`;
  return (
    <>
      <section className="card" style={{ marginTop: 24 }}>
        <h2>ヘルスケア連携（ショートカット）</h2>
        <p className="sub" style={{ marginTop: 0 }}>
          iPhone の「ショートカット」アプリで、ヘルスケアの消費カロリーと体重をこのアプリに送ります。作り方はリポジトリの docs/SETUP.md の「ヘルスケア連携」を見てください。
        </p>
        <label className="field" style={{ marginBottom: 0 }}>
          <span>送り先の URL</span>
          <input className="input" readOnly value={endpoint} onFocus={(e) => e.target.select()} />
        </label>
      </section>
      <section className="card">
        <h2>バックアップ</h2>
        <p className="sub" style={{ marginTop: 0 }}>
          すべての記録を JSON ファイルでダウンロードします。
        </p>
        <a className="btn block" href="/api/export" download>
          データを書き出す
        </a>
      </section>
      <p className="sub" style={{ textAlign: 'center' }}>
        食品データ：日本食品標準成分表2020年版（八訂）（文部科学省）
      </p>
    </>
  );
}
