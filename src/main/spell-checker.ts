import { readFile, writeFile } from 'node:fs/promises'
import nspell from 'nspell'
import dictionaryEn from 'dictionary-en'
import dictionaryPl from 'dictionary-pl'
import type { SpellingIssue } from '../shared/types'

const WORD_PATTERN = /\p{L}+(?:['’\-]\p{L}+)*/gu
const URL_AND_EMAIL_PATTERN = /(?:https?:\/\/|www\.)\S+|\b\S+@\S+\.\S+\b/giu
type DictionaryPair = {
  english: ReturnType<typeof nspell>
  polish: ReturnType<typeof nspell>
}

let dictionaries: DictionaryPair | undefined

function getDictionaries(): DictionaryPair {
  if (!dictionaries) {
    dictionaries = {
      english: nspell({
        aff: Buffer.from(dictionaryEn.aff),
        dic: Buffer.from(dictionaryEn.dic)
      }),
      polish: nspell({
        aff: Buffer.from(dictionaryPl.aff),
        dic: Buffer.from(dictionaryPl.dic)
      })
    }
  }
  return dictionaries
}

function matchCase(suggestion: string, source: string): string {
  if (source === source.toLocaleUpperCase()) return suggestion.toLocaleUpperCase()
  if (source[0] === source[0]?.toLocaleUpperCase()) {
    return suggestion[0]?.toLocaleUpperCase() + suggestion.slice(1)
  }
  return suggestion
}

export class SpellChecker {
  private readonly english = getDictionaries().english
  private readonly polish = getDictionaries().polish
  private readonly customWords = new Set<string>()

  constructor(private readonly customDictionaryPath: string) {}

  async load(): Promise<void> {
    try {
      const words = JSON.parse(await readFile(this.customDictionaryPath, 'utf8')) as string[]
      for (const word of words) this.customWords.add(this.normalize(word))
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw error
    }
  }

  async add(word: string): Promise<void> {
    const normalized = this.normalize(word)
    if (!normalized) return

    this.customWords.add(normalized)
    const sorted = [...this.customWords].sort((a, b) => a.localeCompare(b, 'pl'))
    await writeFile(this.customDictionaryPath, JSON.stringify(sorted, null, 2), 'utf8')
  }

  check(text: string): SpellingIssue[] {
    const cleanText = text.replace(URL_AND_EMAIL_PATTERN, ' ')
    const words = cleanText.match(WORD_PATTERN) ?? []
    const issues = new Map<string, SpellingIssue>()

    for (const word of words) {
      const normalized = this.normalize(word)
      if (this.shouldIgnore(word, normalized)) continue
      if (this.english.correct(word) || this.polish.correct(word)) continue

      const existing = issues.get(normalized)
      if (existing) {
        existing.count += 1
        continue
      }

      const suggestions = [
        ...this.polish.suggest(word).slice(0, 4),
        ...this.english.suggest(word).slice(0, 4)
      ]
        .filter((value, index, all) => all.indexOf(value) === index)
        .slice(0, 5)
        .map((suggestion) => matchCase(suggestion, word))

      issues.set(normalized, { word, normalized, count: 1, suggestions })
    }

    return [...issues.values()].sort((a, b) => b.count - a.count)
  }

  private normalize(word: string): string {
    return word.normalize('NFC').replaceAll('’', "'").toLocaleLowerCase('pl')
  }

  private shouldIgnore(word: string, normalized: string): boolean {
    if (word.length < 2 || this.customWords.has(normalized)) return true
    return word.length <= 3 && word === word.toLocaleUpperCase()
  }
}
