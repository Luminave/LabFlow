#!/usr/bin/env node
/**
 * Agent 锁的薄壳：真正干活的是 `labflow` CLI（第 3 步把锁命令并进去了）。
 * 保留这个脚本只是为了让 agent 不用记两条路径。
 *
 * 用法：
 *   node scripts/agent-lock.cjs lock --project AD-5.2 --note "改 12 个样品浓度"
 *   node scripts/agent-lock.cjs lock --project AD-5.2 --minutes 16
 *   node scripts/agent-lock.cjs unlock
 *   node scripts/agent-lock.cjs status
 *
 * 数据根：--root <dir> / 环境变量 LABFLOW_DATA_ROOT / 默认 D:\学习\labflow
 */

const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const cli = path.join(__dirname, '..', 'dist-cli', 'labflow.mjs')

if (!fs.existsSync(cli)) {
  console.error(`找不到 ${cli}\n先跑一次：npm run build:cli`)
  process.exit(2)
}

const argv = process.argv.slice(2)
const command = argv[0] || 'status'
const result = spawnSync(process.execPath, [cli, command, ...argv.slice(1)], {
  stdio: 'inherit',
  env: process.env
})

process.exit(result.status === null ? 1 : result.status)
