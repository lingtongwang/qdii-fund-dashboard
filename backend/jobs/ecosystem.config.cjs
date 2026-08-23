// pm2 守护配置：让 API 服务 + 定时任务常驻、崩溃自动重启、开机自启。
// 用法（在本机 backend 目录，需先 npm i -g pm2）：
//   pm2 start jobs/ecosystem.config.cjs
//   pm2 save                # 保存进程列表（重启后 pm2 resurrect 恢复）
//   pm2 startup             # 生成开机自启（macOS=launchd / Linux=systemd）
// 查看：pm2 logs / pm2 monit
module.exports = {
  apps: [
    {
      name: 'fund-dashboard-server',
      cwd: __dirname + '/..',
      script: 'api/server.js',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      env: { PORT: 3000, TZ: 'Asia/Shanghai' },
      error_file: 'logs/server-err.log',
      out_file: 'logs/server-out.log',
    },
    {
      name: 'fund-dashboard-scheduler',
      cwd: __dirname + '/..',
      script: 'jobs/scheduler.js',
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      env: { TZ: 'Asia/Shanghai' },
      error_file: 'logs/scheduler-err.log',
      out_file: 'logs/scheduler-out.log',
    },
  ],
};
