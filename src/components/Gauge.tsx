import { kcal } from '../format';
import { Icon } from './ui';

/** 今日の枠に対する摂取量のリングゲージ */
export function Gauge({ intake, allowance }: { intake: number; allowance: number }) {
  const r = 96;
  const c = 2 * Math.PI * r;
  const ratio = allowance > 0 ? intake / allowance : 0;
  const over = intake > allowance;
  const rest = allowance - intake;
  // 超過したときは超過分を赤で重ねる（1周を超えたら全周）
  const main = Math.min(ratio, 1);
  const overRatio = over ? Math.min(ratio - 1, 1) : 0;
  return (
    <div className="gauge" role="img" aria-label={over ? `${kcal(-rest)}kcalオーバー` : `あと${kcal(rest)}kcal`}>
      <svg viewBox="0 0 220 220">
        <circle cx="110" cy="110" r={r} fill="none" stroke="var(--track)" strokeWidth="16" />
        <circle
          cx="110"
          cy="110"
          r={r}
          fill="none"
          stroke={over ? 'var(--muted)' : 'var(--brand)'}
          strokeWidth="16"
          strokeLinecap="round"
          strokeDasharray={`${main * c} ${c}`}
          transform="rotate(-90 110 110)"
        />
        {over && (
          <circle
            cx="110"
            cy="110"
            r={r}
            fill="none"
            stroke="var(--critical)"
            strokeWidth="16"
            strokeLinecap="round"
            strokeDasharray={`${overRatio * c} ${c}`}
            transform="rotate(-90 110 110)"
          />
        )}
      </svg>
      <div className="gauge-center">
        {over ? (
          <>
            <div className="status-over">
              <Icon name="alert" size={14} />
              オーバー
            </div>
            <div className="value num">
              {kcal(-rest)}
              <small>kcal</small>
            </div>
          </>
        ) : (
          <>
            <div className="label">あと</div>
            <div className="value num">
              {kcal(rest)}
              <small>kcal</small>
            </div>
          </>
        )}
        <div className="of num">
          {kcal(intake)} / {kcal(allowance)} kcal
        </div>
      </div>
    </div>
  );
}
