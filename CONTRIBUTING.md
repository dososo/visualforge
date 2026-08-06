# 贡献指南

感谢参与 VisualForge。

## 开始

1. 阅读 `README.md`、`SECURITY.md` 与 `PRIVACY.md`。
2. 使用 Node.js 22+、pnpm 10+ 安装依赖：`pnpm install`。
3. 修改应保持本地优先，不引入账号、云服务或未说明的数据上传。

## 提交前

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm e2e:browser
```

公开仓库默认执行 typecheck、单元测试和生产构建。涉及真实 Codex、真实网站或人物／商品素材的验收由维护者在不公开的测试环境完成。

涉及 Native Host、权限、数据迁移或捕获链时，请同时说明安全边界和回滚方式。不要提交真实人物图片、Token、本机日志、`test-results`、构建目录或浏览器 Profile。

提交 Issue 或 PR 时请包含：问题或目标、最小复现、修改范围、验证命令、已知限制。
