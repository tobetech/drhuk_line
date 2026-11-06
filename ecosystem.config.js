module.exports = {
  apps: [
    {
      name: 'drhuk-line',
      script: 'index.js',
      instances: 1,
      autorestart: true,
      max_memory_restart: '200M',
      env: { NODE_ENV: 'production' }, // PORT และคีย์ LINE อ่านจากไฟล์ .env
    },
  ],
};
