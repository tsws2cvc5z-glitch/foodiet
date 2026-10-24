import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type { Meal, Profile } from '../shared/types';
import { api } from './api';
import { ErrorNotice, Icon, type IconName } from './components/ui';
import { localDate } from './format';
import { MealEntry } from './screens/MealEntry';
import { Setup } from './screens/Setup';
import { Today } from './screens/Today';

// グラフのライブラリが大きいので、通算記録を開いたときに読み込む
const Records = lazy(() => import('./screens/Records').then((m) => ({ default: m.Records })));

type Tab = 'today' | 'records' | 'add';
const TABS: [Tab, string, IconName][] = [
  ['today', '今日のサマリー', 'home'],
  ['records', '通算記録', 'chart'],
  ['add', '食事登録', 'plus'],
];

export function App() {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('today');
  const [settings, setSettings] = useState(false);
  const [date, setDate] = useState(localDate());
  const [addInit, setAddInit] = useState<{ meal?: Meal; date?: string }>({});
  // 食事登録画面を開くたびに状態をリセットするためのキー
  const [addKey, setAddKey] = useState(0);

  const loadProfile = useCallback(() => {
    api
      .profile()
      .then((r) => {
        setProfile(r.profile);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(loadProfile, [loadProfile]);

  const needsSetup = useCallback(() => setProfile(null), []);

  const go = (t: Tab) => {
    if (t === 'add') {
      setAddInit({});
      setAddKey((k) => k + 1);
    }
    if (t === 'today') setDate(localDate());
    setSettings(false);
    setTab(t);
    window.scrollTo(0, 0);
  };

  if (error && profile === undefined) {
    return (
      <main className="app">
        <ErrorNotice message={error} />
      </main>
    );
  }
  if (profile === undefined) return <main className="app loading">読み込み中…</main>;
  if (profile === null) {
    return (
      <main className="app">
        <Setup profile={null} onDone={loadProfile} />
      </main>
    );
  }

  return (
    <>
      <main className="app">
        {settings ? (
          <Setup
            profile={profile}
            onBack={() => setSettings(false)}
            onDone={() => {
              setSettings(false);
              loadProfile();
            }}
          />
        ) : tab === 'today' ? (
          <Today
            date={date}
            onDateChange={setDate}
            onSettings={() => setSettings(true)}
            onNeedsSetup={needsSetup}
            onAdd={(meal, d) => {
              setAddInit({ meal, date: d });
              setAddKey((k) => k + 1);
              setTab('add');
              window.scrollTo(0, 0);
            }}
          />
        ) : tab === 'records' ? (
          <Suspense fallback={<div className="loading">読み込み中…</div>}>
            <Records onNeedsSetup={needsSetup} />
          </Suspense>
        ) : (
          <MealEntry
            key={addKey}
            initial={addInit}
            onDone={(d) => {
              setDate(d);
              setTab('today');
              window.scrollTo(0, 0);
            }}
          />
        )}
      </main>
      <div className="tabbar">
        <nav>
          {TABS.map(([t, label, icon]) => (
            <button key={t} aria-current={!settings && tab === t ? 'page' : undefined} onClick={() => go(t)}>
              <Icon name={icon} size={24} />
              {label}
            </button>
          ))}
        </nav>
      </div>
    </>
  );
}
