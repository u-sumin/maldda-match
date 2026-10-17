-- Worker가 첫 요청 때 자동 생성합니다. 수동 실행할 필요는 없습니다.
CREATE TABLE IF NOT EXISTS sync_rooms (
  room_id TEXT PRIMARY KEY,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_items (
  room_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  learned INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (room_id,item_id)
);
