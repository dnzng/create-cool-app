import { describe, expect, it } from 'vitest'
import { add, minus } from '../src'

describe('add', () => {
  it('should be sum of two numbers', () => {
    expect(add(1, 2)).toBe(3)
  })
})

describe('minus', () => {
  it('should be the difference between two numbers', () => {
    expect(minus(2, 1)).toBe(1)
  })
})
