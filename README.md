# Poker Online - Texas Hold'em (Play Money)

> 纯娱乐筹码版本，不包含任何真实货币、支付或博彩功能。

## 功能概览
- 2-8 人同桌 + 观战者。
- 服务端权威：洗牌、发牌、行动、计时器、底池、结算都在后端。
- Socket.IO 实时同步，客户端只发送意图（fold/check/call/bet/raise/all-in）。
- 断线重连：`playerToken` 存在 localStorage，重连后恢复身份（同 token 不可重复占座）。
- 视角裁剪：只给自己手牌；非摊牌阶段不泄露他人手牌。
- 最小侧池实现（按 contribution 分层结算）。
- 生产单端口：`pnpm build && pnpm start` 后仅暴露 3000，便于 ngrok/cloudflared 穿透。

---

## 项目结构

```txt
/poker-online
  /apps
    /server      # Express + Socket.IO + 游戏状态机
    /web         # React + Vite 前端
  /packages
    /shared      # 共享类型、牌组与牌型评估器
  .env.example
  README.md
```

---

## 环境要求
- Node.js 20+
- pnpm 9+

```bash
corepack enable
corepack prepare pnpm@9.12.0 --activate
```

---

## 从零启动（开发模式）

1) 安装依赖
```bash
pnpm i
```

2) 复制环境变量
```bash
cp .env.example .env
```

3) 一条命令启动前后端
```bash
pnpm dev
```
- 前端默认: http://localhost:5173
- 后端默认: http://localhost:3000
- Vite 代理 `/socket.io` 到后端，WebSocket 可直接联通。

---

## 生产模式（单端口）

```bash
pnpm build
pnpm start
```

- 后端会托管 `apps/web/dist` 静态文件。
- 访问：http://localhost:3000
- 公网穿透时只需映射 3000 端口。

---

## 环境变量说明
见 `.env.example`：
- `PORT`：服务端监听端口（默认 3000）
- `CORS_ORIGIN`：可选，限制跨域来源
- `ACTION_TIMEOUT_SECONDS`：每次行动倒计时
- `ROOM_PERSIST_PATH`：房间/玩家 token 的最小持久化文件
- `RATE_LIMIT_*`：Socket 连接级简单限流

---

## 测试与质量

```bash
pnpm test
pnpm lint
pnpm format
```

已覆盖：
- Hand evaluator：皇家同花顺、A2345 轮子顺子。
- 状态机用例：
  - preflop -> flop
  - raise 更新 currentBet/minRaise
  - 全流程到 showdown/hand_end 并回 lobby

---

## 公网访问 A：ngrok（优先）

### 1) 安装 ngrok

macOS (Homebrew):
```bash
brew install ngrok/ngrok/ngrok
```

Windows (winget):
```powershell
winget install ngrok.ngrok
```

Linux (snap):
```bash
sudo snap install ngrok
```

### 2) 配置 authtoken
在 https://dashboard.ngrok.com/get-started/your-authtoken 获取 token：

```bash
ngrok config add-authtoken <YOUR_TOKEN>
```

### 3) 启动本地服务（生产单端口）
```bash
pnpm build && pnpm start
```

### 4) 启动隧道
```bash
ngrok http 3000
```

复制 ngrok 输出中的 `https://xxxx.ngrok-free.app` 发给朋友。

### 5) WebSocket 注意事项（关键）
- 不要在前端硬编码 `ws://localhost`。
- 本项目默认 `socket.io-client` 使用 `window.location.origin`（生产）或 `VITE_SERVER_URL`（开发）。
- 通过 ngrok 访问时，前后端同源，Socket.IO 会自动升级到 WebSocket。

验证：
- 两个不同网络设备同时打开 ngrok URL；
- 创建/加入同一房间；
- 任一端行动，另一端应实时更新。

---

## 公网访问 B：Cloudflare Tunnel（备选）

### 1) 安装 cloudflared
macOS:
```bash
brew install cloudflared
```

Windows:
```powershell
winget install Cloudflare.cloudflared
```

Linux:
```bash
# Debian/Ubuntu 示例
sudo apt-get update && sudo apt-get install cloudflared
```

### 2) 登录 Cloudflare
```bash
cloudflared tunnel login
```

### 3) 创建 tunnel
```bash
cloudflared tunnel create poker-online
```

### 4) 配置 ingress（示例）
创建 `~/.cloudflared/config.yml`：

```yaml
tunnel: poker-online
credentials-file: /path/to/credentials.json
ingress:
  - hostname: poker.your-domain.com
    service: http://localhost:3000
  - service: http_status:404
```

### 5) DNS 路由并运行
```bash
cloudflared tunnel route dns poker-online poker.your-domain.com
pnpm build && pnpm start
cloudflared tunnel run poker-online
```

把 `https://poker.your-domain.com` 发给朋友即可。

---

## 常见坑位（请务必看）
1) **CORS**：跨域开发时设置 `CORS_ORIGIN`；生产建议同域避免复杂配置。  
2) **Socket.IO 路径**：默认 `/socket.io`，反代必须允许 WS upgrade。  
3) **信任代理**：开启了 `app.set('trust proxy', 1)`，便于反代后识别真实来源。  
4) **HTTPS + Cookie**：公网建议 HTTPS；本项目主要通过 localStorage token 重连，不依赖 secure cookie。  
5) **不要泄露手牌**：服务端 snapshot 已按 viewer 裁剪；请勿在前端缓存全部状态。  
6) **房间恢复限制**：当前持久化仅恢复房间与 token 映射，进行中牌局重启后需要重新开始。  

---

## Docker（可选）

```bash
docker compose up --build
```

访问 `http://localhost:3000`。

