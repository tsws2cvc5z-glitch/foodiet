-- 初期設定と目標（1行だけ使う）
CREATE TABLE profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  sex TEXT NOT NULL CHECK (sex IN ('male', 'female')),
  age INTEGER NOT NULL,
  height_cm REAL NOT NULL,
  start_date TEXT NOT NULL,
  start_weight REAL NOT NULL,
  target_weight REAL NOT NULL,
  target_date TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 体重（1日1件）
CREATE TABLE weights (
  date TEXT PRIMARY KEY,
  kg REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  updated_at TEXT NOT NULL
);

-- ヘルスケアから届いた消費カロリー（1日1件、同期のたびに上書き）
CREATE TABLE health_daily (
  date TEXT PRIMARY KEY,
  active_kcal REAL NOT NULL DEFAULT 0,
  resting_kcal REAL,
  updated_at TEXT NOT NULL
);

-- 自分で登録した食品。栄養は base_qty（unit 単位）あたり
CREATE TABLE foods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  base_qty REAL NOT NULL,
  kcal REAL NOT NULL,
  protein REAL NOT NULL DEFAULT 0,
  fat REAL NOT NULL DEFAULT 0,
  carbs REAL NOT NULL DEFAULT 0,
  servings TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'custom',
  note TEXT,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- 食事の記録。食品はあとで変更されても記録が変わらないよう、登録時の値を保存する
CREATE TABLE entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  meal TEXT NOT NULL CHECK (meal IN ('breakfast', 'lunch', 'dinner', 'snack')),
  time TEXT,
  food_ref TEXT NOT NULL,
  name TEXT NOT NULL,
  qty REAL NOT NULL,
  unit TEXT NOT NULL,
  serving_label TEXT,
  kcal REAL NOT NULL,
  protein REAL NOT NULL,
  fat REAL NOT NULL,
  carbs REAL NOT NULL,
  food TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX entries_date ON entries (date);
CREATE INDEX entries_food_ref ON entries (food_ref);

-- お気に入り
CREATE TABLE favorites (
  food_ref TEXT PRIMARY KEY,
  food TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- よく食べる組み合わせ。items は登録時と同じ形の配列（JSON）
CREATE TABLE combos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  items TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 締めた日ごとの枠と借金。過去のデータが変わったら、その日以降を消して計算し直す
CREATE TABLE day_ledger (
  date TEXT PRIMARY KEY,
  allowance REAL NOT NULL,
  intake REAL NOT NULL,
  recorded INTEGER NOT NULL,
  repayment REAL NOT NULL,
  overage REAL NOT NULL,
  debt_before REAL NOT NULL,
  debt_after REAL NOT NULL,
  bmr REAL NOT NULL,
  active_kcal REAL NOT NULL,
  deficit REAL NOT NULL,
  weight REAL NOT NULL
);
