import { describe, expect, it } from 'vitest'

import { planHotReload } from '../../src/renderer/src/utils/storeHotReload'

describe('热加载：拿到一次文件变更，界面该做什么', () => {
  it('仓库文件变了 → 只重载仓库', () => {
    const plan = planHotReload({
      payload: { warehouse: true, projects: [] },
      currentProjectFile: 'AD-5.2.yml',
      dirty: false
    })
    expect(plan).toEqual({
      reloadWarehouse: true,
      reloadProject: false,
      promptProject: false,
      refreshProjectList: false
    })
  })

  it('当前工程文件变了且没未保存改动 → 自动重载画布', () => {
    const plan = planHotReload({
      payload: { warehouse: false, projects: ['AD-5.2.yml'] },
      currentProjectFile: 'AD-5.2.yml',
      dirty: false
    })
    expect(plan.reloadProject).toBe(true)
    expect(plan.promptProject).toBe(false)
    expect(plan.refreshProjectList).toBe(true)
  })

  it('有未保存改动 → 只挂提示条，不覆盖', () => {
    const plan = planHotReload({
      payload: { warehouse: false, projects: ['AD-5.2.yml'] },
      currentProjectFile: 'AD-5.2.yml',
      dirty: true
    })
    expect(plan.reloadProject).toBe(false)
    expect(plan.promptProject).toBe(true)
  })

  it('改的是别的工程 → 不动当前画布，只刷新列表', () => {
    const plan = planHotReload({
      payload: { warehouse: false, projects: ['261118.yml'] },
      currentProjectFile: 'AD-5.2.yml',
      dirty: false
    })
    expect(plan.reloadProject).toBe(false)
    expect(plan.promptProject).toBe(false)
    expect(plan.refreshProjectList).toBe(true)
  })

  it('没打开工程时，工程文件变化只刷新列表', () => {
    const plan = planHotReload({
      payload: { warehouse: false, projects: ['AD-5.2.yml'] },
      currentProjectFile: null,
      dirty: true
    })
    expect(plan.reloadProject).toBe(false)
    expect(plan.promptProject).toBe(false)
    expect(plan.refreshProjectList).toBe(true)
  })

  it('仓库和工程一起变 → 两个都处理', () => {
    const plan = planHotReload({
      payload: { warehouse: true, projects: ['AD-5.2.yml'] },
      currentProjectFile: 'AD-5.2.yml',
      dirty: false
    })
    expect(plan.reloadWarehouse).toBe(true)
    expect(plan.reloadProject).toBe(true)
  })
})
