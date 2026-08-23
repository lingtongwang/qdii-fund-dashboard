# Global Agent Workflow Rules

## Professional Git Commit & Merge Policy (软件工程最佳实践规范)

1. **已验证的原子性提交 (Verified & Atomic Commits Only)**:
   - **禁止无意义碎片提交**：严禁对未完成的代码、语法报错的半成品、或无独立功能意义的微小调整（如单字微调、临时测试打印）单独进行提交。
   - **闭环验证原则**：只有当一个明确的功能单元、已验证的 Bug 修复、或成套的重构/视觉调整**完成且自测通过**后，才执行 Git 提交。
   - 每次提交必须保证代码库处于**可正常构建与运行（Working State）**的状态。

2. **压缩合并与整洁历史 (Squash & Consolidate Strategy)**:
   - **减少提交噪点**：在多轮调试、试错或多步骤的复杂任务闭环后，若产生过度碎片化的中间状态，优先采用压缩合并（Squash / Amend）将相关微小变更归拢为一个高内聚、高质量的提交记录。
   - **主干历史清晰**：保持 Git 提交历史（Log）精炼可读，确保每一个 Commit 都有明确的业务或工程价值。

3. **标准语义化提交信息 (Conventional Commits)**:
   - 必须使用标准 Conventional Commits 格式，清晰标明作用域与实质变更：
     - : 完整的新功能或新特性
     - : 已验证的 Bug 修复或缺陷解决
     - : UI 视觉、排版、CSS 调整
     - : 结构重构或代码质量优化
     - : 配置、依赖、工作流或构建脚本更新
     - : 文档更新与技术说明

4. **可回滚性与自包含 (Self-contained & Rollback-ready)**:
   - 每个提交必须是自包含的逻辑单元，方便用户在需要时通过  / Your branch is up to date with 'origin/main'. 进行干净利落的定点回滚。
   - 涉及子模块（Git Submodule）时，优先提交子模块变更，再在主仓库提交子模块引用的更新。
