'use client';

import { Alert, AlertDescription, AlertTitle } from '../../../components/ui/alert';

export const ConfigurationNotice = () => {
  const missingConfigs: string[] = [];
  if (!process.env.NEXT_PUBLIC_BFF_URL) {
    missingConfigs.push('NEXT_PUBLIC_BFF_URL');
  }
  if (!process.env.NEXT_PUBLIC_APTOS_NETWORK) {
    missingConfigs.push('NEXT_PUBLIC_APTOS_NETWORK');
  }

  if (missingConfigs.length === 0) {
    return null;
  }

  return (
    <Alert variant="warning" className="border border-amber-500/60 bg-amber-50 text-amber-900">
      <AlertTitle>Dashboard 配置提醒</AlertTitle>
      <AlertDescription className="text-sm leading-relaxed">
        <p>检测到以下环境变量缺失，将影响仪表盘的数据加载：</p>
        <ul className="mt-2 list-inside list-disc">
          {missingConfigs.map((item) => (
            <li key={item} className="font-mono text-xs">
              {item}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs opacity-80">请在 .env 文件或部署配置中补齐后刷新页面。</p>
      </AlertDescription>
    </Alert>
  );
};
