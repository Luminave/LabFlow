import { describe, it, expect, vi } from 'vitest'
import {
  DEEP_LINK_SCHEME,
  buildProjectLink,
  createProtocolRegistrar,
  findDeepLinkArg,
  markdownProjectLink,
  parseProjectLink,
  pickProject,
  projectLinkLine,
  protocolRegistrationArgs
} from '../src/core/deepLink'

/** 工程名是中文时，链接里应当是 %XX 编码，而不是原字符 */
const CJK_LINK = 'labflow://open?project=261118-%E5%AE%9E%E9%99%85%E5%AE%9E%E9%AA%8C'

describe('深链接：生成', () => {
  it('中文工程名按 UTF-8 编码，和写进笔记的样子一致', () => {
    expect(buildProjectLink('261118-实际实验')).toBe(CJK_LINK)
  })

  it('带 id 时追加 &id=', () => {
    expect(buildProjectLink('AD-5.2', 'abc-123')).toBe('labflow://open?project=AD-5.2&id=abc-123')
  })

  it('空格编码成 %20 而不是 +（Obsidian 里 + 会被当字面量）', () => {
    expect(buildProjectLink('my project')).toBe('labflow://open?project=my%20project')
    expect(buildProjectLink('my project')).not.toContain('+')
  })

  it('工程名首尾空格会被去掉', () => {
    expect(buildProjectLink('  AD-5.2  ')).toBe('labflow://open?project=AD-5.2')
  })

  it('markdownProjectLink / projectLinkLine 拼出 SOP 头部那一行', () => {
    expect(markdownProjectLink('261118-实际实验')).toBe(`[261118-实际实验](${CJK_LINK})`)
    expect(projectLinkLine('261118-实际实验')).toBe(
      `> 在 LabFlow 中打开：[261118-实际实验](${CJK_LINK})`
    )
  })
})

describe('深链接：解析', () => {
  it('能解开自己生成的链接（中文名原样还原）', () => {
    const parsed = parseProjectLink(buildProjectLink('261118-实际实验'))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.project).toBe('261118-实际实验')
    expect(parsed.id).toBeUndefined()
  })

  it('带 id 的链接两个参数都能解出来', () => {
    const parsed = parseProjectLink(buildProjectLink('AD-5.2', 'abc-123'))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.project).toBe('AD-5.2')
    expect(parsed.id).toBe('abc-123')
  })

  it('兼容 labflow:open? 写法（没有 // 的版本）', () => {
    const parsed = parseProjectLink('labflow:open?project=AD-5.2')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.project).toBe('AD-5.2')
  })

  it('Windows 规范化出的 labflow://open/?project=… 也能解开', () => {
    const parsed = parseProjectLink('labflow://open/?project=261118-%E5%AE%9E%E9%99%85%E5%AE%9E%E9%AA%8C')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.project).toBe('261118-实际实验')
  })

  it('缺 project 参数时明确报错', () => {
    const parsed = parseProjectLink('labflow://open')
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toBe('missing-project')
  })

  it('不是 labflow 协议时明确报错', () => {
    const parsed = parseProjectLink('https://example.com/open?project=x')
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toBe('unsupported-scheme')
  })

  it('不认识的动作用 unsupported-action', () => {
    const parsed = parseProjectLink('labflow://delete?project=x')
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toBe('unsupported-action')
  })

  it('乱七八糟的字符串不抛异常', () => {
    expect(() => parseProjectLink('not a url')).not.toThrow()
    expect(parseProjectLink('').ok).toBe(false)
  })
})

describe('深链接：找工程', () => {
  const experiments = [
    { id: 'a', name: '261118-实际实验', updatedAt: '2026-11-18T08:00:00Z' },
    { id: 'b', name: 'AD-5.2', updatedAt: '2026-11-20T08:00:00Z' },
    { id: 'c', name: 'AD-5.2', updatedAt: '2026-11-22T08:00:00Z' },
    { id: 'd', name: 'ad-5.2', updatedAt: '2026-11-10T08:00:00Z' }
  ]

  it('只给名字且同名多个时，取最近更新的那个', () => {
    expect(pickProject(experiments, { project: 'AD-5.2' })?.id).toBe('c')
  })

  it('给了 id 就只认 id，不再看名字', () => {
    expect(pickProject(experiments, { project: 'AD-5.2', id: 'b' })?.id).toBe('b')
  })

  it('id 在库里不存在时返回 null（不猜成同名工程）', () => {
    expect(pickProject(experiments, { project: 'AD-5.2', id: 'nope' })).toBeNull()
  })

  it('中文名字能精确命中', () => {
    expect(pickProject(experiments, { project: '261118-实际实验' })?.id).toBe('a')
  })

  it('名字只在大小写上不同也能命中，且优先精确匹配', () => {
    const exact = pickProject(experiments, { project: 'ad-5.2' })
    expect(exact?.id).toBe('d')
  })

  it('未知工程名返回 null', () => {
    expect(pickProject(experiments, { project: '不存在的工程' })).toBeNull()
  })

  it('空列表不炸', () => {
    expect(pickProject([], { project: 'x' })).toBeNull()
  })
})

describe('深链接：协议注册', () => {
  it('开发模式要带上 electron 可执行文件与脚本路径（args 必须是数组）', () => {
    const registration = protocolRegistrationArgs(false, 'C:/x/electron.exe', 'D:/project/LabFlow')
    expect(registration.executable).toBe('C:/x/electron.exe')
    expect(Array.isArray(registration.args)).toBe(true)
    expect(registration.args).toEqual(['D:/project/LabFlow'])
  })

  it('打包后不带参数（系统自己找应用）', () => {
    expect(protocolRegistrationArgs(true, 'C:/x/LabFlow.exe', 'D:/app')).toEqual({
      executable: null,
      args: []
    })
  })

  it('脚本路径为空时退回「不带参数」而不是写坏注册表', () => {
    expect(protocolRegistrationArgs(false, 'C:/x/electron.exe', '')).toEqual({
      executable: null,
      args: []
    })
  })

  it('注册是幂等的：重复调用只真的注册一次', () => {
    const register = vi.fn(() => true)
    const registerOnce = createProtocolRegistrar(register)
    expect(registerOnce(DEEP_LINK_SCHEME)).toBe(true)
    expect(registerOnce(DEEP_LINK_SCHEME)).toBe(false)
    expect(register).toHaveBeenCalledTimes(1)
  })

  it('注册抛异常时不把应用带崩，返回 false', () => {
    const registerOnce = createProtocolRegistrar(() => {
      throw new Error('registry locked')
    })
    expect(() => registerOnce(DEEP_LINK_SCHEME)).not.toThrow()
    expect(registerOnce(DEEP_LINK_SCHEME)).toBe(false)
  })

  it('能从启动参数里捞出链接（大小写不敏感）', () => {
    expect(findDeepLinkArg(['electron.exe', '.', '--no-sandbox', CJK_LINK])).toBe(CJK_LINK)
    expect(findDeepLinkArg(['electron.exe', 'LabFlow://open?project=x'])).toBe('LabFlow://open?project=x')
    expect(findDeepLinkArg(['electron.exe', '.'])).toBeUndefined()
  })
})

describe('findDeepLinkArg —— 各种真实启动形态（主人实测踩过坑）', () => {
  const exe = 'C:\\app\\electron.exe'
  const app = 'D:\\project\\LabFlow'

  it('标准形态 [exe, app, url]', () => {
    expect(findDeepLinkArg([exe, app, 'labflow://open?project=AD-5.2'])).toBe('labflow://open?project=AD-5.2')
  })

  it('参数移位（多一个 --no-sandbox）也能找到', () => {
    expect(findDeepLinkArg([exe, app, '--no-sandbox', 'labflow://open?project=AD-5.2'])).toBe(
      'labflow://open?project=AD-5.2'
    )
  })

  it('被引号包着也要认（start "" "labflow://…" 的形式）', () => {
    expect(findDeepLinkArg([exe, app, '"labflow://open?project=AD-5.2"'])).toBe('labflow://open?project=AD-5.2')
    expect(findDeepLinkArg([exe, app, "'labflow://open?project=AD-5.2'"])).toBe('labflow://open?project=AD-5.2')
  })

  it('单斜杠写法 labflow:/open 也认', () => {
    expect(findDeepLinkArg([exe, app, 'labflow:/open?project=AD-5.2'])).toBe('labflow:/open?project=AD-5.2')
  })

  it('Windows 规范化出的 labflow://open/?project=… 原样返回', () => {
    expect(findDeepLinkArg([exe, app, 'labflow://open/?project=261118'])).toBe('labflow://open/?project=261118')
  })

  it('整串被百分号编码时解码后再认', () => {
    const encoded = encodeURIComponent('labflow://open?project=AD-5.2')
    expect(findDeepLinkArg([exe, app, encoded])).toBe('labflow://open?project=AD-5.2')
  })

  it('夹在别的参数里（--url=…）也能抠出来', () => {
    expect(findDeepLinkArg([exe, app, '--url=labflow://open?project=AD-5.2'])).toBe('labflow://open?project=AD-5.2')
  })

  it('路径里含空格时不影响', () => {
    expect(findDeepLinkArg(['C:\\Program Files\\x\\electron.exe', 'D:\\my app', 'labflow://open?project=x'])).toBe(
      'labflow://open?project=x'
    )
  })
})

describe('深链接：已结束（completed）的工程也能打开（第 4 步 A）', () => {
  const completed = { id: 'done-1', name: 'AD-5.2', status: 'completed', updatedAt: '2026-11-20T10:00:00.000Z' }
  const draft = { id: 'draft-1', name: '261118', status: 'draft', updatedAt: '2026-11-21T10:00:00.000Z' }

  it('按名字能找到已结束的工程（不按 status 过滤）', () => {
    const match = pickProject([draft, completed], { project: 'AD-5.2' })
    expect(match?.id).toBe('done-1')
  })

  it('按 id 能找到已结束的工程', () => {
    const match = pickProject([draft, completed], { project: '随便写的名字', id: 'done-1' })
    expect(match?.name).toBe('AD-5.2')
  })

  it('工程改过名字、链接里还是旧名字，只要 id 没变仍能打开', () => {
    const renamed = { id: 'done-1', name: 'AD-5.2-已结束-改名', status: 'completed' }
    const match = pickProject([renamed, draft], { project: 'AD-5.2', id: 'done-1' })
    expect(match?.name).toBe('AD-5.2-已结束-改名')
  })

  it('只给旧名字、id 又不给时找不到（不猜同名副本）', () => {
    const renamed = { id: 'done-1', name: '新名字', status: 'completed' }
    expect(pickProject([renamed], { project: 'AD-5.2' })).toBeNull()
  })
})
