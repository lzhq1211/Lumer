# AGENTS.md 

- 不把占位 UI、Mock、源码存在或单节点成功报告为完整功能。
- 若触发文中任一“返回 `/plan` 条件”，停止扩展实现，先说明事实和调整计划。
- 不自动提交、推送、清理用户文件或执行破坏性 Git 操作；需要时单独请求授权。

---

## 文档职责

- `docs/ARCHITECTURE.md`：系统模块、数据流、Annot 复用边界。
- `docs/contracts/*.md`：不可违反的领域合同。
- `docs/frontend/*.md`：前端设计合同；1D 未通过不得进入 2A。
- `docs/testing/TEST_PLAN.md`：测试分层与质量门。
- `IMPLEMENTATION_PLAN.md`：编号批次顺序、每批边界、阶段门与返回 `/plan` 条件。
- `PROGRESS.md`：只记录实际实施事实，不作为产品/合同 Source of Truth。

## 冲突处理

- 先询问用户，用户回答后以用户为准。
- 数据、状态机、Evidence、Provider 合同冲突：以 `docs/contracts/` 为准。
- UI 冲突：以 `docs/frontend/` 已冻结工件为准。
- 执行先后冲突：以 `IMPLEMENTATION_PLAN.md` 为准。
