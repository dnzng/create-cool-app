import { describe, expect, it } from 'vitest' // eslint-disable-line
import { echo } from '../src'

describe('test', () => {
  it('should print the value passed to itself', () => {
    expect(echo(1)).toBe(1)
  })
})
