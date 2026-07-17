import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const targetDir = resolve(projectRoot, 'resources', 'tessdata')

await mkdir(targetDir, { recursive: true })

for (const language of ['eng', 'pol']) {
  const source = resolve(
    projectRoot,
    'node_modules',
    '@tesseract.js-data',
    language,
    '4.0.0_best_int',
    `${language}.traineddata.gz`
  )
  await copyFile(source, resolve(targetDir, `${language}.traineddata.gz`))
}

console.log('Prepared offline OCR language data: eng, pol')
