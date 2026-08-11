package com.personal.newtab.icon;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface IconRepository extends JpaRepository<Icon, Long> {

    List<Icon> findByUserIdOrderByPageIdAscSortOrderAscIdAsc(Long userId);

    List<Icon> findByPageIdOrderBySortOrderAscIdAsc(Long pageId);
}
