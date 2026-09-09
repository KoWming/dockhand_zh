<div align="center">

# Dockhand 中文汉化项目 (dockhand_zh)

基于 Svelte 5 AST 模板语法树与 TypeScript 语义分析引擎构建的 **Dockhand 全流程非侵入式中文化流水线**。

零侵入修改上游代码 · 词典与定点补丁驱动 · 自动化构建与多架构 Docker 镜像分发

[![GitHub Release](https://img.shields.io/github/v/release/Finsys/dockhand?label=Upstream%20Version&color=blue)](https://github.com/Finsys/dockhand)
[![Docker Image](https://img.shields.io/badge/Docker-kowming%2Fdockhand%3Azh-2496ED?logo=docker&logoColor=white)](https://hub.docker.com/r/kowming/dockhand)
[![License](https://img.shields.io/badge/License-BUSL--1.1-green.svg)](LICENSE.txt)

</div>

---

## 📖 项目简介

[Dockhand](https://github.com/Finsys/dockhand) 是一款轻量、现代、优雅的 Docker 与容器管理面板（技术栈基于 SvelteKit 2、Svelte 5 Runes 与 TailwindCSS 4）。由于官方原版仅提供英文界面，且文案高度分散在组件、动态计算表达式与后端服务中，本项目通过**非侵入式编译期重构**与**抽象语法树（AST）双引擎分析**，实现了全系统的 100% 完整中文化。

### 核心特性

- **非侵入式流水线**：上游 `Finsys/dockhand` 源码保持 100% 只读，不改动任何原版代码分支。
- **语法树（AST）双引擎精准匹配**：
  - **Svelte 模板 AST 层**：精准提取真实静态 `Text` 展示节点与白名单属性（`title`、`placeholder`、`aria-label`、`label`、`description` 等），严格杜绝样式和代码属性误伤；
  - **TypeScript 语义 AST 层**：智能捕获 `toast.*`、`notify`、`alert`、`confirm` 交互实参及 UI 展示对象字段，彻底杜绝键名、按键与代码标识符污染。
- **全方位术语规范**：严格遵循行业中文技术标准（例如将存储术语统一规范为 **“存储卷”**、网络驱动对齐国际标准）。
- **完善的定点补丁生态**：包含多级二次确认气泡弹窗语法重塑、相对时间动态汉化、TailwindCSS 4 单文件扫描清单生成及 Dockerfile 跨平台构建适配。
- **全自动化 CI/CD**：配套 GitHub Actions 工作流，定时向上游拉取最新版本代码，自动执行汉化、编译并发布多架构（`linux/amd64`、`linux/arm64`）Docker 镜像至 Docker Hub（标签固定为 `kowming/dockhand:zh`）。

---

## 🚀 快速上手 (使用 Docker 部署)

### 方式一：直接运行 Docker 容器 (推荐)

```bash
docker run -d \
  --name dockhand \
  -p 3000:3000 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v dockhand-data:/app/data \
  --restart unless-stopped \
  kowming/dockhand:zh
```

### 方式二：使用 Docker Compose

创建 `docker-compose.yml` 文件：

```yaml
services:
  dockhand:
    image: kowming/dockhand:zh
    container_name: dockhand
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - dockhand-data:/app/data

volumes:
  dockhand-data:
```

运行启动：

```bash
docker compose up -d
```

启动完成后，在浏览器中访问 **http://localhost:3000** 即可体验完整中文界面的 Dockhand。

---

## 📊 汉化完成度概览

全库包含 **24 个页面/业务模块词典**，共计 **4,175 条词条**，已实现 **100.0% 完全覆盖**：

| 模块名称 | 总词条数 | 已汉化 | 覆盖率 | 说明 |
| :--- | :---: | :---: | :---: | :--- |
| **设置页** | 1,445 | 1,445 | **100.0%** | 常规设置、环境、通知通道、认证与 SSO、备份仓库等 |
| **容器页** | 638 | 638 | **100.0%** | 容器创建、编辑、终端、日志、资源限制与健康检查 |
| **堆栈页** | 434 | 434 | **100.0%** | 应用栈管理、Git 部署、Compose 编辑器、依赖拓扑图 |
| **共享组件** | 388 | 388 | **100.0%** | 全局顶部导航、主题切换、时间与指标气泡提示 |
| **网络页** | 149 | 149 | **100.0%** | 网络拓扑、驱动模式与子网配置 |
| **镜像页** | 139 | 139 | **100.0%** | 镜像列表、漏洞扫描、层分析与 Tar 归档加载 |
| **备份页** | 105 | 105 | **100.0%** | 存储库管理、数据快照与灾难恢复 |
| **存储卷页** | 94 | 94 | **100.0%** | 存储卷浏览、克隆、扩容与挂载 |
| **lib其他** | 87 | 87 | **100.0%** | 步骤状态机（拉取/构建/启动中）、SSH 与通用校验 |
| **计划任务页** | 86 | 86 | **100.0%** | 自动更新、定时清理与相对时间显示 |
| **日志页** | 85 | 85 | **100.0%** | 实时流式日志、多容器日志合并与过滤 |
| **个人资料页** | 84 | 84 | **100.0%** | 个人安全、API 访问令牌生成 |
| **审计页** | 76 | 76 | **100.0%** | 企业级审计日志与操作追溯 |
| **仪表盘** | 56 | 56 | **100.0%** | 宿主机资源分析、存储卷分布与环境卡片 |
| **镜像仓库页** | 55 | 55 | **100.0%** | 镜像仓库搜索、拉取与推送 |
| **活动页** | 54 | 54 | **100.0%** | Docker 实时事件追踪 |
| **环境页** | 40 | 40 | **100.0%** | 本机与远程 Hawser 代理连接配置 |
| **通用页** | 37 | 37 | **100.0%** | 导航与通用操作 |
| **终端页** | 37 | 37 | **100.0%** | 容器终端、Shell 自适应侦测 |
| **模板页** | 36 | 36 | **100.0%** | 预置模板库与校验 |
| **登录页** | 23 | 23 | **100.0%** | 登录、首个管理员初始化引导 |
| **基础组件** | 20 | 20 | **100.0%** | 全局空态提示组件、弹窗按钮基础交互 |
| **告警页** | 5 | 5 | **100.0%** | 告警规则 |
| **监控页** | 2 | 2 | **100.0%** | 基础视图 |
| **汇总合计** | **4,175** | **4,175** | **100.0%** | **全界面综合命中覆盖率达 97.8% (5,065/5,181 处)** |

---

## 🛠️ 本地开发与流水线使用

如果你希望在本地克隆代码、调整词典或本地构建镜像，可使用以下指令：

### 1. 准备环境

确保本机已安装 Node.js 22+ 与 Docker：

```bash
git clone https://github.com/KoWming/dockhand_zh.git
cd dockhand_zh
npm install
```

### 2. 常用开发指令

```bash
# 扫描上游代码中所有的可见 UI 文案生成基准快照
npm run scan:fe

# 查看当前汉化统计覆盖率面板
npm run stats

# 执行汉化流水线 (将词典与定点补丁应用至产物 output/ 目录)
npm run apply

# 执行 TypeScript 严格类型检查
npm run check
```

### 3. 本地构建生产产物

在执行 `npm run apply` 后，汉化产物将自动生成到 `output/` 目录中：

```bash
cd output

# 方式一：直接在本地启动测试
npm run build
node build

# 方式二：本地打包为 Docker 镜像
docker build -t kowming/dockhand:zh .
```

---

## ⚙️ 自动化 CI/CD 配置 (GitHub Actions)

本项目内置完整的 GitHub Actions 工作流（`.github/workflows/build-and-push.yml`），支持全自动化追踪上游更新与构建推送：

### 必须配置的 GitHub Secrets

在你的 GitHub 仓库中（`Settings` → `Secrets and variables` → `Actions`）添加以下两个密钥：

- **`DOCKERHUB_USERNAME`**：你的 Docker Hub 登录用户名
- **`DOCKERHUB_PASSWORD`**（或 `DOCKERHUB_TOKEN`）：你的 Docker Hub 登录密码或访问令牌

配置完成后，当推送修改到 `main` 分支或在 GitHub 网页端手动触发工作流时，GitHub Actions 会自动编译多架构镜像并发布到 Docker Hub（标签为 `kowming/dockhand:zh`）。

---

## ⚠️ 声明与免责

- **开源协议**：上游开源项目版权归 [Finsys/dockhand](https://github.com/Finsys/dockhand) 所有 (基于 BUSL-1.1 协议开源)。
- **AI 辅助声明**：**本项目由 AI 辅助完成，部分汉化内容语意可能不够准确。** 若你在使用过程中发现翻译生硬、错漏或有更好的表达建议，非常欢迎提交 Issue 或 Pull Request 协助改进！
- **免责声明**：本项目仅作为个人及社区学习研究交流使用，维护者不对软件运行过程中的任何直接或间接损失承担责任。
- 汉化维护者：[KoWming](https://github.com/KoWming)
