# ASKme 公网部署说明

## 推荐方式：Render Web Service

1. 把本项目上传到 GitHub 仓库。
2. 在 Render 新建 Web Service，连接这个仓库。
3. Render 会读取 `render.yaml`，创建 Node Web Service。
4. 设置环境变量：
   - `OWNER_PASSWORD`: 主人密钥
   - `DATA_FILE`: `/tmp/askme/questions.json`
   - `RETENTION_DAYS`: `3`
5. 部署完成后，Render 会提供公网地址，例如 `https://askme-private-box.onrender.com`。

## 访问地址

- 用户页面：`https://你的域名/`
- 主人入口：`https://你的域名/owner`

## 重要提醒

本项目默认只保留最近 3 天的问题，超过 3 天会自动清理。

Render 免费实例的文件系统可能随重启或重新部署丢失数据，因此它适合轻量临时提问箱。如果需要保证“至少保留满 3 天”，请改用 persistent disk 或数据库。
