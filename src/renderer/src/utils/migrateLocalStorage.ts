/**
 * localStorage 迁移到 SQLite
 * 首次启动时将 localStorage 中的数据迁移到 SQLite
 */

const MIGRATION_KEY = 'labflow_migration_completed'

// 检查是否已迁移
function isMigrationCompleted(): boolean {
  return localStorage.getItem(MIGRATION_KEY) === 'true'
}

// 标记迁移完成
function markMigrationCompleted(): void {
  localStorage.setItem(MIGRATION_KEY, 'true')
}

// 迁移历史记录
async function migrateHistories(): Promise<void> {
  const data = localStorage.getItem('labflow_tube_histories')
  if (!data) return

  try {
    const histories = JSON.parse(data)
    if (Array.isArray(histories) && histories.length > 0) {
      console.log('[Migration] Migrating', histories.length, 'tube histories to SQLite')
      await window.electronAPI!.saveTubeHistories(histories)
      console.log('[Migration] Histories migrated successfully')
    }
  } catch (e) {
    console.error('[Migration] Failed to migrate histories:', e)
  }
}

// 迁移分组数据
async function migrateGroups(): Promise<void> {
  const data = localStorage.getItem('labflow_groups')
  if (!data) return

  try {
    const groups = JSON.parse(data)
    if (Array.isArray(groups) && groups.length > 0) {
      console.log('[Migration] Migrating', groups.length, 'groups to SQLite')
      await window.electronAPI!.saveGroups(groups)
      console.log('[Migration] Groups migrated successfully')
    }
  } catch (e) {
    console.error('[Migration] Failed to migrate groups:', e)
  }
}

// 迁移颜色配置
async function migrateSubstanceColors(): Promise<void> {
  const data = localStorage.getItem('labflow_substance_colors')
  if (!data) return

  try {
    const colors = JSON.parse(data)
    if (Array.isArray(colors) && colors.length > 0) {
      console.log('[Migration] Migrating', colors.length, 'substance colors to SQLite')
      await window.electronAPI!.saveSubstanceColors(colors)
      console.log('[Migration] Substance colors migrated successfully')
    }
  } catch (e) {
    console.error('[Migration] Failed to migrate substance colors:', e)
  }
}

// 执行迁移
export async function migrateLocalStorageToSQLite(): Promise<void> {
  // 检查是否需要迁移
  if (isMigrationCompleted()) {
    return
  }

  // 检查是否在 Electron 环境中
  if (!window.electronAPI) {
    console.log('[Migration] Not in Electron environment, skipping migration')
    markMigrationCompleted()
    return
  }

  console.log('[Migration] Starting localStorage to SQLite migration...')

  try {
    // 迁移各个数据
    await migrateHistories()
    await migrateGroups()
    await migrateSubstanceColors()

    // 标记迁移完成
    markMigrationCompleted()
    console.log('[Migration] Migration completed successfully')

    // 可选：清理 localStorage 中的旧数据
    // 注意：暂时保留，以防需要回滚
    // localStorage.removeItem('labflow_tube_histories')
    // localStorage.removeItem('labflow_groups')
    // localStorage.removeItem('labflow_substance_colors')
  } catch (e) {
    console.error('[Migration] Migration failed:', e)
    // 不标记迁移完成，下次启动会重试
  }
}
