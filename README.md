# AI 多角色聊天室（ChatRoom / AI Drama Engine）

一个基于 Angular 的前端多角色 AI 聊天室原型，用 Haiku 调度生成 ExecutionPlan，再由 ExecutionEngine 执行模型调用、讨论与记忆写入。当前版本聚焦于运行流与核心引擎骨架，便于继续扩展成完整产品。

English: A front-end multi-character AI chatroom prototype built with Angular.

## 当前实现

- 多角色聊天基础流：用户输入 → Haiku 调度 → ExecutionPlan → ExecutionEngine
- 讨论引擎（DiscussionEngine）支持按轮次触发多角色发言
- LLM Provider 统一接口（当前为 Mock Provider，便于替换真实 API）
- 记忆系统：写入 localStorage，按房间/角色分组
- 默认房间与角色（导演 AI / 评论家 AI）
- 角色/房间/记忆/设置页面为占位界面，便于后续补齐

## 快速开始

```bash
npm install
npm start
```

启动后访问：`http://localhost:4200/`

## 常用脚本

```bash
npm run build
npm test -- --watch=false --browsers=ChromeHeadless
npm run watch
```

## 架构与运行流

```text
User Input
   ↓
ChatComponent
   ↓
EventBus.emit(UserMessage)
   ↓
HaikuService
   ↓
ExecutionPlan
   ↓
ExecutionEngine
   ↓
LLM Provider / DiscussionEngine / MemoryService
   ↓
ChatStore → UI Render → localStorage
```

## 目录结构（核心）

```text
src/app/
├── core/
│   ├── engine/        # ExecutionEngine + Orchestrator
│   ├── haiku/         # 调度器，生成 ExecutionPlan
│   ├── llm/           # Provider 统一适配层
│   ├── discussion/    # 多轮讨论引擎
│   ├── memory/        # 记忆写入
│   ├── event-bus/     # 事件总线
│   └── storage/       # localStorage 封装
├── store/             # Signal 状态层（room/chat/character/ui）
├── features/          # Chat/Room/Character/Memory/Settings 页面
└── shared/            # 类型与工具函数
```

## 核心协议（简化）

- **ExecutionPlan**：`{ roomId, actions[] }`
- **Action 类型**：
  - `call_model`：调用指定 Provider 与 Model
  - `write_memory`：写入记忆（room/character）
  - `trigger_discussion`：触发讨论轮次
  - `ui_event`：控制 UI 状态（typing/end_turn）

## 数据存储（localStorage）

默认使用 `ai-drama-engine` 作为 key（与 “AI Drama Engine” 命名一致），结构如下：

```json
{
  "rooms": {},
  "characters": {},
  "messages": {},
  "memories": {
    "room": {},
    "character": {}
  },
  "user": {
    "name": "",
    "profile": {},
    "preferences": {}
  }
}
```

## 调试与可视化约定

- **Haiku 的操作记录仅输出在浏览器调试（DevTools/Console）中，不会进入消息流，也不会在页面 UI 显示。**
- UI 只渲染用户与 AI 的对话消息，不展示系统内部动作细节。

## 设计蓝图

更完整的设计规划与目标形态见：`README.blueprint.md`。
