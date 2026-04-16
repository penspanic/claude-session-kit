import type { Migration } from "./index.js";

// A regular table holds user-message content per session, and an FTS5 virtual
// table in `external content` mode indexes it. Triggers keep them in sync.
//
// Tokenizer: `unicode61 remove_diacritics 0` keeps CJK codepoints searchable
// without stripping diacritics, so "café" still matches "café" in user
// messages that mix English and other scripts.
const SQL = `
CREATE TABLE user_messages (
  source_key  TEXT    NOT NULL,
  host_id     TEXT    NOT NULL,
  seq         INTEGER NOT NULL,
  timestamp   TEXT,
  content     TEXT    NOT NULL,
  PRIMARY KEY (source_key, host_id, seq)
);

CREATE INDEX idx_user_messages_session
  ON user_messages (source_key, host_id);

CREATE VIRTUAL TABLE user_messages_fts USING fts5(
  content,
  content='user_messages',
  tokenize='unicode61 remove_diacritics 0'
);

CREATE TRIGGER user_messages_ai AFTER INSERT ON user_messages BEGIN
  INSERT INTO user_messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER user_messages_ad AFTER DELETE ON user_messages BEGIN
  INSERT INTO user_messages_fts(user_messages_fts, rowid, content)
    VALUES('delete', old.rowid, old.content);
END;

CREATE TRIGGER user_messages_au AFTER UPDATE ON user_messages BEGIN
  INSERT INTO user_messages_fts(user_messages_fts, rowid, content)
    VALUES('delete', old.rowid, old.content);
  INSERT INTO user_messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
`;

const migration: Migration = {
  version: 3,
  name: "user_messages_fts",
  sql: SQL,
};

export default migration;
