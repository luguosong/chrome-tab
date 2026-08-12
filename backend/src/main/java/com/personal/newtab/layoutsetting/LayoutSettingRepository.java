package com.personal.newtab.layoutsetting;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface LayoutSettingRepository extends JpaRepository<LayoutSetting, Long> {

    Optional<LayoutSetting> findByUserId(Long userId);
}
