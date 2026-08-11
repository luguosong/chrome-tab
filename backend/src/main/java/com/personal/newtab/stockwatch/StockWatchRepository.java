package com.personal.newtab.stockwatch;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface StockWatchRepository extends JpaRepository<StockWatch, Long> {

    List<StockWatch> findByUserIdOrderByGroupNameAscSortOrderAscIdAsc(Long userId);

    Optional<StockWatch> findByIdAndUserId(Long id, Long userId);
}
