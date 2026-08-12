package com.personal.newtab.configversion;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.Optional;

/**
 * 配置版本读写(ADR-0006)。{@link #touch} 在调用方写事务内执行(PROPAGATION_REQUIRED 默认),
 * 与配置写原子:写回滚则版本不前进。GET /api/config 经 {@link #getUpdatedAt} 下发当前版本。
 */
@Service
@RequiredArgsConstructor
public class ConfigVersionService {

    private final ConfigVersionRepository repository;

    /** upsert 当前用户的版本时间戳为 now。置于写事务末尾调用。 */
    @Transactional
    public void touch(Long userId) {
        ConfigVersion v = repository.findById(userId).orElseGet(() -> {
            ConfigVersion n = new ConfigVersion();
            n.setUserId(userId);
            return n;
        });
        v.setUpdatedAt(LocalDateTime.now());
        repository.save(v);
    }

    /** 当前版本时间戳;无行(未写过/未 seed)时为空,前端视为最旧。 */
    public Optional<LocalDateTime> getUpdatedAt(Long userId) {
        return repository.findById(userId).map(ConfigVersion::getUpdatedAt);
    }
}
