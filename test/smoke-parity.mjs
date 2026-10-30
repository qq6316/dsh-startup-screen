/* ============================================================================
 * 配置一致性冒烟测试 —— 守住「两份 DEFAULTS 手工同步」的契约
 * ----------------------------------------------------------------------------
 * Host 半侧（lib/index.js）与浏览器半侧（lib/splash.js）各持一份 DEFAULTS，
 * 注入与回落全靠它俩完全一致。历史上靠人肉同步，漏一项就是「设置页写了
 * 不生效」或反之。本测试用源码里抠字面量的办法做三层断言：
 *   1) 两份 DEFAULTS：键集合完全一致，值严格相等
 *   2) index.js 的字段表（TEXT_KEYS / COLOR_KEYS / BOOL_KEYS / ENUMS / RANGES）
 *      每一个键都必须在 DEFAULTS 里真实存在（防「表里写了、对象漏了」）
 *   3) ENUMS 的每个默认值都必须是它自己白名单里的成员
 *      （防「默认值不在白名单，被 normalize 一跑就悄悄回落」）
 *
 * 用法：node test/smoke-parity.mjs
 * ========================================================================== */
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const INDEX = fileURLToPath(new URL('../lib/index.js', import.meta.url))
const SPLASH = fileURLToPath(new URL('../lib/splash.js', import.meta.url))

let pass = 0
let fail = 0
function check(label, ok, extra) {
  if (ok) { pass++; console.log('  ok   ' + label) }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  → ' + extra : '')) }
}

/** 从源码里抠出 `DEFAULTS = {……}` 字面量（括号配平，字符串里若有大括号也安全） */
function extractObject(src, name) {
  const m = new RegExp('(?:const|var)\\s+' + name + '\\s*=\\s*\\{').exec(src)
  if (!m) throw new Error('源码里找不到 ' + name)
  const open = src.indexOf('{', m.index)   /* 先钉住这个 `{`，从它这里起步计数 */
  let depth = 0
  let inStr = null
  for (let i = open; i < src.length; i++) {
    const ch = src[i]
    if (inStr) {
      if (ch === '\\') { i++; continue }
      if (ch === inStr) inStr = null
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue }
    if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(open + 1, i) }
  }
  throw new Error(name + ' 字面量括号不闭合')
}

/** eval 抠出来的字面量（带注释、单引号都能吃） */
function evalLiteral(text) {
  return new Function('return (' + text + ')')()
}

const indexSrc = fs.readFileSync(INDEX, 'utf8')
const splashSrc = fs.readFileSync(SPLASH, 'utf8')

function deepDiff(a, b, path) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) {
    const p = path + '.' + k
    if (!(k in a)) return p + '（index.js 缺这一项）'
    if (!(k in b)) return p + '（splash.js 缺这一项）'
    if (typeof a[k] !== typeof b[k]) return p + '（类型不同：' + typeof a[k] + ' vs ' + typeof b[k] + '）'
    const x = a[k]; const y = b[k]
    if (x !== y) return p + '（' + JSON.stringify(x) + ' vs ' + JSON.stringify(y) + '）'
  }
  return null
}

console.log('\n[1] Host / Browser 两份 DEFAULTS 一字不差')
const idxDefaults = evalLiteral('{\n' + extractObject(indexSrc, 'DEFAULTS') + '\n}')
const splDefaults = evalLiteral('{\n' + extractObject(splashSrc, 'DEFAULTS') + '\n}')
const diff = deepDiff(idxDefaults, splDefaults, 'DEFAULTS')
check('键集合与每一项的值都一致', diff === null, diff || '(自由意志之外没有区别)')

console.log('\n[2] 字段表里的每个键都真实存在于 DEFAULTS')
const tables = ['TEXT_KEYS', 'COLOR_KEYS', 'BOOL_KEYS']
for (const name of tables) {
  const m = new RegExp('const\\s+' + name + '\\s*=\\s*\\[([^\\]]*)\\]').exec(indexSrc)
  if (!m) { check('源码里有 ' + name, false); continue }
  const keys = evalLiteral('[' + m[1] + ']')
  check(name + ' 全部落在 DEFAULTS 里', keys.every((k) => k in idxDefaults), keys.filter((k) => !(k in idxDefaults)).join(', '))
}

console.log('\n[3] ENUMS / RANGES 表')
const ENUMS = evalLiteral('{\n' + extractObject(indexSrc, 'ENUMS') + '\n}')
const RANGES = evalLiteral('{\n' + extractObject(indexSrc, 'RANGES') + '\n}')
for (const [key, list] of Object.entries(ENUMS)) {
  check(key + ' 在 DEFAULTS 里', key in idxDefaults)
  check(key + ' 出厂默认在白名单内', list.includes(idxDefaults[key]), String(idxDefaults[key]))
  check(key + ' 在 splash.js 的 DEFAULTS 里也是白名单成员', key in splDefaults && list.includes(splDefaults[key]), String(splDefaults && splDefaults[key]))
}
for (const [key, range] of Object.entries(RANGES)) {
  const [lo, hi] = range
  check(key + ' 在 DEFAULTS 里', key in idxDefaults)
  check(key + ' 出厂默认落在 [' + lo + ', ' + hi + '] 区间内', typeof idxDefaults[key] === 'number' && idxDefaults[key] >= lo && idxDefaults[key] <= hi, String(idxDefaults[key]))
  check(key + ' 在 splash.js 的 DEFAULTS 里同样落在区间内', typeof splDefaults[key] === 'number' && splDefaults[key] >= lo && splDefaults[key] <= hi, String(splDefaults[key]))
}

console.log('\n[4] package.json 打包清单')
{
  const pkg = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
  const files = pkg.files || []
  check('排除了语音素材 zip', files.includes('!lib/assets/*.zip'))
  check('排除了 wav 副本（mp3 全浏览器都能解，wav 只额外占 1.2MB）', files.includes('!lib/assets/*.wav'))
  check('打包根材料齐全（lib/test/preview/安装.cmd/README…）',
    files.includes('lib') && files.includes('test') && files.includes('preview/index.html') &&
    files.includes('安装.cmd') && files.includes('README.md'))
}

console.log('\n============================')
console.log(`  通过 ${pass} / 失败 ${fail}`)
console.log('============================\n')
process.exit(fail === 0 ? 0 : 1)
