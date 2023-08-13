import { describe, expect, it } from 'vitest'
import { echo } from '../src'

describe('test', () => {
  it('should print the value passed to itself', () => {
    expect(echo(1)).toBe(1)
  })
})
