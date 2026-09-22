import { useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

/**
 * 锁屏/唤醒后强制主 webview 重新布局。
 * macOS 锁屏时显示器重配置，解锁后窗口 frame 不变但 WKWebView layer
 * 保留锁屏前的小尺寸（内容缩到左上角）。
 * 触发两个事件：visibilitychange → visible（锁屏/解锁必触发），以及
 * window focus（应用在锁屏期间保持焦点时 visibilitychange 可能不触发，
 * 解锁后用户点回应用时 focus 必触发）。双重触发无害（幂等 setFrame）。
 */
export function useScreenWakeRelayout() {
  useEffect(() => {
    const trigger = () => {
      console.debug(
        '[relayout] trigger',
        document.visibilityState,
        window.innerWidth,
        window.innerHeight,
        window.devicePixelRatio
      );
      invoke('relayout_main_webview').catch((e) =>
        console.warn('[relayout] failed', e)
      );
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') trigger();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', trigger);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', trigger);
    };
  }, []);
}
