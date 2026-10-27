/* ============================================================================
 * 启动动画初始化冒烟测试 —— 用最小 DOM 桩把 splash.js 完整跑一遍
 *
 * 为什么需要它：黑幕兜底是"贴在第一屏上的"，一旦 splash.js 初始化抛异常，
 * dsu-boot 就永远摘不掉 → 用户看到永久黑屏。这个测试专门守住那条线：
 *   1) 初始化不许抛异常
 *   2) 跑完必须摘掉 dsu-boot（否则就是黑屏）
 *   3) 暴露 __DSH_STARTUP_API__
 *   4) JS 里用到的每个选择器，都必须在生成出来的 markup 里真实存在
 *      —— 这条能抓到"接了个不存在的元素"这类手误
 *   5) 没有 speechSynthesis 的环境（Node / 老浏览器）也必须能跑
 *
 * 用法：node test/smoke-splash.mjs
 * ========================================================================== */
import fs from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const BUNDLE = fileURLToPath(new URL('../lib/splash.js', import.meta.url))

let pass = 0
let fail = 0
function check(label, ok, extra) {
  if (ok) { pass++; console.log('  ok   ' + label) }
  else { fail++; console.log('  FAIL ' + label + (extra !== undefined ? '  → ' + extra : '')) }
}

/* ── 最小 DOM 桩 ─────────────────────────────────────────────────────────── */
function makeEl(tag) {
  const el = {
    tagName: tag,
    _cls: '',
    _text: '',
    _html: '',
    /* 记录型 style：chromeSync 会读写内联属性，这里要能断言"设过 / 还原了" */
    style: (() => {
      const map = new Map()
      return {
        _map: map,
        setProperty(k, v) { map.set(String(k), String(v)) },
        removeProperty(k) { map.delete(String(k)) },
        getPropertyValue(k) { return map.get(String(k)) || '' },
        get backgroundColor() { return map.get('background-color') || '' },
        set backgroundColor(v) { map.set('background-color', String(v)) },
      }
    })(),
    dataset: {},
    children: [],
    hidden: false,
    offsetWidth: 1,
    parentNode: null,
    appendChild(c) { this.children.push(c); if (c) c.parentNode = this; return c },
    insertBefore(c) { this.children.unshift(c); if (c) c.parentNode = this; return c },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c },
    setAttribute() {},
    getAttribute() { return null },
    hasAttribute() { return false },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    animate() { return { cancel() {}, finish() {} } },
    getTotalLength() { return 120 },
    querySelector(sel) { return lookup(sel) },
    querySelectorAll() { return [] },
    focus() {},
    contains() { return false },
  }
  Object.defineProperty(el, 'className', {
    get() { return el._cls },
    set(v) { el._cls = v == null ? '' : String(v) },
  })
  Object.defineProperty(el, 'textContent', {
    get() { return el._text },
    set(v) { el._text = v == null ? '' : String(v) },
  })
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html },
    set(v) { el._html = v == null ? '' : String(v); MARKUP = el._html },
  })
  el.classList = {
    add(...cs) { cs.forEach((c) => { if (!el._cls.split(' ').includes(c)) el._cls = (el._cls + ' ' + c).trim() }) },
    remove(...cs) { cs.forEach((c) => { el._cls = el._cls.split(' ').filter((x) => x && x !== c).join(' ') }) },
    toggle(c, on) {
      const has = el._cls.split(' ').includes(c)
      const want = on === undefined ? !has : !!on
      if (want && !has) el.classList.add(c)
      if (!want && has) el.classList.remove(c)
    },
    contains(c) { return el._cls.split(' ').includes(c) },
  }
  return el
}

/* markup 里出现过的 class 集合：选择器必须命中它，否则视为"接了个不存在的元素" */
let MARKUP = ''
const MISSED = new Set()
const lookupCache = new Map()
function lookup(sel) {
  if (!sel) return null
  const key = String(sel)
  if (lookupCache.has(key)) return lookupCache.get(key)
  const m = /\.([A-Za-z0-9_-]+)/.exec(key)
  const cls = m ? m[1] : null
  const found = cls !== null && MARKUP.includes(cls)
  if (!found) MISSED.add(key)
  const node = found ? makeEl('div') : null
  lookupCache.set(key, node)
  return node
}

/* ── window / document ───────────────────────────────────────────────────── */
const spoken = []
function makeSpeech() {
  return {
    /* 故意混入"老拼接合成"音色：David(男) / Zira(女) / Huihui(女)，
       正确的英文选择应该跳过它们和女声 Aria，挑男声 Online (Natural) 的 Guy；
       中文播报仍挑女声 Xiaoxiao */
    _voices: [
      { name: 'Microsoft David Desktop - English (United States)', lang: 'en-US', localService: true },
      { name: 'Microsoft Zira Desktop - English (United States)', lang: 'en-US', localService: true },
      { name: 'Microsoft Huihui Desktop - Chinese (Simplified)', lang: 'zh-CN', localService: true },
      { name: 'Microsoft Aria Online (Natural) - English (United States)', lang: 'en-US', localService: false },
      { name: 'Microsoft Guy Online (Natural) - English (United States)', lang: 'en-US', localService: false },
      { name: 'Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)', lang: 'zh-CN', localService: false },
    ],
    getVoices() { return this._voices },
    speak(u) { spoken.push(u) },
    cancelCalls: 0,
    cancel() { this.cancelCalls++; spoken.length = 0 },
    resume() {},
    pause() {},
    addEventListener() {},
    removeEventListener() {},
  }
}

function run(withSpeech, cfgOverride, env) {
  MARKUP = ''
  MISSED.clear()
  lookupCache.clear()
  spoken.length = 0
  const E = env || {}

  const root = makeEl('div')
  root._cls = 'dsu-root dsu-boot'
  const head = makeEl('head')
  const body = makeEl('body')
  const htmlEl = makeEl('html')

  const documentStub = {
    readyState: 'complete',
    head, body,
    documentElement: htmlEl,
    getElementById: (id) => (id === 'dsh-startup-root' ? root : null),
    createElement: (t) => makeEl(t),
    createElementNS: (_ns, t) => makeEl(t),
    querySelector: (sel) => (E.probe && /span/.test(String(sel)) ? E.probe : null),
    querySelectorAll: (sel) => (E.probe && /span/.test(String(sel)) ? [E.probe] : []),
    addEventListener() {},
    removeEventListener() {},
  }

  const timers = []
  const windowStub = {
    __DSH_STARTUP__: {
      enabled: true, mode: 'always', theme: 'dark', speed: 1,
      requireInteraction: true, allowSkip: true,
      identity: 'JACK COOPER', identityId: 'BT-7274', accessLevel: 'PILOT',
      /* 只覆盖测试要变的；语速/音调/留白故意留空，好让断言直接校验 splash.js 出厂默认值 */
      voice: true, voiceLang: 'en', voiceName: '',
      sound: true, soundVolume: 0.5,
    },
    AudioContext: function () {
      return {
        state: 'running', currentTime: 0, sampleRate: 48000, destination: {},
        resume() {},
        createOscillator() {
          return { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }
        },
        createGain() {
          return { gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }
        },
        createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) } },
        createBufferSource() { return { buffer: null, connect() {}, start() {} } },
        createBiquadFilter() { return { type: '', frequency: { value: 0 }, Q: { value: 0 }, connect() {} } },
      }
    },
    location: {
      host: '127.0.0.1:3080',
      href: (E.protocol || 'http:') + '//127.0.0.1:3080/',
      protocol: E.protocol || 'http:',
    },
    navigator: { userAgent: E.userAgent || 'Mozilla/5.0 (X11; Linux x86_64)' },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    sessionStorage: { getItem: () => null, setItem() {} },
    localStorage: { getItem: () => null, setItem() {} },
    requestAnimationFrame: (fn) => { fn(); return 1 },
    cancelAnimationFrame() {},
    /* 小延时同步执行 —— voiceLead 是 240ms，不这样做 line() 永远开不了口；
       大延时（动画时间线）照旧入队，测试保持同步可控 */
    setTimeout: (fn, ms) => {
      if ((ms || 0) <= 400) { fn(); return -1 }
      timers.push({ fn, ms })
      return timers.length
    },
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
    CustomEvent: function (t) { this.type = t },
  }
  if (withSpeech) {
    windowStub.speechSynthesis = makeSpeech()
    /* 浏览器里 window === globalThis，但沙箱里是两回事：
       splash.js 检查的是 window.SpeechSynthesisUtterance，所以两边都要挂 */
    windowStub.SpeechSynthesisUtterance = function (t) {
      this.text = t; this.rate = 1; this.pitch = 1; this.volume = 1
    }
  }
  windowStub.window = windowStub

  const sandbox = {
    window: windowStub,
    document: documentStub,
    console,
    /* chromeSync 用 getComputedStyle 判断探针是否已真的透明 */
    getComputedStyle: (el) => ({
      get backgroundColor() {
        const v = el && el.style ? el.style.getPropertyValue('background-color') : ''
        return v || (E.computedBg || 'rgb(27, 27, 28)')
      },
    }),
    MutationObserver: E.MutationObserver,
    Promise, Object, Array, JSON, String, Number, Math, Date, Error, RegExp, isFinite,
    setTimeout: windowStub.setTimeout,
    clearTimeout: windowStub.clearTimeout,
    setInterval: windowStub.setInterval,
    clearInterval: windowStub.clearInterval,
    requestAnimationFrame: windowStub.requestAnimationFrame,
    SpeechSynthesisUtterance: withSpeech
      ? function (t) { this.text = t; this.rate = 1; this.pitch = 1; this.volume = 1 }
      : undefined,
  }
  sandbox.globalThis = sandbox
  sandbox.self = sandbox

  /* 配置覆盖必须在跑脚本之前生效 —— splash.js 只在加载时读一次配置 */
  Object.assign(windowStub.__DSH_STARTUP__, cfgOverride || {})

  vm.createContext(sandbox)
  const src = fs.readFileSync(BUNDLE, 'utf8')
  let thrown = null
  try {
    vm.runInContext(src, sandbox, { filename: 'splash.js' })
  } catch (e) {
    thrown = e
  }
  return { windowStub, root, head, timers, thrown, markup: MARKUP, sandbox, spoken }
}

/* ── 开跑 ───────────────────────────────────────────────────────────────── */
console.log('\n[1] 有 speechSynthesis 的环境（Chrome / Edge）')
let r = run(true)
check('初始化不抛异常', r.thrown === null, r.thrown && (r.thrown.message + '\n       ' + String(r.thrown.stack).split('\n')[1]))
check('摘掉了黑幕 dsu-boot（没摘掉 = 永久黑屏）', !r.root.classList.contains('dsu-boot'), '当前 class = ' + r.root._cls)
check('暴露了 __DSH_STARTUP_API__', !!(r.windowStub.__DSH_STARTUP_API__ && r.windowStub.__DSH_STARTUP_API__.replay))
check('API 上有 replay / skip / finish', ['replay', 'skip', 'finish'].every((k) => typeof (r.windowStub.__DSH_STARTUP_API__ || {})[k] === 'function'))
check('没有 FAILED 兜底标记', r.windowStub.__DSH_STARTUP_FAILED__ !== true)

console.log('\n[2] 生成出来的 markup 完整性')
for (const cls of [
  'dsu-bg', 'dsu-plate', 'dsu-vignette', 'dsu-black-inner', 'dsu-wash', 'dsu-brand-1', 'dsu-frame',
  'dsu-scanline', 'dsu-corner', 'dsu-slats', 'dsu-voice', 'dsu-meta', 'dsu-status-zh',
  'dsu-sub-en', 'dsu-rule', 'dsu-logo', 'dsu-dots', 'dsu-idline', 'dsu-reticle', 'dsu-hex',
  'dsu-welcome', 'dsu-w1', 'dsu-btn', 'dsu-card', 'dsu-skip', 'dsu-foot', 'dsu-sub-zh',
  'dsu-progress', 'dsu-bloom', 'dsu-streak', 'dsu-flash', 'dsu-crt',
  /* 2.2 Hammond 版式新增：左栏信息列 / 主标题 / 圆徽 / 右上机构行 / 自检清单 */
  'dsu-col', 'dsu-headline', 'dsu-headline-text', 'dsu-headline-sub', 'dsu-tr',
  'dsu-roundel', 'dsu-roundel-name', 'dsu-roundel-sub',
  'dsu-checklist', 'dsu-check', 'dsu-pct', 'dsu-tagline', 'dsu-foot-v',
  /* 注：dsu-check-label / dsu-check-state 是运行时 el() 构建的行内元素，
     不在静态 html 模板里，由 [8b] 的源码断言覆盖。 */
]) {
  check('markup 含 .' + cls, r.markup.includes(cls))
}

console.log('\n[3] JS 用到的每个选择器都真实存在')
check('没有落空的选择器', MISSED.size === 0, [...MISSED].join(', '))

console.log('\n[4] 没有 speechSynthesis 的环境（老浏览器 / 隐私模式）')
r = run(false)
check('初始化不抛异常', r.thrown === null, r.thrown && r.thrown.message)
check('照样摘掉黑幕', !r.root.classList.contains('dsu-boot'), '当前 class = ' + r.root._cls)
check('暴露了 API', !!r.windowStub.__DSH_STARTUP_API__)

console.log('\n[5] 音色挑选：英文台词挑神经网络男声（BT），中文播报挑女声')
r = run(true)
let api = r.windowStub.__DSH_STARTUP_API__
check('默认 voiceName 留空 = 自动挑', api.config.voiceName === '')
api.speak('Pilot link required.')
let u = r.spoken[r.spoken.length - 1]
let vname = u && u.voice ? u.voice.name : '(未设置 voice)'
check('英文挑到 Guy Online (Natural)，而不是 Aria/Zira', /guy/i.test(vname) && /natural|online/i.test(vname), vname)
check('不是女声 Aria / Zira', !/aria|zira/i.test(vname), vname)

r = run(true, { voiceLang: 'zh' })
api = r.windowStub.__DSH_STARTUP_API__
api.speak('Pilot link required.', '需要铁驭链接')
u = r.spoken[r.spoken.length - 1]
vname = u && u.voice ? u.voice.name : '(未设置 voice)'
check('中文挑到 Xiaoxiao Online (Natural)，而不是 Huihui', /xiaoxiao/i.test(vname) && /natural|online/i.test(vname), vname)

r = run(true, { voiceLang: 'both' })
api = r.windowStub.__DSH_STARTUP_API__
api.speak('All systems nominal.', '全系统正常')
const names = r.spoken.map((x) => (x.voice ? x.voice.name : '')).filter(Boolean)
check('中英各念一遍 = 排了两条 utterance', r.spoken.length === 2, String(r.spoken.length))
check('中文用中文音色、英文用英文音色', names.some((n) => /xiaoxiao/i.test(n)) && names.some((n) => /guy/i.test(n)), names.join(' | '))

console.log('\n[6] 播报语调节奏与名字念法')
r = run(true)
api = r.windowStub.__DSH_STARTUP_API__
api.speak('Initiating neural handshake.')
u = r.spoken[r.spoken.length - 1]
check('语速落在 BT 播报档（0.8–0.95，比朗读慢）', u.rate >= 0.8 && u.rate <= 0.95, String(u.rate))
check('音调压低（0.78–0.92，低沉男声）', u.pitch >= 0.78 && u.pitch <= 0.92, String(u.pitch))
check('名字全大写会转 Title Case（避免逐字母念）', api.speakName('JACK COOPER') === 'Jack Cooper', api.speakName('JACK COOPER'))
check('中文名字原样不动', api.speakName('琉璃') === '琉璃', api.speakName('琉璃'))
check('API 暴露了 voice 供设置页显示', typeof api.voice === 'string')

console.log('\n[7] 动画不许掐断语音（这是这一版的核心诉求）')
r = run(true)
api = r.windowStub.__DSH_STARTUP_API__
const speech = r.windowStub.speechSynthesis
check('voiceLead 默认 240ms（提示音后留一拍再开口）', api.config.voiceLead === 240, String(api.config.voiceLead))
speech.cancelCalls = 0
api.speak('Pilot link required.')
api.speak('Initiating neural handshake.')
api.speak('Mission directive received.')
check('连播三句，cancel 一次都没调用（队列顺序播报）', speech.cancelCalls === 0, 'cancel ' + speech.cancelCalls + ' 次')
check('三句都排进了队列', r.spoken.length === 3, String(r.spoken.length))
speech.cancelCalls = 0
api.skip()
check('按跳过时才真的掐断（cancel 1 次）', speech.cancelCalls === 1, 'cancel ' + speech.cancelCalls + ' 次')

console.log('\n[8] 语音素材通道：BT 真声优先、缺素材自动回落 TTS')
{
  const src = fs.readFileSync(BUNDLE, 'utf8')
  check('五步各挂一段 BT 真声素材槽位', (src.match(/audio: 'line-/g) || []).length === 5)
  check('步骤语音调用点真的把素材槽位递进去（2.0 曾漏传导致永远 TTS）',
    /voice\.line\(step\.say, step\.zh, step\.audio\)/.test(src))
  check('终幕协议三也挂素材（line-6）', /voice\.line\('Protocol three\. Protect the pilot\.', '协议三 · 保护铁驭', 'line-6'\)/.test(src))
  check('揭幕前会等播报结束', /\.then\(function \(\) \{ return welcome \}\)/.test(src))
  check('素材预加载包含终幕', /ensureAsset\('line-6'\)/.test(src))
  check('voiceSource 出厂默认 asset', /voiceSource: 'asset'/.test(src))
  check('素材缺失会回落 TTS', /return ttsLine\(en, zh\)/.test(src))
  check('五步各带一句英文播报台词（TTS 回落用）', (src.match(/say: '/g) || []).length === 5)
  check('看门狗在引擎真正开口（onstart）后重新起表（防在线音色延迟掐断语音）',
    /u\.onstart = function \(\) \{\s*setMeter\(true\)[\s\S]*?watchdog = setTimeout\(settle, est \+ 1500\)/.test(src))
  check('揭幕前留一拍收尾（不在最后一个音节上直接进主界面）',
    /\.then\(function \(\) \{ return welcome \}\)\s*\.then\(function \(\) \{ return wait\(ms\(280\)\) \}\)/.test(src))
  check('运行时版本横幅（控制台一眼看出跑的是哪份代码）',
    /RUNTIME_VERSION = '2\.2\.0'/.test(src) && src.includes("[dsh-startup-screen] 运行时 v' + RUNTIME_VERSION"))
  check('素材加载结果暴露 __DSH_STARTUP_ASSETS__（401/404/解码失败可查）',
    src.includes('__DSH_STARTUP_ASSETS__') && src.includes("素材 ' + name + ' 不可用"))
  check('素材拿不到时按 .mp3 → .wav → .ogg 依次尝试', /\.mp3'\)\.then/.test(src) && /\.wav'\)\.then/.test(src) && /\.ogg'\)\.then/.test(src))
  check('AudioContext 被自动播放策略挂起时不排队素材（防挂死）+ 走 TTS',
    /c\.state !== 'running' \|\| !buf/.test(src) && /audio\.canPlay\(\)/.test(src))
}

console.log('\n[8b] 2.2 Hammond 版式：自检清单 / 百分比 / 背景图 / 待命状态行')
{
  const src = fs.readFileSync(BUNDLE, 'utf8')
  check('自检清单五项齐全（LOADING PILOT PROFILE → FINALIZING BOOT SEQUENCE）',
    src.includes("'LOADING PILOT PROFILE'") &&
    src.includes("'INITIALIZING TITAN INTERFACE'") &&
    src.includes("'SYNCING NEURAL LINK'") &&
    src.includes("'ESTABLISHING COMMS'") &&
    src.includes("'FINALIZING BOOT SEQUENCE'"))
  check('清单打点接好：底板点亮 tickCheck(0)、每步 tickCheck(n)、终幕 tickCheck(6)',
    /tickCheck\(0\)/.test(src) && /tickCheck\(n\)/.test(src) && /tickCheck\(6\)/.test(src))
  check('进度条带百分比读数（setProgress 同步更新 .dsu-pct）',
    /ui\.pct\.textContent = Math\.round\(pct \* 100\) \+ '%'/.test(src))
  check('背景图按 bg.jpg → bg.png → bg.webp 依次尝试，缺图回落纯色底板',
    /'jpg', 'png', 'webp'/.test(src) && /回落纯色底板/.test(src))
  check('没有 Image 的环境（Node 桩）安全跳过背景图加载', /typeof Image !== 'function'/.test(src))
  check('背景图结果写进 __DSH_STARTUP_ASSETS__.bg', /__DSH_STARTUP_ASSETS__\.bg = state/.test(src))
  check('底板点亮后状态行先待命（INITIATING...）',
    src.includes("typeIn(ui.statusZh, '初始化', 46)") && src.includes("typeIn(ui.subEn, 'INITIATING...', 13)"))
}

console.log('\n[9] 右下角身份读数：不压版心、窄窗口不丢、第 3 幕随身份核验退场')
{
  const css = fs.readFileSync(fileURLToPath(new URL('../lib/splash.css', import.meta.url)), 'utf8')
  const src = fs.readFileSync(BUNDLE, 'utf8')
  const idlineRule = (css.match(/\.dsu-idline\s*\{[^}]*\}/) || [''])[0]
  check('.dsu-idline 用 right/bottom 锚定（脱离居中版心）', /right:\s*46px/.test(idlineRule) && /bottom:\s*104px/.test(idlineRule), idlineRule.slice(0, 80))
  check('.dsu-idline 不再用 left: calc(50% + 190px)', !/left:\s*calc\(50% \+ 190px\)/.test(idlineRule))
  check('.dsu-idline 不再用 top: 49%', !/top:\s*49%/.test(idlineRule))
  check('.dsu-idline 无 translateY(-50%)（不再垂直居中）', !/translateY\(-50%\)/.test(idlineRule))
  check('.dsu-idline 右对齐成独立读数', /text-align:\s*right/.test(idlineRule))
  check('.dsu-idline.dsu-in 落到 transform: none', /\.dsu-idline\.dsu-in\s*\{[^}]*transform:\s*none/.test(css))
  check('窄窗口不再藏掉身份读数（无 display:none 规则）', !/\.dsu-idline\s*\{\s*display:\s*none/.test(css))
  check('那条 @media(max-width:1180px) 兜底已移除', !/1180px/.test(css))
  check('第 3 幕起（i >= 2）就收掉身份读数', /if \(i >= 2\) ui\.idline\.classList\.remove\('dsu-in'\)/.test(src))
  check('退场只发生在 stepLoop 开场与 finale 两处', (src.match(/ui\.idline\.classList\.remove\('dsu-in'\)/g) || []).length === 2)
}

console.log('\n[10] 桌面端标题栏同步：仅 Windows 桌面端生效、可还原、探针重挂能自愈')
{
  const CLEAR = 'rgba(0, 0, 0, 0)'
  const mkProbe = () => {
    const el = makeEl('span')
    el.isConnected = true
    el.style.setProperty('background-color', 'var(--dsw-specific-sidebar-fill)')
    return el
  }
  const WIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

  /* ① 浏览器（web profile）：整段空转，绝不碰探针 */
  let probe = mkProbe()
  let env = { probe, protocol: 'http:', userAgent: WIN_UA }
  let rr = run(true, {}, env)
  let chrome = rr.windowStub.__DSH_STARTUP_CHROME__
  check('暴露了 __DSH_STARTUP_CHROME__ 把手', !!chrome && typeof chrome.hide === 'function' && typeof chrome.show === 'function')
  check('浏览器环境判定为非桌面端', chrome.isDesktopWin() === false)
  check('浏览器环境不动探针底色', probe.style.getPropertyValue('background-color') === 'var(--dsw-specific-sidebar-fill)', probe.style.getPropertyValue('background-color'))

  /* ② Windows 桌面端：hide 把探针与 token 一起钉成透明 */
  probe = mkProbe()
  env = { probe, protocol: 'dsh-app:', userAgent: WIN_UA }
  rr = run(true, {}, env)
  chrome = rr.windowStub.__DSH_STARTUP_CHROME__
  const de = rr.sandbox.document.documentElement
  check('Windows 桌面端判定成立', chrome.isDesktopWin() === true)
  check('探针底色被钉成全透明', probe.style.getPropertyValue('background-color') === CLEAR, probe.style.getPropertyValue('background-color'))
  check('探针符号色也被钉透明（按钮图标不可见）', probe.style.getPropertyValue('color') === CLEAR)
  check('html 上的 token 一并设成透明（双保险）', de.style.getPropertyValue('--dsw-specific-sidebar-fill') === CLEAR)

  /* ③ 揭幕还原 */
  chrome.show()
  check('show() 清掉探针底色', probe.style.getPropertyValue('background-color') === '', JSON.stringify(probe.style.getPropertyValue('background-color')))
  check('show() 清掉探针符号色', probe.style.getPropertyValue('color') === '')
  check('show() 把 html token 也还原', de.style.getPropertyValue('--dsw-specific-sidebar-fill') === '')

  /* ④ 探针被应用重挂：缓存节点脱离文档后应重新查找（P1） */
  probe.isConnected = false
  const probe2 = mkProbe()
  env.probe = probe2
  chrome.hide()
  check('探针被重挂后能重新找到并继续生效', probe2.style.getPropertyValue('background-color') === CLEAR, probe2.style.getPropertyValue('background-color'))

  /* ⑤ macOS 桌面端：UA 不含 Win，整段空转 */
  const macProbe = mkProbe()
  rr = run(true, {}, { probe: macProbe, protocol: 'dsh-app:', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })
  chrome = rr.windowStub.__DSH_STARTUP_CHROME__
  check('macOS 判定为非 Windows 桌面端', chrome.isDesktopWin() === false)
  check('macOS 不动探针', macProbe.style.getPropertyValue('background-color') === 'var(--dsw-specific-sidebar-fill)')
}

console.log('\n============================')
console.log(`  通过 ${pass} / 失败 ${fail}`)
console.log('============================\n')
process.exit(fail === 0 ? 0 : 1)
