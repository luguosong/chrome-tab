package com.personal.newtab.icon;

/**
 * 图标尺寸（见 CONTEXT.md）。
 * 在 8 列网格中：small=1×1、medium=2×2、large=3×2 个格子。
 * cells() 返回该尺寸占用的格子数——容量校验用。
 */
public enum Size {
    SMALL(1),
    MEDIUM(4),
    LARGE(6);

    private final int cells;

    Size(int cells) {
        this.cells = cells;
    }

    public int cells() {
        return cells;
    }
}
