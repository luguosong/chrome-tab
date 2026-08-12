package com.personal.newtab.configversion;

import org.springframework.data.jpa.repository.JpaRepository;

/** {@link ConfigVersion} 的 @Id 即 userId,findById(userId) 直接可用。 */
public interface ConfigVersionRepository extends JpaRepository<ConfigVersion, Long> {
}
