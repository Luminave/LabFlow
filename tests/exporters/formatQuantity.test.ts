import { describe, expect, it } from 'vitest'

import {
  formatQuantity,
  formatQuantityExact,
  formatQuantityParts,
  parseQuantity
} from '../../src/core/units'

describe('formatQuantity —— 浓度', () => {
  it('5000 µM 写成 5 mM（主人点名的那条）', () => {
    expect(formatQuantity(5000, 'concentration')).toBe('5 mM')
  })

  it('0.5 mM（= 500 µM）留在 µM 档', () => {
    expect(formatQuantity(500, 'concentration')).toBe('500 μM')
  })

  it('100 µM、10 µM、1 µM 原样', () => {
    expect(formatQuantity(100, 'concentration')).toBe('100 μM')
    expect(formatQuantity(10, 'concentration')).toBe('10 μM')
    expect(formatQuantity(1, 'concentration')).toBe('1 μM')
  })

  it('0.0001 µM 往下一档写 0.1 nM', () => {
    expect(formatQuantity(0.0001, 'concentration')).toBe('0.1 nM')
  })

  it('0.5 µM 写 500 nM', () => {
    expect(formatQuantity(0.5, 'concentration')).toBe('500 nM')
  })

  it('最多 3 位有效数字，且不留尾随零', () => {
    expect(formatQuantity(5000, 'concentration')).toBe('5 mM')
    expect(formatQuantity(1234, 'concentration')).toBe('1.23 mM')
    expect(formatQuantity(5000000, 'concentration')).toBe('5 M')
  })

  it('档位到 M：选使数值落在 1–999 的最大一档', () => {
    // 1 M 母液（1000 mM = 1000000 μM）必须写成 1 M，不能掉到 1000000 μM
    expect(formatQuantity(1000000, 'concentration')).toBe('1 M')
    expect(formatQuantity(1500000, 'concentration')).toBe('1.5 M')
    // 500 mM 已经落在 1–999，不该升成 0.5 M
    expect(formatQuantity(500000, 'concentration')).toBe('500 mM')
    // 0.5 M 落不到 1–999 的 M 档，于是写成 500 mM
    expect(formatQuantity(500000, 'concentration')).toBe('500 mM')
    // 1500 μM → 1.5 mM
    expect(formatQuantity(1500, 'concentration')).toBe('1.5 mM')
    // 0.5 M 的另一种写法：500000 μM
    expect(formatQuantity(0.5 * 1000000, 'concentration')).toBe('500 mM')
  })
})

describe('formatQuantity —— 体积', () => {
  it('10 µL 不变', () => {
    expect(formatQuantity(10, 'volume')).toBe('10 μL')
  })

  it('12.5 µL 不带多余的 0', () => {
    expect(formatQuantity(12.5, 'volume')).toBe('12.5 μL')
  })

  it('2985 µL 写成 2.98 mL（显示口径，3 位有效数字会丢 5 µL）', () => {
    expect(formatQuantity(2985, 'volume')).toBe('2.98 mL')
  })

  it('1000 µL 进位到 1 mL', () => {
    expect(formatQuantity(1000, 'volume')).toBe('1 mL')
  })

  it('999.6 µL 进位后不会写 1000 µL', () => {
    expect(formatQuantity(999.6, 'volume')).toBe('1 mL')
  })

  it('0.5 µL 写 500 nL', () => {
    expect(formatQuantity(0.5, 'volume')).toBe('500 nL')
  })
})

describe('formatQuantity —— 边界安全', () => {
  it('0 带基准单位返回，不崩', () => {
    expect(formatQuantity(0, 'concentration')).toBe('0 μM')
    expect(formatQuantity(0, 'volume')).toBe('0 μL')
  })

  it('负数保留符号', () => {
    expect(formatQuantity(-5000, 'concentration')).toBe('-5 mM')
    expect(formatQuantity(-10, 'volume')).toBe('-10 μL')
  })

  it('NaN / Infinity 只给占位，不抛异常', () => {
    expect(formatQuantity(Number.NaN, 'concentration')).toBe('—')
    expect(formatQuantity(Number.POSITIVE_INFINITY, 'volume')).toBe('—')
  })

  it('formatQuantityParts 返回数值与单位', () => {
    expect(formatQuantityParts(5000, 'concentration')).toEqual({ value: 5, unit: 'mM', text: '5 mM' })
  })
})

describe('formatQuantityExact —— 导出到 .yml 用', () => {
  it('2985 µL 保留成 2.985 mL（3 位有效数字会丢 5 µL）', () => {
    expect(formatQuantity(2985, 'volume')).toBe('2.98 mL')
    expect(formatQuantityExact(2985, 'volume')).toBe('2.985 mL')
    expect(parseQuantity('2.985 mL', 'volume')).toBe(2985)
  })

  it('整数不受影响', () => {
    expect(formatQuantityExact(5000, 'concentration')).toBe('5 mM')
    expect(formatQuantityExact(10, 'volume')).toBe('10 μL')
  })
})

describe('parseQuantity —— 读回基准单位（µM / µL）', () => {
  it('认得 µ 与 μ 两种写法、大小写、u 替代', () => {
    expect(parseQuantity('5 mM', 'concentration')).toBe(5000)
    expect(parseQuantity('5 mm', 'concentration')).toBe(5000)
    expect(parseQuantity('100 µM', 'concentration')).toBe(100)
    expect(parseQuantity('100 μM', 'concentration')).toBe(100)
    expect(parseQuantity('100 uM', 'concentration')).toBe(100)
    expect(parseQuantity('10 μL', 'volume')).toBe(10)
    expect(parseQuantity('10 ul', 'volume')).toBe(10)
    expect(parseQuantity('2.985 mL', 'volume')).toBe(2985)
  })

  it('裸数字按基准单位理解（方便 Agent 手改）', () => {
    expect(parseQuantity('5000', 'concentration')).toBe(5000)
    expect(parseQuantity(20, 'volume')).toBe(20)
  })

  it('读不出来时返回 null，不抛异常', () => {
    expect(parseQuantity('', 'volume')).toBeNull()
    expect(parseQuantity('大约十微升', 'volume')).toBeNull()
    expect(parseQuantity('10 光年', 'volume')).toBeNull()
    expect(parseQuantity(Number.NaN, 'volume')).toBeNull()
  })
})
