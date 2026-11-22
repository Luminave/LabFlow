/**
 * 第 4 条：删工程不再留孤儿文件。
 *
 * 事故形状：界面删工程只删数据库记录，`工程/<名>.yml` 还躺在盘上；
 * 以后手工放个同名文件就会「诈尸」，列表和文件对不上。
 * 现在：先把它**移**到 `工程/_deleted/<时间戳>-<原文件名>.yml`（不硬删，可人工恢复），
 * 移成功之后才删数据库；移不动就不删数据库，并报错说清原因。
 */
import fs from 'fs'
import os from 'os'
import path from 'path'

import { afterEach, describe, expect, it } from 'vitest'

import { DELETED_DIR, archiveProjectFile, deletedDir, projectDir } from '../../electron/dataRoot'

let root = ''

function makeRoot(): string {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'labflow-archive-'))
  fs.mkdirSync(projectDir(root), { recursive: true })
  return root
}

function writeProjectFile(fileName: string, content: string): string {
  const file = path.join(projectDir(root), fileName)
  fs.writeFileSync(file, content, 'utf8')
  return file
}

afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true })
  root = ''
})

describe('archiveProjectFile：挪进 工程/_deleted/', () => {
  it('按 id 找到 → 原位置没了、_deleted 里有一份、内容一字不差', () => {
    makeRoot()
    const content = 'schemaVersion: 2\nname: 演示工程\nid: exp-1\n'
    const original = writeProjectFile('演示工程.yml', content)

    const result = archiveProjectFile(root, { id: 'exp-1' }, new Date('2026-11-23T01:30:00'))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(fs.existsSync(original)).toBe(false)
    expect(result.fileName.startsWith('20261123-013000-')).toBe(true)
    expect(result.fileName.endsWith('-演示工程.yml')).toBe(true)
    expect(fs.existsSync(result.path)).toBe(true)
    expect(fs.readFileSync(result.path, 'utf8')).toBe(content)
    // 落在 工程/_deleted/ 下，不在 工程/ 根里
    expect(path.dirname(result.path)).toBe(deletedDir(root))
    expect(path.basename(path.dirname(result.path))).toBe(DELETED_DIR)
    expect(fs.readdirSync(projectDir(root))).toEqual([DELETED_DIR])
  })

  it('按文件名 / 按工程名都能找到', () => {
    makeRoot()
    writeProjectFile('A.yml', 'schemaVersion: 2\nname: 甲工程\nid: a-1\n')
    writeProjectFile('B.yml', 'schemaVersion: 2\nname: 乙工程\nid: b-1\n')

    const byFile = archiveProjectFile(root, { fileName: 'B.yml' })
    expect(byFile.ok && byFile.fileName.endsWith('-B.yml')).toBe(true)

    const byName = archiveProjectFile(root, { name: '甲工程' })
    expect(byName.ok && byName.fileName.endsWith('-A.yml')).toBe(true)

    expect(fs.readdirSync(projectDir(root)).sort()).toEqual([DELETED_DIR])
  })

  it('同一秒删两个同名文件 → 第二个加 -2，不覆盖第一个', () => {
    makeRoot()
    const when = new Date('2026-11-23T01:30:00')
    writeProjectFile('重名.yml', 'first\n')
    const first = archiveProjectFile(root, { fileName: '重名.yml' }, when)
    writeProjectFile('重名.yml', 'second\n')
    const second = archiveProjectFile(root, { fileName: '重名.yml' }, when)

    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(second.fileName).not.toBe(first.fileName)
    expect(second.fileName).toContain('-2-')
    expect(fs.readFileSync(first.path, 'utf8')).toBe('first\n')
    expect(fs.readFileSync(second.path, 'utf8')).toBe('second\n')
  })

  it('文件本来就不在（数据库有记录、盘上没有）→ reason: not-found，不报错、不抛', () => {
    makeRoot()
    const result = archiveProjectFile(root, { id: 'ghost' })
    expect(result.ok).toBe(false)
    expect('reason' in result && result.reason).toBe('not-found')
  })
})
