package com.personal.newtab.changelog;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;

import java.util.concurrent.CompletableFuture;

/**
 * 更新日志定时预取(ADR-0017):每 6 小时后台刷新,取代旧的"打开抽屉才拉取"。
 * 启动两步:先 {@code loadFromDb} 从快照表恢复内存镜像(零外呼,秒级可服务),
 * 再异步预热追平最新(失败仅 warn,沿用现有快照——重启后数据最多旧 6h,永不空窗)。
 */
@Slf4j
@RequiredArgsConstructor
public class ChangelogScheduler {

    private static final long SIX_HOURS_MS = 6L * 60 * 60 * 1000;

    private final ChangelogService service;

    @EventListener(ApplicationReadyEvent.class)
    public void onReady() {
        service.loadFromDb();
        CompletableFuture.runAsync(this::refreshQuietly);
    }

    /** initialDelay 6h:启动预热已跑过,首个周期从预热后起算。 */
    @Scheduled(fixedDelay = SIX_HOURS_MS, initialDelay = SIX_HOURS_MS)
    public void scheduled() {
        refreshQuietly();
    }

    private void refreshQuietly() {
        try {
            service.refresh();
        } catch (Exception e) {
            log.warn("更新日志定时刷新失败,沿用现有快照: {}", e.toString());
        }
    }
}
