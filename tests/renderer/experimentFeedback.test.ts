/**
 * 「结束实验」的界面反馈：不再 alert，改走 2.6 秒自消的轻提示。
 *
 * 真机 2026-11-23：点结束实验后弹的是原生 alert('实验已保存！')，和面板上其它提示不一致。
 * 这里锁住：成功/失败都只发 toast、都不碰 alert，且失败时异常不再往外抛给界面。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  completeFailureText,
  completeSuccessText,
  reportCompleteExperiment
} from '../../src/renderer/src/utils/experimentFeedback'

interface Installed {
  toasts: string[]
  alertSpy: ReturnType<typeof vi.fn>
}

function installWindow(): Installed {
  const toasts: string[] = []
  ;(globalThis as any).window = {
    dispatchEvent: (event: any) => {
      const text = event?.detail?.text
      if (typeof text === 'string') toasts.push(text)
      return true
    },
    addEventListener: () => {},
    removeEventListener: () => {}
  }
  const alertSpy = vi.fn()
  ;(globalThis as any).alert = alertSpy
  return { toasts, alertSpy }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('结束实验的反馈：走轻提示，不弹 alert', () => {
  it('成功 → 只发一条「实验已结束，试剂已入账」，一次 alert 都没调', async () => {
    const { toasts, alertSpy } = installWindow()
    const complete = vi.fn(async () => undefined)

    const ok = await reportCompleteExperiment(complete, 'zh')

    expect(ok).toBe(true)
    expect(complete).toHaveBeenCalledTimes(1)
    expect(alertSpy).not.toHaveBeenCalled()
    expect(toasts).toEqual(['实验已结束，试剂已入账'])
  })

  it('失败 → 发一条带原因的 toast、不抛给界面，并把全栈留在 console.error', async () => {
    const { toasts, alertSpy } = installWindow()
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const ok = await reportCompleteExperiment(async () => {
      throw new Error('仓库正本写失败：磁盘只读')
    }, 'zh')

    expect(ok).toBe(false)
    expect(alertSpy).not.toHaveBeenCalled()
    expect(toasts).toEqual(['结束实验失败：仓库正本写失败：磁盘只读'])
    expect(consoleSpy).toHaveBeenCalled()
  })

  it('英文界面文案（zh/en 两套）', async () => {
    const { toasts } = installWindow()
    await reportCompleteExperiment(async () => undefined, 'en')
    expect(toasts).toEqual(['Experiment ended; reagents posted'])
    expect(completeSuccessText('en')).toBe('Experiment ended; reagents posted')
    expect(completeFailureText('boom', 'en')).toBe('Failed to complete the experiment: boom')
  })

  it('没有原因（抛出空对象）→ 也不会把「undefined」写给人看', async () => {
    const { toasts } = installWindow()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await reportCompleteExperiment(async () => {
      throw {}
    }, 'zh')
    expect(toasts).toEqual(['结束实验失败：未知错误'])
  })
})
