package com.personal.newtab.setting;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "settings")
@Getter @Setter
@NoArgsConstructor @AllArgsConstructor
public class Setting {

    @Id
    @Column(name = "user_id")
    private Long userId;

    @Column(nullable = false, length = 16)
    private String theme = "system";

    // updated_at 由 MySQL 维护（DEFAULT/ON UPDATE CURRENT_TIMESTAMP），实体不映射
}
