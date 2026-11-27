/**
 * 「改动没落盘」常驻横幅的状态机：
 * 上报一次 → 横幅在；重复上报同一条文字不刷新；写盘成功后清掉。
 * 2026-11-27 事故回归：这条提示以前只闪 2.6 秒就消失，主人以为改动存上了。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { clearSaveAlert, peekSaveAlert, reportSaveAlert } from '../../src/renderer/src/stores/saveAlert'

describe('saveAlert', () => {
  beforeEach(() => clearSaveAlert())

  it('上报后横幅存在，记下原文与时间', () => {
    reportSaveAlert('自动保存失败：boom')
    const alert = peekSaveAlert()
    expect(alert?.text).toBe('自动保存失败：boom')
    expect(typeof alert?.at).toBe('number')
  })

  it('相同文字重复上报不覆盖，避免横幅闪动', () => {
    reportSaveAlert('同一条')
    const first = peekSaveAlert()
    reportSaveAlert('同一条')
    expect(peekSaveAlert()).toBe(first)
  })

  it('不同文字会替换掉旧提示', () => {
    reportSaveAlert('旧问题')
    reportSaveAlert('新问题')
    expect(peekSaveAlert()?.text).toBe('新问题')
  })

  it('清掉之后不再有横幅；空文字不产生横幅', () => {
    clearSaveAlert()
    reportSaveAlert('')
    expect(peekSaveAlert()).toBeNull()
    reportSaveAlert('有内容')
    clearSaveAlert()
    expect(peekSaveAlert()).toBeNull()
  })
})
