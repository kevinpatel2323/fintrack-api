CREATE TABLE IF NOT EXISTS accounts (
  id BIGSERIAL PRIMARY KEY,
  account_number TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
  id BIGSERIAL PRIMARY KEY,
  transaction_date DATE NOT NULL,
  account_id BIGINT NOT NULL,
  narration TEXT NOT NULL,
  withdrawal NUMERIC(14,2) NOT NULL DEFAULT 0,
  deposit NUMERIC(14,2) NOT NULL DEFAULT 0,
  balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  upi_name TEXT,
  upi_description TEXT,
  upi_bank TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_transactions_account FOREIGN KEY (account_id) REFERENCES accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions (transaction_date);
CREATE INDEX IF NOT EXISTS idx_transactions_account_date ON transactions (account_id, transaction_date);

CREATE TABLE IF NOT EXISTS statement_imports (
  id BIGSERIAL PRIMARY KEY,
  source_bank TEXT NOT NULL DEFAULT 'HDFC',
  filename TEXT,
  account_id BIGINT,
  period_start DATE,
  period_end DATE,
  last_tx_date_before DATE,
  total_rows INT NOT NULL DEFAULT 0,
  inserted_rows INT NOT NULL DEFAULT 0,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_statement_imports_account FOREIGN KEY (account_id) REFERENCES accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_statement_imports_uploaded_at ON statement_imports (uploaded_at);
CREATE INDEX IF NOT EXISTS idx_statement_imports_account ON statement_imports (account_id);

CREATE TABLE IF NOT EXISTS friends (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_friends_name ON friends (name);

CREATE TABLE IF NOT EXISTS transaction_friend_tags (
  id BIGSERIAL PRIMARY KEY,
  transaction_id BIGINT NOT NULL,
  friend_id BIGINT NOT NULL,
  amount NUMERIC(14,2) NOT NULL,
  direction TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_transaction_friend_tags_tx FOREIGN KEY (transaction_id) REFERENCES transactions(id),
  CONSTRAINT fk_transaction_friend_tags_friend FOREIGN KEY (friend_id) REFERENCES friends(id),
  CONSTRAINT uq_transaction_friend UNIQUE (transaction_id, friend_id)
);

CREATE INDEX IF NOT EXISTS idx_transaction_friend_tags_tx ON transaction_friend_tags (transaction_id);
CREATE INDEX IF NOT EXISTS idx_transaction_friend_tags_friend ON transaction_friend_tags (friend_id);
