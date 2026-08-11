/**
 * 容量约定常量（对齐 ADR-0002 与 CONTEXT.md）。
 * 后端单一事实源：Size.cells() / IconModelMigration.DEFAULT_CAPACITY_CELLS（见 backend）。
 * 前端镜像此约定用于即时反馈（角标、新增抽屉预校验），服务端校验为最终防线。
 *
 * 注意：完整容量逻辑（cellsUsed / canFit / capacityFor）在 issue 05 实现；
 * 本文件仅导出共享约定常量，避免越界。
 */

/** 尺寸 → 占用格子数。6 列网格：small=1×1、medium=2×2、large=3×2。 */
export const CELLS_PER_SIZE = {
  small: 1,
  medium: 4,
  large: 6,
} as const

/** 类型定义用的尺寸字面量联合。 */
export type SizeKey = keyof typeof CELLS_PER_SIZE

/** 后端兜底默认容量（6 列 × 4 行 = 24 格）。前端按实际视口即时反馈，服务端最终校验。 */
export const DEFAULT_PAGE_CAPACITY = 24
