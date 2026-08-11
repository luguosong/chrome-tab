-- ADR-0001：多态 Icon 表。
-- pages = 走马灯的固定画布（一屏）；icons = 元素级最小单位，type 区分 nav/stock/changelog，
-- data 用 TEXT（非 MySQL JSON 类型）+ JPA AttributeConverter 存 JSON——换取 MySQL/H2 方言一致（见测试决策）。
-- 旧 nav_links / stock_watches 在本 ticket 保留，删除在 03。
CREATE TABLE pages (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id     BIGINT NOT NULL,
    name        VARCHAR(64) NOT NULL,
    sort_order  INT NOT NULL DEFAULT 0,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_page_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_page_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE icons (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id     BIGINT NOT NULL,
    page_id     BIGINT NOT NULL,
    type        VARCHAR(32) NOT NULL,               -- nav / stock / changelog
    size        VARCHAR(16) NOT NULL,               -- small / medium / large
    sort_order  INT NOT NULL DEFAULT 0,
    data        TEXT,                               -- JSON（由 AttributeConverter 序列化）
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_icon_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_icon_page FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE,
    INDEX idx_icon_user (user_id),
    INDEX idx_icon_page (page_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
