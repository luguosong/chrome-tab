package com.personal.newtab.page;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface PageRepository extends JpaRepository<Page, Long> {

    List<Page> findByUserIdOrderBySortOrderAscIdAsc(Long userId);

    /** 越权安全：按 id+user 查；不属于当前 user 视为不存在。 */
    Optional<Page> findByIdAndUserId(Long id, Long userId);
}
