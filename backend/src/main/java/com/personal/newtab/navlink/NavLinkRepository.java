package com.personal.newtab.navlink;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface NavLinkRepository extends JpaRepository<NavLink, Long> {

    List<NavLink> findByUserIdOrderBySortOrderAscIdAsc(Long userId);

    Optional<NavLink> findByIdAndUserId(Long id, Long userId);
}
