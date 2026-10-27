# 需要音频的字段清单

本文件列出启动动画里**所有会出声的槽位**，以及每个槽位当前用的是哪份素材。
数值与文件名直接从 `lib/splash.js` 抓取。对应 2.1（泰坦陨落 2 · BT 版）。

---

## 一、语音台词 —— BT 原声素材优先，TTS 自动回落

6 个台词槽位，每个都挂着一份可选的 BT 真声素材（`lib/assets/line-N.mp3`）。
缺哪段就自动回落到系统 TTS 男声念 `say` 台词，一个不放也照常播，只是没有原声。

**2.1.1 起已内置 5 句**，取自 DBM-VPBT7274 语音包（Bert-VITS2 用 BT-7274 声线
训练的 AI 合成语音，作者 一个小莽夫）：

| 槽位 | 画面步骤 | 已内置素材 | 实际台词（DBM 词表原文） | TTS 回落台词 |
|---|---|---|---|---|
| `line-1` | 需要铁驭链接 | `readyrescue` | "Prepare rescue"（准备救援） | `Pilot link required.` |
| `line-2` | 神经握手同步 | `positive` | "positive"（收到） | `Initiating neural handshake.` |
| `line-3` | 接收任务指令 | `com_go` | "GO GO GO" | `Mission directive received.` |
| `line-4` | 系统自检开始 | `checkhp` | "health warning!"（健康检查告警） | `Systems check initiated.` |
| `line-5` | 全系统正常 | `safenow` | "safe now"（已安全） | `All systems nominal.` |
| `line-6` | 协议三 · 揭幕 | `defensive` | **"Defensive"**（防御姿态） | `Protocol three. Protect the pilot.` |

> 台词以 DBM 官方 `!VoiceText.txt` 词表为准（Bert-VITS2 就是按这份词表生成的）。

> 终幕素材**刻意选了 WebAudio 通道**：TTS 在线音色偶发合成失败（onerror）/
> 延迟，会把协议三那句话吞掉或掐断；素材播放走 WebAudio，确定性强。
> 想让终幕念完整原话 "Protocol three. Protect the pilot."：删掉
> `lib/assets/line-6.mp3`（或语音来源切 `系统 TTS 男声`）；
> 想用自己的录音：存成 `lib/assets/line-6.mp3` 覆盖即可。

### 换素材 / 补素材

1. 完整语音包备份在仓库根目录 `BT语音素材包/DBM-VPBT7274.zip`（339 条 ogg 切片，
   实为 WAV 数据）；zip 已从 `lib/assets/` 挪走，不会被打进发布包
2. 挑中意的切片覆盖 `lib/assets/line-1 … 6.mp3`（无需转码：内容是 WAV，
   `decodeAudioData` 按内容嗅探解码，Chromium / Firefox / Safari 通吃）
3. 重启 dsh web 生效

### 导入方法

1. 找到 BT 语音素材（自己游戏内录制 / 已有音频截取）
2. 按上表存成 `lib/assets/line-1.mp3` … `line-6.mp3`（mp3 格式，任意码率均可）
3. 重启 dsh web（或桌面端）——**放几段用几段，其余槽位自动走 TTS**
4. 想全部用系统合成音：设置页 →「启动动画」→ 语音来源 → `系统 TTS 男声`

### 行为细节

- 素材在**加载时就预取**（fetch + decodeAudioData 不需要用户手势），
  第一步就能出原声，不用等第一次点击
- 每步停留时长 = max(视觉基准, 实际播报时长 + 240ms 收尾)——**原声没播完
  不会推进**，你点得快也不会把语音掐断
- 播放有 401 信任栅栏，素材只能被登录后的页面取用
- `voiceSource = 'tts'` 时完全跳过素材（不发起请求）

---

## 二、界面音效 —— 8 个槽位

| # | 槽位 | 出声时机 | 素材 | 状态 |
|---|---|---|---|---|
| 1 | `cue` | **每次念台词之前**的两声轻提示 | 合成（1046.5 + 1568 Hz） | 合成 |
| 2 | `tick` | 文字逐字渐显 | `lib/assets/sfx-tick.mp3` | ✅ 真素材 |
| 3 | `step` | 每个阶段推进 | 同上 | ✅ 真素材 |
| 4 | `confirm` | 点按钮 / 按 Enter 确认 | 同上 | ✅ 真素材 |
| 5 | `tickRun` | 自检流水开始滚动 | `lib/assets/sfx-ticks-run.mp3` | ✅ 真素材 |
| 6 | `sweep` | 黑幕 → 军用底板的洗白过场 | 合成（带通噪声扫频） | 合成 |
| 7 | `rise` | 黑幕上军徽出现 | 合成（220→990 Hz 上行） | 合成 |
| 8 | `chime` | 终幕揭幕 | 合成（三音和声钟） | 合成 |

`tick` / `step` / `confirm` 目前**共用同一个「哒」**（音量不同）。
素材缺失或 `音效来源 = 现场合成` 时，哒声回落到 WebAudio 现场合成。

---

## 三、素材目录现状

```
lib/assets/
├─ sfx-tick.mp3         2.1 KB   界面「哒」声
├─ sfx-ticks-run.mp3   10.5 KB   自检流水连续哒声
├─ (line-1.mp3)                  ← 待放入：BT 建立链接原话
├─ (line-2.mp3)                  ← 待放入：BT 神经握手原话
├─ (line-3.mp3)                  ← 待放入：BT 接收指令原话
├─ (line-4.mp3)                  ← 待放入：BT 系统自检原话
├─ (line-5.mp3)                  ← 待放入：BT "All systems nominal"
└─ (line-6.mp3)                  ← 待放入：BT 协议三原话
```

`/dsh-startup/asset/` 路由服务整个目录（白名单 + 401 栅栏），放入即生效。

---

## 四、设置项对应

| 设置项 | 槽位 |
|---|---|
| 语音播报 | 一节全部台词槽位 |
| **语音来源** | `asset` = BT 真声优先 / `tts` = 全 TTS |
| 播报语言 | 英文 / 中文 / 中英各念一遍（素材只挂英文轨；中文播报走 TTS） |
| 音色 / 语速 / 音调 / 音量 | TTS 合成参数 |
| 播报前提示音 | `cue` |
| 开口前留白 | `cue` 与台词之间的空白 |
| 界面音效 / 音效音量 | 二节全部音效槽位（不影响台词） |
| 音效来源 | `audio` = 真素材 / `synth` = 现场合成 |
