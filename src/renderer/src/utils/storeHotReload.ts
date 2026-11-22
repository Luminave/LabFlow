/**
 * 热加载（第 5 步）：外面的 Agent 改了 `仓库.yml` / `工程/*.yml`，界面不用重启就跟上。
 *
 * 决策部分是纯函数（`planHotReload`），可以单测；
 * 订阅与重载在 `useStoreHotReload` 里，只做「按计划执行」。
 *
 * 防自激在**主进程**：自己写文件前记内容哈希，watcher 看到同一哈希就不广播。
 * 所以这里拿到的每个事件都是「真外部修改」，不需要再判一遍。
 */

import { useEffect } from 'react'

import { useExperimentStore, getProjectFileInfo, hasPendingAutoSave } from '../stores/experimentStore'
import { useWarehouseStore } from '../stores/warehouseStore'
import { useGroupStore } from '../stores/groupStore'
import { useSubstanceColorStore } from '../stores/substanceColorStore'
import { backupBrokenWarehouseFile, loadWarehouseFile } from './warehouseSource'
import { resetWarehouseReagentsCache } from './projectSource'
import { showGlobalToast } from '../components/GlobalToast'

export interface StoreFilesChangedPayload {
  warehouse: boolean
  projects: string[]
}

export interface HotReloadPlan {
  /** 仓库正本变了 → 重读并静默替换内存 */
  reloadWarehouse: boolean
  /** 当前打开的工程文件变了且没有未保存改动 → 直接重载 */
  reloadProject: boolean
  /** 当前工程文件变了但有未保存改动 → 只挂提示条，不覆盖 */
  promptProject: boolean
  /** 列表（首页「最近工程」）里的名字/时间要刷新 */
  refreshProjectList: boolean
}

export interface PlanInput {
  payload: StoreFilesChangedPayload
  /** 当前打开工程的正本文件名（`AD-5.2.yml`），没打开工程就 null */
  currentProjectFile: string | null
  /** 有未落盘的改动 */
  dirty: boolean
}

/** 纯决策：拿到一次文件变更，界面该做什么 */
export function planHotReload(input: PlanInput): HotReloadPlan {
  const changedProjects = input.payload.projects || []
  const touchesCurrent = Boolean(input.currentProjectFile) && changedProjects.includes(input.currentProjectFile!)

  return {
    reloadWarehouse: Boolean(input.payload.warehouse),
    reloadProject: touchesCurrent && !input.dirty,
    promptProject: touchesCurrent && input.dirty,
    // 没有正在编辑的工程时，列表里的名字/时间也要跟着变
    refreshProjectList: changedProjects.length > 0
  }
}

/** 重读 仓库.yml 并静默替换内存（绝不写回文件，写回会和自己打架） */
export async function reloadWarehouseFromFile(): Promise<boolean> {
  const loaded = await loadWarehouseFile()
  if (loaded.state === 'broken') {
    // 文件在、但读不懂：不覆盖内存（保留界面上/数据库里的内容），坏文件另存留证
    const backupName = loaded.text ? await backupBrokenWarehouseFile(loaded.text) : null
    const reason = loaded.error || loaded.warnings[0] || '内容无法解析'
    showGlobalToast(
      backupName
        ? `仓库.yml 读不懂（${reason}），沿用当前内容未覆盖；原文件已备份为 ${backupName}`
        : `仓库.yml 读不懂（${reason}），沿用当前内容未覆盖`
    )
    return false
  }
  if (loaded.state !== 'ok' || !loaded.snapshot) return false

  const { snapshot } = loaded
  // 审查第 7 条：热加载以前只改内存、不动 projectSource 的仓库试剂缓存，
  // 重载后载入工程时余量还按旧缓存算。文件已换，缓存必须一起换。
  resetWarehouseReagentsCache()
  useWarehouseStore.getState().setTubes(snapshot.reagents)
  useGroupStore.getState().setGroups(snapshot.groups)
  // 成分颜色存在 仓库.yml 里，文件里有就跟着换（store 没有批量 setter，逐条写内存即可）
  if (snapshot.substanceColors && snapshot.substanceColors.length > 0) {
    for (const item of snapshot.substanceColors) {
      void useSubstanceColorStore.getState().setColor(item.name, item.color, item.bgColor)
    }
  }
  return true
}

/**
 * 挂一次就够（App 顶层）。锁生效时也照样重载——Agent 正在改，界面就该跟着变。
 */
export function useStoreHotReload(): void {
  useEffect(() => {
    const subscribe = window.electronAPI?.onStoreFilesChanged
    if (!subscribe) return

    const unsubscribe = subscribe((payload: StoreFilesChangedPayload) => {
      console.log('[HotReload] 收到：' + JSON.stringify(payload))
      const state = useExperimentStore.getState()
      const current = state.currentExperiment
      const fileInfo = current ? getProjectFileInfo(current.id) : null

      const plan = planHotReload({
        payload,
        currentProjectFile: fileInfo?.fileName ?? null,
        dirty: hasPendingAutoSave()
      })

      console.log('[HotReload] 决策：' + JSON.stringify(plan))

      if (plan.reloadWarehouse) {
        void reloadWarehouseFromFile().then(ok => {
          console.log('[HotReload] 应用：仓库' + (ok ? '（已重载）' : '（读取失败）'))
          if (ok) showGlobalToast('仓库文件已更新，已重新载入')
        })
      }

      if (plan.promptProject) {
        // 交给实验页挂提示条（不覆盖主人的改动）
        window.dispatchEvent(new CustomEvent('labflow:projectFileChanged', { detail: { prompt: true } }))
      } else if (plan.reloadProject && current) {
        void state.reloadExperimentFromFile(current.id).then(ok => {
          console.log('[HotReload] 应用：工程 ' + current.name + (ok ? '（已重载）' : '（读取失败）'))
          if (ok) showGlobalToast('工程文件已更新，已重新载入')
        })
      }

      if (plan.refreshProjectList && !current) {
        void state.fetchExperiments()
      }
    })

    return unsubscribe
  }, [])
}
