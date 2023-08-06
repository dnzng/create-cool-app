#!/usr/bin/env node

import path from 'node:path'
import inquirer from 'inquirer'
import fs from 'fs-extra'
import minimist from 'minimist'
import chalk from 'chalk'
import { execa } from 'execa'
import { fileURLToPath } from 'node:url'
import { EventEmitter } from 'node:events'

const { prompt } = inquirer
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const cwd = process.cwd()
const args = minimist(process.argv.slice(2))
const collector = new EventEmitter()
const isDryRun = args.dry
let root = cwd

const run = async (bin, args, opts = {}) => isDryRun
  ? console.log(chalk.blue(`[dryrun] ${bin} ${args.join(' ')}`), opts)
  : execa(bin, args, { stdio: 'inherit', ...opts })
const dryStep = msg => console.log(chalk.blue(`[dryrun] ${msg}`))
const guide = msg => console.log(chalk.green(msg))
const printLine = () => console.log()
const printError = (type, msg) => console.log(chalk.red(`[create-cool-app/${type}]: ${msg}`))

main().catch(console.error)

async function main() {
  const answers = await answerQuestions()

  // process template
  const templateDir = path.join(__dirname, `template-${answers.templateName}`)
  if (isDryRun) {
    printLine()
    dryStep(`creating ${answers.projectName} directory`)
    dryStep(`copying ${answers.templateName}`)
    dryStep(`replacing placeholders`)
  } else {
    // create directory
    await fs.ensureDir(root)
    // copy template
    await copy(templateDir, root)
    // replace placeholders
    await replace(root)
  }

  // process installation
  if (answers.needInstall && answers.packageManager) {
    try {
      printLine()
      await run(answers.packageManager, ['install'], { cwd: root })
    } catch (e) {
      collector.on('error', () => printError('install', `Please install ${answers.packageManager} first.`))
      
    }
  }

  // proecess git
  if (answers.needGitInit) {
    printLine()
    await run('git', ['init'], { cwd: root })
    if (answers.needGitRemoteOrigin && answers.gitRemoteOrigin) {
      await run('git', ['remote', 'add', 'origin', answers.gitRemoteOrigin], { cwd: root })
    }
    if (answers.needGitPush) {
      await run('git', ['add', '-A'], { cwd: root })
      await run('git', ['commit', '-m', 'chore: init'], { cwd: root })
      try {
        await run('git', ['push', '-u', 'origin'], { cwd: root })
      } catch (e) {
        collector.on('error', () => {
          printError('git', `Git failed to push the current project to your remote repository. Please check that your remote url '${answers.gitRemoteOrigin}' is accurate.`)
        })
      }
    }
  }

  if (collector.listenerCount('error')) {
    collector.emit('error')
    printLine()
  } else {
    // done
    const packageManager = answers.packageManager || 'pnpm'
    guide(`\nDone. Now run:`)
    if (root !== cwd) {
      guide(`  cd ${path.relative(cwd, root)}`)
    }
    if (!answers.needGitInit) {
      guide(`  ${packageManager} install`)
    }
    guide(`  ${packageManager} run dev`)
    printLine()
  }
}

async function answerQuestions() {
  const project = [
    {
      type: 'input',
      name: 'projectName',
      message: `What's your project name?`,
      async validate(input) {
        if (!input) return 'The name cannot be empty.'
        if (/[\s,]/.test(input)) return `The name cannot include space and comma.`

        root = path.join(cwd, input)
        const result = await existsDir(root)
        if (!result.found) return true
        if (result.hasFiles) return `The directory already exists.`
        return true
      }
    }
  ]

  const template = [
    {
      type: 'list',
      name: 'templateName',
      message: 'Select a template',
      choices: [
        'library-ts',
        'library',
      ]
    },
  ]

  const install = [
    {
      type: 'confirm',
      name: 'needInstall',
      message: 'Whether to install dependencies?'
    },
    {
      when(answer) {
        return answer.needInstall
      },
      type: 'list',
      name: 'packageManager',
      message: 'Choose a package manager.',
      choices: [
        'pnpm',
        'npm',
        'yarn'
      ],
      default: 'pnpm'
    },
  ]

  const git = [
    {
      type: 'confirm',
      name: 'needGitInit',
      message: 'Whether to init your project as an Git repository?'
    },
    {
      when(answer) {
        return answer.needGitInit
      },
      type: 'confirm',
      name: 'needGitRemoteOrigin',
      message: 'Whether to set a git remote origin?'
    },
    {
      when(answer) {
        return answer.needGitRemoteOrigin
      },
      type: 'input',
      name: 'gitRemoteOrigin',
      message: `What's your remote git repository url?`,
      validate(input) {
        if (!input) return 'The url cannot be empty.'
        return true
      }
    },
    {
      when(answer) {
        return answer.needGitInit && answer.gitRemoteOrigin
      },
      type: 'confirm',
      name: 'needGitPush',
      message: 'Whether to push the current project to your remote repository?'
    }
  ]

  return await prompt([
    ...project,
    ...template,
    ...install,
    ...git
  ])
}

async function existsDir(dir) {
  const result = {
    found: false,
    hasFiles: false
  }

  try {
    const existing = await fs.readdir(dir)
    result.found = true
    result.hasFiles = !!existing.length
  } catch (e) {
    result.found = false
  }

  return result
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
