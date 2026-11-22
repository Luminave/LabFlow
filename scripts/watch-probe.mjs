#!/usr/bin/env node
/**
 * 正本目录监听探针（不需要开 LabFlow，用来确认「改文件会不会被看见」）。
 *
 *   npm run watch:probe            # 默认 D:\学习\labflow
 *   npm run watch:probe -- D:\other\labflow
 *
 * 逻辑和主进程一致：分别 watch 根目录和 工程/（fs.watch 不能递归），
 * 用内容哈希判断是不是「外部改动」，打印会广播什么。
 * 打开 LabFlow 时不要同时开它——两个吧，一个改一个看即可。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const root = path.resolve(process.argv[2] || process.env.LABFLOW_DATA_ROOT || 'D:\\学习\\labflow')
const projectDir = path.join(root, '工程')
const warehouseFile = path.join(root, '仓库.yml')

const hashes = new Map()

function read(file) {
  try { return fs.readFileSync(file, 'utf8') } catch { return null }
}

function hashOf(text) {
  if (text === null) return 'missing'
  return crypto.createHash('sha1').update(text, 'utf8').digest('hex')
}

function prime() {
  const wh = read(warehouseFile)
  hashes.set(warehouseFile, hashOf(wh))
  let files = []
  try { files = fs.readdirSync(projectDir).filter(n => n.toLowerCase().endsWith('.yml')) } catch {}
  for (const name of files) {
    const file = path.join(projectDir, name)
    hashes.set(file, hashOf(read(file)))
  }
  console.log('[Probe] 已拍快照：仓库.yml + ' + files.length + ' 个工程文件')
}

function scan(reason) {
  const changed = []
  const wh = read(warehouseFile)
  const whHash = hashOf(wh)
  if (hashes.get(warehouseFile) !== whHash) {
    hashes.set(warehouseFile, whHash)
    changed.push('仓库.yml')
  }
  let files = []
  try { files = fs.readdirSync(projectDir).filter(n => n.toLowerCase().endsWith('.yml')) } catch {}
  for (const name of files) {
    const file = path.join(projectDir, name)
    const h = hashOf(read(file))
    if (hashes.get(file) !== h) {
      hashes.set(file, h)
      changed.push('工程/' + name)
    }
  }
  if (changed.length === 0) {
    console.log('[Probe] 事件来自 ' + reason + '，但内容没变（自写或重复事件），不广播')
    return
  }
  const warehouse = changed.includes('仓库.yml')
  const projects = changed.filter(n => n.startsWith('工程/')).map(n => n.slice(3))
  console.log('[Probe] 会广播：warehouse=' + warehouse + ' projects=' + JSON.stringify(projects) + '（触发：' + reason + '）')
}

function watchDir(dir, label) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const watcher = fs.watch(dir, (_event, filename) => {
    const name = filename ? String(filename) : ''
    console.log('[Probe] fs 事件：' + label + (name ? '/' + name : '（无文件名）'))
    setTimeout(() => scan(label + (name ? '/' + name : '')), 150)
  })
  watcher.on('error', error => console.warn('[Probe] 监听中断（' + label + '）：' + error.message))
  console.log('[Probe] 正在监听：' + dir)
}

console.log('[Probe] 数据根：' + root)
prime()
watchDir(root, '根目录')
watchDir(projectDir, '工程')
console.log('[Probe] 现在去改 工程/AD-5.2.yml（比如 10E1 的浓度），这里应当马上打印「会广播」。Ctrl+C 退出。')
