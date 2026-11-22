/**
 * 「结束实验」的界面反馈（2026-11-23）。
 *
 * 以前这里是原生 `alert('实验已保存！')`：
 * - 会抢焦点、要手点确定，面板上的轻提示（2.6 秒自消）明明已经有一套；
 * - 失败时又是 `alert('结束实验失败…')`，说得天花乱坠也没告诉人「文件其实已经写好了」。
 *
 * 现在统一走 `labflow:global-toast`：
 *   成功 → 「实验已结束，试剂已入账」
 *   失败 → 「结束实验失败：<原因>」＋ console.error 留全栈
 * 抽成函数是为了能单测：断言成功路径不碰 alert、且确实发出一条 toast。
 */

import { showGlobalToast } from '../components/GlobalToast'
import { AgentLockError } from './agentLock'

export type FeedbackLanguage = 'zh' | 'en'

/** 成功文案 */
export function completeSuccessText(language: FeedbackLanguage = 'zh'): string {
  return language === 'zh' ? '实验已结束，试剂已入账' : 'Experiment ended; reagents posted'
}

/** 失败文案 */
export function completeFailureText(reason: string, language: FeedbackLanguage = 'zh'): string {
  return language === 'zh' ? `结束实验失败：${reason}` : `Failed to complete the experiment: ${reason}`
}

/**
 * 跑一次结算并按结果给轻提示。
 * 返回 true = 结算成功（成功提示已发出）；false = 失败（错误提示已发出，异常不再往上抛）。
 *
 * 注意：结算本身的失败判定与落地顺序全在 `completeExperiment` 里，
 * 这里只负责「说什么、怎么说」，绝不吞掉状态、也绝不回滚数据。
 */
export async function reportCompleteExperiment(
  complete: () => Promise<unknown>,
  language: FeedbackLanguage = 'zh'
): Promise<boolean> {
  try {
    await complete()
    showGlobalToast(completeSuccessText(language))
    return true
  } catch (error) {
    // 第 1 条：本工程被 Agent 锁住不是「失败」，是「暂缓写入」——不要报成结束实验失败
    if (error instanceof AgentLockError) {
      console.warn('[completeExperiment] 本工程被 Agent 锁住，已暂缓写入：', error.message)
      showGlobalToast(error.message)
      return false
    }
    const reason = (error as Error)?.message || (language === 'zh' ? '未知错误' : 'Unknown error')
    // 控制台留全栈：轻提示 2.6 秒就没了，真正排查还得看这里
    console.error('[completeExperiment] 结束实验失败：', error)
    showGlobalToast(completeFailureText(reason, language))
    return false
  }
}
