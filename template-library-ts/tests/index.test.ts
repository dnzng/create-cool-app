import { describe, expect, it } from 'vitest'
import { log } from '../src'

describe('test', () => {
  it('should print the value passed to itself', () => {
    expect(log(1)).toEqual(1)
  })
})
