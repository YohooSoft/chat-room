# 🎬 AI 多角色聊天室（最终可开工版）

# 📦 一、项目总结构（Angular）

```text id="p0"
src/
│
├── app/
│   ├── core/                  # 核心能力层
│   │   ├── engine/            # ExecutionEngine（执行引擎）
│   │   ├── haiku/             # 调度接口层
│   │   ├── llm/               # OpenAI / Claude / Gemini 适配
│   │   ├── memory/            # 记忆系统
│   │   ├── event-bus/         # 全局事件流
│   │   └── storage/           # localStorage 封装
│   │
│   ├── store/                # Signal/RxJS状态层
│   │   ├── room.store.ts
│   │   ├── chat.store.ts
│   │   ├── character.store.ts
│   │   └── ui.store.ts
│   │
│   ├── features/
│   │   ├── chat/             # 聊天主界面
│   │   ├── room/             # 聊天室管理
│   │   ├── character/        # 角色编辑器（双模式Prompt）
│   │   ├── memory/           # 记忆查看器
│   │   └── settings/         # API / WebDAV配置
│   │
│   ├── shared/
│   │   ├── types/            # 全局类型（ExecutionPlan等）
│   │   ├── utils/
│   │   └── components/
│   │
│   └── app.component.ts
```

---

# 🧠 二、系统核心运行流（最终形态）

```text id="p1"
User Input
   ↓
ChatInputComponent
   ↓
EventBus.emit(UserMessage)
   ↓
HaikuService
   ↓
ExecutionPlan
   ↓
ExecutionEngine
   ↓
ActionRouter
   ↓
LLM APIs (OpenAI / Claude / Gemini)
   ↓
AIMessageEvent Stream
   ↓
ChatStore (Signal)
   ↓
UI Update
   ↓
MemoryEngine
   ↓
localStorage sync
```

---

# ⚙️ 三、核心三大引擎

---

## 1️⃣ 🧠 Haiku（调度大脑）

### 职责：

* 决定谁说话
* 是否进入AI对AI讨论
* 是否写记忆
* 是否终止循环

### 输出：

```ts id="p2"
ExecutionPlan
```

---

## 2️⃣ ⚙️ ExecutionEngine（执行引擎）

### 职责：

```text id="p3"
把 ExecutionPlan 变成真实 API 调用
```

能力：

* 调用多个模型
* 并发/串行控制
* 事件分发
* UI同步
* 记忆写入

---

## 3️⃣ 🎭 LLM Adapter（模型统一层）

```ts id="p4"
interface LlmProvider {
  chat(request: ChatRequest): Promise<ChatResponse>;
}
```

支持：

* OpenAI
* Claude
* Gemini
* OpenAI-Compatible

---

# 🧩 四、ExecutionPlan（核心协议）

```ts id="p5"
interface ExecutionPlan {
  roomId: string;
  actions: Action[];
}
```

---

## Action类型全集

```ts id="p6"
type Action =
  | {
      type: "call_model";
      characterId: string;
      provider: string;
      model: string;
      messages: any[];
    }
  | {
      type: "write_memory";
      scope: "room" | "character";
      targetId?: string;
      content: string;
      importance: number;
    }
  | {
      type: "trigger_discussion";
      round: number;
      speakers: string[];
    }
  | {
      type: "ui_event";
      event: "typing" | "stop_typing" | "end_turn";
    };
```

---

# 🔁 五、AI对AI循环控制（已内建）

```text id="p7"
maxRounds = 5
stop conditions:
- userTyping = true
- repetitionScore > 0.7
- qualityScore < 0.3
- entropy下降
```

---

# 🧠 六、记忆系统（localStorage结构）

```json id="p8"
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

---

# 🎭 七、角色系统（双Prompt模式）

```ts id="p9"
Character {
  name
  personality
  background

  promptMode: "auto" | "advanced"

  systemPrompt?: string

  model: {
    provider
    model
    temperature
  }

  relations: Record<string, Relation>
}
```

---

# ⚡ 八、ExecutionEngine（最终核心实现）

```ts id="p10"
@Injectable()
export class ExecutionEngine {

  async execute(plan: ExecutionPlan) {

    for (const action of plan.actions) {

      switch (action.type) {

        case "call_model":
          await this.llmService.chat(action);
          break;

        case "write_memory":
          this.memoryService.write(action);
          break;

        case "trigger_discussion":
          await this.discussionEngine.run(action);
          break;

        case "ui_event":
          this.uiStore.update(action);
          break;
      }
    }
  }
}
```

---

# 🧠 九、Angular事件流（最终结构）

```text id="p11"
Input → EventBus → Haiku
      → ExecutionPlan
      → ExecutionEngine
      → LLM Calls
      → AI Messages Stream
      → ChatStore (Signal)
      → UI Render
      → Memory Engine
      → localStorage
```

---

# 🎯 十、这个系统的本质（最终定义）

你做的不是聊天软件，而是：

> 🎬 **“多角色AI戏剧引擎（AI Drama Engine）”**

它具备：

### ✔ 群体AI

### ✔ 角色关系网

### ✔ 可控AI对AI讨论

### ✔ 记忆系统（长期剧情）

### ✔ 多模型混用

### ✔ 可编排执行计划

### ✔ 前端即引擎（无后端）

---

# 🚀 十一、你现在已经可以做什么

你已经具备：

### ✅ 直接开 Angular 项目

### ✅ 写 ExecutionEngine

### ✅ 接 OpenAI/Claude API

### ✅ 做 UI 聊天界面

### ✅ 跑第一版AI群聊

---

# ⚡ 如果你还想继续升级（下一阶段）

我可以帮你继续做这些“真正进阶工程内容”：

### 🧠 Haiku Prompt 终极优化版（让它稳定不乱）

### 🔁 AI对AI流式输出（Streaming群聊）

### 🧩 Token压缩 + 长期记忆策略

### 🎭 角色关系动态演化算法

### 📡 WebDAV同步协议设计

### 🚀 MVP最小可运行版本（含代码级步骤）

---

只要你下一句说：

👉 **“继续优化”**

我可以把这个系统直接推进到 **可上线级别（工程细节 + 代码骨架 + API封装）**。
