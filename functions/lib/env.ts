export interface Env {
  DB: D1Database;
  TIME_ZONE: string;
  /** 'none' のとき認証しない（ローカル開発用） */
  AUTH_MODE?: string;
  /** ショートカットが Authorization: Bearer で送るトークン */
  API_TOKEN?: string;
  /** Cloudflare Access のチーム名（<team>.cloudflareaccess.com） */
  ACCESS_TEAM_DOMAIN?: string;
  /** Cloudflare Access アプリケーションの AUD タグ */
  ACCESS_AUD?: string;
}

export type AppEnv = { Bindings: Env };
