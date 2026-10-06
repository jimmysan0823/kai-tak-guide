import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // 港鐵官方車費表
      '/api/mtr-fares': {
        target: 'https://opendata.mtr.com.hk',
        changeOrigin: true,
        rewrite: () => '/data/mtr_lines_fares.csv',
      },
      // 港鐵屯馬綫實時班次
      '/api/mtr-schedule': {
        target: 'https://rt.data.gov.hk',
        changeOrigin: true,
        rewrite: (p) => p.replace('/api/mtr-schedule', '/v1/transport/mtr/getSchedule.php'),
      },
      // 九巴實時到站
      '/api/kmb': {
        target: 'https://data.etabus.gov.hk',
        changeOrigin: true,
        rewrite: (p) => p.replace('/api/kmb', '/v1/transport/kmb'),
      },
      // 城巴實時到站
      '/api/ctb': {
        target: 'https://rt.data.gov.hk',
        changeOrigin: true,
        rewrite: (p) => p.replace('/api/ctb', '/v2/transport/citybus'),
      },

      // 專線小巴實時到站
      '/api/gmb': {
        target: 'https://data.etagmb.gov.hk',
        changeOrigin: true,
        rewrite: (p) => p.replace('/api/gmb', ''),
      },
    },
  },
});