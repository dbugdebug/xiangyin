# 协作指南

## 1. 权限和信任

所有协作者都通过 GitHub 账号和 Git 记录识别。仓库 owner 可在 GitHub Settings → Collaborators and teams 邀请成员：

- Write：可以推送自己的分支并创建 PR；适合日常开发者。
- Maintain/Admin：管理仓库设置或成员，仅授予负责维护仓库的人。
- 不建议给普通协作者直接写入 master 的通道。即使是信任的同学，也使用分支 + PR，方便检查和回滚。
- 不要共享个人账号、PAT、Cloudflare token、Supabase service role 或数据库密码。信任通过 GitHub 权限授予，不通过共享密钥实现。

## 2. 日常分支与 PR 流程

从最新主分支创建一个短期分支：

    git checkout master
    git pull --ff-only
    git checkout -b feat/简短功能名

分支命名建议：feat/功能、fix/问题、docs/文档、refactor/范围。完成后检查并提交：

    git status
    git diff --check
    git add <本次相关文件>
    git commit -m "feat: 简述改动"
    git push -u origin feat/简短功能名

然后在 GitHub 创建 Pull Request，目标分支选 master。PR 描述写清楚目的、主要改动、手动验证步骤、是否需要改 Supabase secrets/Pages 环境变量/数据库迁移。关联问题或截图按需附上。至少一名维护者 review 并通过后再合并；合并后删除已合并分支。

推荐提交前缀：feat 新功能、fix 修复、docs 文档、refactor 重构、chore 工程维护。

## 3. 建议的 GitHub 主分支设置

仓库 Settings → Branches（或 Rules → Rulesets）为 master 建立规则：

1. 要求通过 Pull Request 才能合并。
2. 要求至少 1 人审批；小团队也可由另一位协作者检查关键改动。
3. 新提交导致审批过期时，要求重新审批。
4. 要求分支与 master 最新状态一致后再合并。
5. 限制强制推送和删除主分支。
6. 若配置 CI，再要求构建检查通过后合并。

GitHub 计划提供的规则选项会随仓库类型变化；若当前计划没有审批规则，可约定由维护者在 PR 页面检查后手动合并，并保持主分支不直接推送。

## 4. 项目约定

- 唯一前端源码在 frontend/；唯一 Supabase 数据库迁移在 supabase/；Worker API 源码在 deploy/。不要复制源码或新建第二套工作目录。
- 数据库结构沿用现有表；新增或修改表必须提交独立 migration，说明兼容与回滚方案并经维护者 review。
- API 保持现有 /api/... 路径及响应兼容；前后端变更放在同一个 PR 或明确标注依赖顺序。
- 不提交 .env、.env.local、令牌、私钥、用户手机号、真实健康记录、音频或数据库导出。
- PR 中禁止提交 node_modules/、dist/、虚拟环境、Wrangler 缓存、编译缓存和生成的依赖文件。

## 5. 角色职责

- 前端：frontend/src，按 [前端开发说明](docs/前端同学开发说明.md) 开发。
- 后端：主线 API 在 deploy/，按 [后端开发说明](docs/后端同学开发说明.md) 开发；Supabase 负责数据库。
- 算法：通过后端 adapter 接入，按 [算法开发说明](docs/算法同学开发说明.md) 开发。
- 整体接口和数据约束见 [项目架构文档](docs/项目整体架构与团队开发文档.md)。
