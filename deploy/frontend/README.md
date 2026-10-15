# 乡音心伴前端

线上部署步骤见仓库根目录 [`DEPLOY.md`](../../DEPLOY.md)。此目录是独立 Vite/React Pages 项目。

```sh
cp .env.production.example .env.local
npm ci
npm run dev
```

部署默认使用演示验证码：输入任意非空验证码即可登录，账号和业务资料保存在共享数据库。演示模式不验证手机号归属。
