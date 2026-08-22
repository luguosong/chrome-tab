package com.personal.newtab.changelog;

import org.springframework.data.jpa.repository.JpaRepository;

public interface ChangelogSnapshotRepository extends JpaRepository<ChangelogSnapshot, Integer> {
}
