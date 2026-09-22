#!/bin/bash
# 双击即可把 open-director 部署到 Cloudflare Pages（应急手动通道）
# 如果登录过期，wrangler 会自动弹浏览器让你点一次"允许"
cd "$(dirname "$0")"
npm run build && npx wrangler pages deploy dist --project-name=open-director --commit-dirty=true
echo ""
read -p "部署结束，按回车关闭窗口"
