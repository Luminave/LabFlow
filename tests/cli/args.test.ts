import { describe, expect, it } from 'vitest'

import { flagBool, flagNumber, flagString, parseArgv } from '../../src/cli/args'

describe('CLI 参数解析', () => {
  it('命令 + 位置参数 + 开关', () => {
    const parsed = parseArgv(['calc', 'AD-5.2', '--tube', '10E1', '--json'])
    expect(parsed.command).toBe('calc')
    expect(parsed.positionals).toEqual(['AD-5.2'])
    expect(flagString(parsed.flags, 'tube')).toBe('10E1')
    expect(flagBool(parsed.flags, 'json')).toBe(true)
  })

  it('--key=value 也认', () => {
    const parsed = parseArgv(['validate', 'AD-5.2', '--root=D:/tmp/x'])
    expect(flagString(parsed.flags, 'root')).toBe('D:/tmp/x')
  })

  it('后面紧跟另一个开关时，前一个当布尔', () => {
    const parsed = parseArgv(['export', 'AD-5.2', '--sop', '--yml'])
    expect(flagBool(parsed.flags, 'sop')).toBe(true)
    expect(flagBool(parsed.flags, 'yml')).toBe(true)
  })

  it('缺参数：只有命令', () => {
    const parsed = parseArgv(['validate'])
    expect(parsed.command).toBe('validate')
    expect(parsed.positionals).toEqual([])
  })

  it('空的 argv 得到空命令', () => {
    expect(parseArgv([]).command).toBe('')
  })

  it('--minutes 16 取数字；非数字返回 undefined', () => {
    expect(flagNumber(parseArgv(['lock', '--minutes', '16']).flags, 'minutes')).toBe(16)
    expect(flagNumber(parseArgv(['lock', '--minutes', 'abc']).flags, 'minutes')).toBeUndefined()
    expect(flagNumber(parseArgv(['lock']).flags, 'minutes')).toBeUndefined()
  })

  it('--json false 视为关', () => {
    expect(flagBool(parseArgv(['list', '--json', 'false']).flags, 'json')).toBe(false)
  })
})
