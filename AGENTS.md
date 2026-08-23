# Global Agent Workflow Rules

## Mandatory Git Commit Policy (最高优先级执行纪律)

1. **自动提交原则 (Always Commit After Changes)**:
   - 凡是在包含 Git 版本控制的项目中进行了任何文件的新增、修改、重构或删除，**在完成任务、回复用户之前，必须主动执行 `git add` 和 `git commit`**。
   - 绝对不允许在修改代码后留有未提交（dirty working tree）的工作区。

2. **提交信息规范 (Conventional Commits)**:
   - 必须使用标准 Conventional Commits 格式，附带清晰具体的变更说明：
     - `feat(...)`: 新功能或新特性
     - `fix(...)`: Bug 修复或缺陷解决
     - `style(...)`: UI 视觉、排版、CSS 调整
     - `refactor(...)`: 代码重构或架构调整
     - `chore(...)`: 配置、依赖或构建更新
     - `docs(...)`: 文档更新

3. **原子性与可回滚性 (Clean & Atomic)**:
   - 保证每次提交都是自包含且可独立回滚的，以便用户在需要时随时通过 `git checkout` / `git revert` 恢复历史版本。
   - 如果项目中包含 Git Submodule，优先提交子模块变更，再提交主仓库的子模块引用更新。
