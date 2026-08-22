package com.personal.newtab.changelog;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Collection;
import java.util.List;

public interface ChangelogTranslationRepository extends JpaRepository<ChangelogTranslation, String> {

    /** 一次捞回全部现有块译文,供拼装与缺失比对(块数 ≤ 版本数,~几百)。 */
    List<ChangelogTranslation> findByBlockHashIn(Collection<String> blockHashes);
}
