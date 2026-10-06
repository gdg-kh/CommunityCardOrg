-- 1. 會眾簽到打卡紀錄表
CREATE TABLE IF NOT EXISTS checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    github_id TEXT NOT NULL,
    community_id TEXT NOT NULL,
    event_date TEXT NOT NULL,
    event_name TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(github_id, community_id, event_date)
);

CREATE INDEX IF NOT EXISTS idx_checkins_user ON checkins(github_id);
CREATE INDEX IF NOT EXISTS idx_checkins_community ON checkins(community_id);

-- 2. 組織者查驗與打勾紀錄表 (純紀錄免鎖定)
CREATE TABLE IF NOT EXISTS verifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_github_id TEXT NOT NULL,
    verified_by TEXT NOT NULL,
    notes TEXT,
    verified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_verifications_target ON verifications(target_github_id);
