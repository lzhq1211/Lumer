'use client';

import { MonitorUp } from 'lucide-react';
import { useEffect, useState } from 'react';

const MINIMUM_WIDTH = 1280;

export function ViewportGuard() {
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const updateWidth = () => setWidth(window.innerWidth);
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  if (width === null || width >= MINIMUM_WIDTH) {
    return null;
  }

  return (
    <div className="lumer-viewport-blocker" role="alertdialog" aria-modal="true" aria-labelledby="viewport-title">
      <div className="lumer-viewport-card">
        <span className="lumer-viewport-icon"><MonitorUp aria-hidden="true" size={26} strokeWidth={1.75} /></span>
        <h1 id="viewport-title">窗口宽度不足</h1>
        <p>Lumer V1 使用完整桌面布局，不会隐藏阅读或证据区域。</p>
        <dl>
          <div><dt>当前宽度</dt><dd>{width}px</dd></div>
          <div><dt>最低要求</dt><dd>{MINIMUM_WIDTH}px</dd></div>
        </dl>
        <p className="lumer-supporting">请放大窗口后继续。</p>
      </div>
    </div>
  );
}
