#!/usr/bin/env node

const path = require('path')
const fs = require('fs')
const minimist = require('minimist')
const chalk = require('chalk')
const execa = require('execa')
const { EventEmitter } = require('events')
const { prompt } = require('inquirer')

const cwd = process.cwd()
const args = minimist(process.argv.slice(2))
const collector = new EventEmitter()
const isDryRun = args.dry

const run = (bin, args, opts = {}) => isDryRun
  ? console.log(chalk.blue(`[dryrun] ${bin} ${args.join(' ')}`), opts)
  : execa.sync(bin, args, { stdio: 'inherit', ...opts })
const dryStep = msg => console.log(chalk.blue(`[dryrun] ${msg}`))
const guide = msg => console.log(chalk.green(msg))
const printLine = () => console.log()
const printError = (type, msg) => console.log(chalk.red(`[create-cool-app/${type}]: ${msg}`))

const excludeFiles = ['node_modules', 'dist', 'pnpm-lock.yaml']
const renameFiles = { _gitignore: '.gitignore' }
const replaceFiles = ['package.json', 'README.md']

let answers = {}

init().catch(console.error)

async function init() {
  answers = await question()

  const projectRoot = path.resolve(cwd, answers.projectName)

  // copy template
  const templateDir = path.resolve(__dirname, `template-${answers.templateName}`)
  copyDir(templateDir, projectRoot)

  // process installation
  if (answers.needInstall) {
    try {
      printLine()
      run(answers.pkgManager, ['install'], { cwd: projectRoot })
    } catch (e) {
      collector.on('error', () => printError('install', `Please install '${answers.pkgManager}' first.`))
    }
  }

  // proecess git
  if (answers.needGitInit) {
    printLine()
    run('git', ['init'], { cwd: projectRoot })
    if (answers.needGitRemoteOrigin && answers.gitRemoteOrigin) {
      run('git', ['remote', 'add', 'origin', answers.gitRemoteOrigin], { cwd: projectRoot })
    }
    if (answers.needGitPush) {
      run('git', ['add', '-A'], { cwd: projectRoot })
      run('git', ['commit', '-m', 'chore: init'], { cwd: projectRoot })
      try {
        run('git', ['push', '-u', 'origin'], { cwd: projectRoot })
      } catch (e) {
        collector.on('error', () => {
          printError('git', `Failed to push the current project to your remote repository. Please check that your remote url '${answers.gitRemoteOrigin}' is accurate.`)
        })
      }
    }
  }

  // report erros
  if (collector.listenerCount('error')) {
    printLine()
    collector.emit('error')
  }

  // done
  guide(`\nDone. Now run:`)
  guide(`  cd ${answers.projectName}`)
  if (!answers.needInstall) {
    guide(`  ${answers.pkgManager} install`)
  }
  guide(`  ${answers.pkgManager} run dev\n`)
}

async function question() {
  const projectAnswers = await prompt([
    {
      type: 'input',
      name: 'projectName',
      message: `What's your project name?`,
      validate(input) {
        if (!input) return 'The name cannot be empty.'
        if (/[\s,]/.test(input)) return `The name cannot include space and comma.`
        const dir = path.resolve(cwd, input)
        return isEmpty(dir)
          ? true
          : `The ${input} directory already exists.`
      }
    }
  ])

  const templateAnswers = await prompt([
    {
      type: 'list',
      name: 'templateName',
      message: 'Select a template',
      choices: [
        'ts',
        'ts-mono',
      ]
    },
  ])

  const installAnswers = await prompt([
    {
      type: 'list',
      name: 'pkgManager',
      message: 'Choose a package manager.',
      choices() {
        const { templateName } = templateAnswers
        switch (templateName) {
          case 'ts-mono':
            return ['pnpm']
          default:
            return ['pnpm', 'npm']
        }
      },
      default: 'pnpm'
    },
    {
      type: 'confirm',
      name: 'needInstall',
      message: 'Whether to install dependencies?'
    }
  ])

  const gitAnswers = await prompt([
    {
      type: 'confirm',
      name: 'needGitInit',
      message: 'Whether to init your project as an Git repository?'
    },
    {
      when(answers) {
        return answers.needGitInit
      },
      type: 'confirm',
      name: 'needGitRemoteOrigin',
      message: 'Whether to set a git remote origin?'
    },
    {
      when(answers) {
        return answers.needGitRemoteOrigin
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
      when(answers) {
        return answers.needGitInit && answers.gitRemoteOrigin
      },
      type: 'confirm',
      name: 'needGitPush',
      message: 'Whether to push the current project to your remote repository?'
    }
  ])

  return {
    ...projectAnswers,
    ...templateAnswers,
    ...installAnswers,
    ...gitAnswers
  }
}

function isEmpty(path) {
  if (!fs.existsSync(path)) return true
  const files = fs.readdirSync(path)
  return files.length === 0 || (files.length === 1 && files[0] === '.git')
}

function copyDir(srcDir, destDir) {
  if (isDryRun) {
    printLine()
    return dryStep(`copying ${answers.templateName}`)
  }

  fs.mkdirSync(destDir, { recursive: true })
  const files = fs.readdirSync(srcDir)
  const filesToCopy = files.filter(file => !excludeFiles.includes(file))
  for (const file of filesToCopy) {
    const srcFile = path.resolve(srcDir, file)
    const destFile = path.resolve(destDir, renameFiles[file] ? renameFiles[file] : file)
    copy(srcFile, destFile)
  }
}

function copy(src, dest) {
  const stat = fs.statSync(src)
  if (stat.isDirectory()) {
    copyDir(src, dest)
  } else {
    fs.copyFileSync(src, dest)
    const fileName = path.basename(dest)
    if (replaceFiles.includes(fileName)) {
      replacePlaceholder(dest)
    }
  }
}

function replacePlaceholder(file) {
  const content = fs.readFileSync(file, { encoding: 'utf-8' })
  const result = content.replace(
    /\$\{\s*(\w+?)\s*\}/ig,
    (_, m) => {
    switch (m) {
      case 'projectname':
        return answers.projectName
      case 'yourname':
        const user = parseGitConfig('user')
        return user.name || m
      case 'pkgManager':
        return answers.pkgManager
      case 'pkgManagerVersion':
        const { stdout } = run(answers.pkgManager, ['--version'], { stdio: 'pipe' })
        return stdout
      case 'pkgManagerX':
        return ({
          pnpm: 'pnpm',
          npm: 'npx'
        })[answers.pkgManager]
    }
  })
  fs.writeFileSync(file, result)
}

function parseGitConfig(key) {
  const { stdout } = run('git', ['config', '--global', '--list'], { stdio: 'pipe' })
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
