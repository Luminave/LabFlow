#!/usr/bin/env node
/**
 * `labflow` 命令（第 3 步）。
 *
 * 目标不是给人点，是给 Agent 用：只认文件、用命令算和查。
 * 默认全部只读；只有 export（写 SOP/yml）与 lock/unlock（写锁文件）会落盘。
 *
 * 退出码：0 正常；1 发现问题（校验不过、找不到工程）；2 参数用错。
 */

import { parseArgv } from './args'
import {
  commandCalc,
  commandComplete,
  commandDiff,
  commandExport,
  commandList,
  commandLock,
  commandValidate,
  type CommandResult
} from './commands'

const HELP = `labflow —— LabFlow 工程文件的命令行（只读为主）

用法：labflow <命令> [参数]

  list                              列出 工程/*.yml（名称、id、管数、连线数、时间、是否上锁）
  validate <工程>                   校验一个工程（与界面「检查」同一套规则）
  calc <工程> [--tube <管名>]        算每管的体积、各成分浓度、仓库余量与预计剩余
  diff <工程A> <工程B>               两个工程文件的差异（按管名列）
  export <工程> [--out <目录>]       写 SOP（默认 <数据根>/导出/）；--yml 再写一份 yml
  complete <工程> [--apply]          结算（默认只算不写；--apply 才改 仓库.yml 并把工程置 completed）
  lock --project <工程> [--note ..]  加锁；status 看当前锁
  unlock [--force]                  解锁（要 pid+agent+project 都对得上；不是自己的锁得加 --force）

通用开关：
  --json                            机器可读输出
  --root <目录>                     数据根（默认 $LABFLOW_DATA_ROOT 或 D:\\学习\\labflow）

退出码：0 正常｜1 发现问题｜2 参数用错
`

function run(argv: string[]): CommandResult {
  const args = parseArgv(argv)
  switch (args.command) {
    case 'list':
      return commandList(args)
    case 'validate':
      return commandValidate(args)
    case 'calc':
      return commandCalc(args)
    case 'diff':
      return commandDiff(args)
    case 'export':
      return commandExport(args)
    case 'complete':
      return commandComplete(args)
    case 'lock':
    case 'unlock':
    case 'status':
      return commandLock({
        ...args,
        positionals: args.command === 'lock' ? ['lock', ...args.positionals] : [args.command, ...args.positionals]
      })
    case '':
    case 'help':
    case '--help':
      return { code: 0, text: HELP }
    default:
      return { code: 2, text: `未知命令：${args.command}\n\n${HELP}` }
  }
}

const result = run(process.argv.slice(2))

if (result.json !== undefined) {
  process.stdout.write(`${JSON.stringify(result.json, null, 2)}\n`)
} else if (result.text) {
  const stream = result.code === 0 ? process.stdout : process.stderr
  stream.write(`${result.text}\n`)
}

process.exit(result.code)
