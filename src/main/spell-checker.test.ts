import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { SpellChecker } from './spell-checker'

const artifactsDirectory = join(process.cwd(), 'test-artifacts')
const customDictionaryPath = join(artifactsDirectory, 'custom-words.json')
let checker: SpellChecker

beforeAll(async () => {
  await mkdir(artifactsDirectory, { recursive: true })
  checker = new SpellChecker(customDictionaryPath)
}, 30_000)

afterAll(async () => {
  await rm(artifactsDirectory, { recursive: true, force: true })
})

describe('SpellChecker', () => {
  it('accepts Polish and English in the same text', () => {
    const issues = checker.check('To jest poprawny tekst. This sentence is correct.')

    expect(issues).toEqual([])
  })

  it('finds likely mistakes in both languages', () => {
    const issues = checker.check('To jest błond. This is an eror.')

    expect(issues.map((issue) => issue.normalized)).toEqual(
      expect.arrayContaining(['błond', 'eror'])
    )
  })

  it('finds every intentional mistake used by the OCR posters', () => {
    const text = [
      'WYPRZEDARZ Najleprze wiencej',
      'Recieve avalable Adress',
      'ŚWIERZO COLECTION desing'
    ].join(' ')
    const issues = checker.check(text).map((issue) => issue.normalized)

    expect(issues).toEqual(
      expect.arrayContaining([
        'wyprzedarz',
        'najleprze',
        'wiencej',
        'recieve',
        'avalable',
        'adress',
        'świerzo',
        'colection',
        'desing'
      ])
    )
  })

  it('groups repeated mistakes', () => {
    const [issue] = checker.check('literuwka literuwka literuwka')

    expect(issue).toMatchObject({ normalized: 'literuwka', count: 3 })
  })

  it('ignores URLs, email addresses, and short uppercase marks', () => {
    const issues = checker.check('ABC https://prechecker.example user@example.com')

    expect(issues).toEqual([])
  })

  it('persists accepted brand names in a custom dictionary', async () => {
    const checker = new SpellChecker(customDictionaryPath)
    await checker.add('PreCheckerBrand')

    const reloadedChecker = new SpellChecker(customDictionaryPath)
    await reloadedChecker.load()

    expect(reloadedChecker.check('PreCheckerBrand')).toEqual([])
  })
})
