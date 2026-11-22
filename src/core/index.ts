/**
 * LabFlow 计算内核入口。
 *
 * 用法：`import { aggregateFlows, computeMixture, computeEndState, validateExperiment } from '@/core'`
 *
 * 边界：只有纯函数与纯数据，不 import React / Electron / 浏览器 API，
 * 因此可以被页面、store 与将来的 Agent CLI（第 2 步）共用。
 */

export * from './schema'
export * from './units'
export * from './aggregate'
export * from './mix'
export * from './endState'
export * from './validate'
export * from './narration'

// 导出器单独从 '@/core/exporters' 引：它们依赖 js-yaml，不塞进核心里，
// 免得所有引内核的地方都被迫带上序列化库。
