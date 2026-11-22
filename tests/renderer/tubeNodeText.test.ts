/**
 * 画布节点文字（组件里曾经裸拼的那两处）。
 *
 * 回归用的两条现实值：
 * - 1 M 母液在文件里是 `1000 mM`（= 1e6 µM），节点必须写 `Mg 1 M`，不是 `Mg 1000000 μM`；
 * - 源试管的余量以仓库正本为准：仓库 100 µL → 节点 `100/100 μL`。
 */
import { describe, expect, it } from 'vitest'

import { concentrationText, pairText, singleText, volumeText } from '../../src/renderer/src/utils/tubeNodeText'
import type { Substance, Tube } from '../../src/shared/types'

function tube(overrides: Partial<Tube> & { id: string; name: string }): Tube {
  return {
    type: 'source',
    totalVolume: 20,
    totalVolumeUnit: 'μL',
    remainingVolume: 20,
    remainingVolumeUnit: 'μL',
    substances: [],
    createdAt: '',
    updatedAt: '',
    status: 'active',
    ...overrides
  } as Tube
}

function mg(concentration: number, unit: Substance['concentrationUnit']): Substance {
  return { name: 'Mg', concentration, concentrationUnit: unit }
}

describe('成分浓度文字', () => {
  it('1 M 母液（文件里写 1000 mM）→ `1 M`', () => {
    expect(concentrationText(mg(1000, 'mM'))).toBe('1 M')
  })

  it('稀释后的 5 mM 保持 `5 mM`', () => {
    expect(concentrationText(mg(5, 'mM'))).toBe('5 mM')
  })

  it('100 µM 保持 `100 μM`', () => {
    expect(concentrationText(mg(100, 'μM'))).toBe('100 μM')
  })
})

describe('体积那一格', () => {
  it('源试管显示「仓库总量 / 本轮预计剩余」：100 µL 用掉 15 → 100/85 μL', () => {
    const t = tube({ id: 'mg', name: '1M Mg', totalVolume: 100, remainingVolume: 100 })
    expect(
      volumeText({
        tube: t,
        isSource: true,
        warehouseTotalVolume: 100,
        warehouseRemainingVolume: 100,
        endStateVolume: 85
      })
    ).toBe('100/85 μL')
  })

  it('总量取仓库正本（工程里是旧值也从仓库来），20 µL 用掉 5 → 20/15 μL', () => {
    const t = tube({ id: 'e1', name: 'E1', totalVolume: 18, remainingVolume: 15 })
    expect(
      volumeText({
        tube: t,
        isSource: true,
        warehouseTotalVolume: 20,
        warehouseRemainingVolume: 20,
        endStateVolume: 15
      })
    ).toBe('20/15 μL')
  })

  it('没有结束状态时退回仓库余量', () => {
    const t = tube({ id: 'e1', name: 'E1', totalVolume: 20, remainingVolume: 20 })
    expect(
      volumeText({ tube: t, isSource: true, warehouseTotalVolume: 20, warehouseRemainingVolume: 20 })
    ).toBe('20/20 μL')
  })

  it('中间产物仍是 目标/预计剩余', () => {
    const t = tube({ id: 'i1', name: '10E1', type: 'intermediate', totalVolume: 50, remainingVolume: 50 })
    expect(volumeText({ tube: t, isSource: false, endStateVolume: 45 })).toBe('50/45 μL')
  })

  it('两格跨档时共用一个单位（2000/1500 µL → 2/1.5 mL）', () => {
    expect(pairText(2000, 1500, 'μL')).toBe('2/1.5 mL')
  })

  it('缓冲液是 ∞，样本/废液只写一个数', () => {
    expect(volumeText({ tube: tube({ id: 'b', name: 'PBS', type: 'buffer' }), isSource: false, isBuffer: true })).toBe('∞')
    expect(volumeText({ tube: tube({ id: 's', name: 'sample', type: 'sample' }), isSource: false, endStateVolume: 40 })).toBe('40 μL')
  })

  it('singleText 也走格式化（3000 µL → 3 mL）', () => {
    expect(singleText(3000, 'μL')).toBe('3 mL')
  })
})
