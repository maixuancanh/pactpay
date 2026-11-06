CREATE TABLE room_attendance (
 room_id text NOT NULL,
 user_id text NOT NULL,
 confirmed_at timestamptz NOT NULL,
 PRIMARY KEY (room_id,user_id),
 FOREIGN KEY (room_id,user_id) REFERENCES room_members(room_id,user_id) ON DELETE CASCADE
);
