#!/usr/bin/env node
const path = require('path')
const fs = require('fs-extra')
const execa = require('execa')
const { prompt } = require('enquirer')
const args = require('minimist')(process.argv.slice(2))

const run = (bin, args, opts = {}) => 
  execa(bin, args, { stdio: 'inherit', ...opts })

main().catch(console.error)

async function main() {
  const targetDir = args._[0] || '.'
  const cwd = process.cwd()
  const root = path.join(cwd, targetDir)

  // check if there is already target directory
  await fs.ensureDir(root)
  const existing = await fs.readdir(root)
  if (existing.length) {
    console.warn(`Error: target directory is not empty.`)
    process.exit(1)
  }
  
  let answer = { template: 'library-ts' }
  // select a template
  if (!args.debug) {
    answer = await prompt({
      type: 'select',
      name: 'template',
      message: 'Select a template',
      choices: [
        'library',
        'library-ts',
      ]
    })
  }

  // start scaffolding project
  console.log(`\nScaffolding project in ${root}...`)
  const templateName = answer.template
  const templateDir = path.join(__dirname, `template-${templateName}`)

  // copy template
  await copy(templateDir, root)

  // replace placeholder
  await replace(root)

  // initialize git
  if (args.git) {
    await run('git', ['init', root], { stdio: 'pipe' })
  }

  // done
  console.log(`\nDone. Now run:\n`)
  if (root !== cwd) {
    console.log(`  cd ${path.relative(cwd, root)}`)
  }
  console.log(`  pnpm install`)
  console.log(`  pnpm run dev`)
  console.log()
}

async function copy(templateDir, root) {
  const files = await fs.readdir(templateDir)
  const excludeFiles = ['node_modules', 'dist', 'pnpm-lock.yaml']
  const renameFiles = { _gitignore: '.gitignore' }
  const filesToCopy = files.filter(f => !excludeFiles.includes(f))

  for (const file of filesToCopy) {
    const targetPath = renameFiles[file]
      ? path.join(root, renameFiles[file])
      : path.join(root, file)
    await fs.copy(path.join(templateDir, file), targetPath)
  }
}

async function replace(root) {
  const projectName = path.basename(root)
  const user = await parseGitConfig('user')
  
  await replacePlaceholder(
    /--(\w+?)--/ig,
    (_, m) => {
      switch (m) {
        case 'projectname':
          return projectName
        case 'username':
          return user.name || m
      }
    },
    [
      path.join(root, 'package.json'),
      path.join(root, 'README.md'),
    ]
  )
}

async function replacePlaceholder(placeholder, str, files) {
  for (const file of files) {
    const content = await fs.readFile(file, { encoding: 'utf-8' })
    const result = content.replace(placeholder, str)
    await fs.writeFile(file, result)
  }
}

async function parseGitConfig(key) {
  const { stdout } = await run('git', ['config', '--list'], { stdio: 'pipe' })
  const pairs = {}
  stdout.split('\n').forEach(s => {
    const [ keys, val ] = s.split('=')
    keys.split('.').reduce((result, key, index, array) => {
      return result[key] = index === array.length - 1
        ? val
        : result[key] || {}
    }, pairs)
  })
  return key ? pairs[key] || {} : pairs
}
