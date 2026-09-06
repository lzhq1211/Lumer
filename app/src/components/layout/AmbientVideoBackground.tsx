'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';

const HLS_SOURCE = 'https://stream.mux.com/Aa02T7oM1wH5Mk5EEVDYhbZ1ChcdhRsS2m1NYyx4Ua1g.m3u8';
const HLS_SCRIPT_SOURCE = 'https://cdn.jsdelivr.net/npm/hls.js@1.6.13/dist/hls.min.js';

interface HlsEventData {
  fatal?: boolean;
}

interface HlsInstance {
  attachMedia: (media: HTMLVideoElement) => void;
  destroy: () => void;
  loadSource: (source: string) => void;
  on: (event: string, handler: (event: string, data?: HlsEventData) => void) => void;
  startLoad: () => void;
  stopLoad: () => void;
}

interface HlsConstructor {
  Events: {
    ERROR: string;
    MANIFEST_PARSED: string;
  };
  isSupported: () => boolean;
  new (options?: Record<string, boolean | number>): HlsInstance;
}

declare global {
  interface Window {
    Hls?: HlsConstructor;
  }
}

function loadHlsScript(): Promise<HlsConstructor | null> {
  if (window.Hls) return Promise.resolve(window.Hls);

  return new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-lumer-hls]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.Hls ?? null), { once: true });
      existing.addEventListener('error', () => resolve(null), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.async = true;
    script.dataset.lumerHls = 'true';
    script.src = HLS_SCRIPT_SOURCE;
    script.addEventListener('load', () => resolve(window.Hls ?? null), { once: true });
    script.addEventListener('error', () => resolve(null), { once: true });
    document.head.appendChild(script);
  });
}

export function AmbientVideoBackground() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<HlsInstance | null>(null);
  const [mode, setMode] = useState<'static' | 'video'>('static');

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let disposed = false;
    let failed = false;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    const stopPlayback = () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
      video.pause();
      video.removeAttribute('src');
      video.load();
      if (!disposed) setMode('static');
    };

    const fallback = () => {
      if (failed || disposed) return;
      failed = true;
      stopPlayback();
    };

    const startPlayback = async () => {
      if (disposed || reducedMotion.matches || failed) return;

      video.muted = true;
      video.defaultMuted = true;

      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = HLS_SOURCE;
        try {
          await video.play();
        } catch {
          fallback();
        }
        return;
      }

      const Hls = await loadHlsScript();
      if (disposed || reducedMotion.matches || !Hls?.isSupported()) {
        if (!Hls) fallback();
        return;
      }

      const hls = new Hls({ capLevelToPlayerSize: true, maxBufferLength: 20, backBufferLength: 15 });
      hlsRef.current = hls;
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (disposed || document.hidden) return;
        void video.play().catch(() => fallback());
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data?.fatal) fallback();
      });
      hls.loadSource(HLS_SOURCE);
      hls.attachMedia(video);
    };

    const handlePlaying = () => {
      if (!disposed && !failed) setMode('video');
    };

    const handleVisibility = () => {
      if (document.hidden) {
        video.pause();
        hlsRef.current?.stopLoad();
        return;
      }
      if (!failed && !reducedMotion.matches) {
        hlsRef.current?.startLoad();
        void video.play().catch(() => fallback());
      }
    };

    const handleMotionPreference = () => {
      if (reducedMotion.matches) {
        stopPlayback();
        return;
      }
      failed = false;
      void startPlayback();
    };

    video.addEventListener('playing', handlePlaying);
    video.addEventListener('error', fallback);
    document.addEventListener('visibilitychange', handleVisibility);
    reducedMotion.addEventListener('change', handleMotionPreference);
    void startPlayback();

    return () => {
      disposed = true;
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('error', fallback);
      document.removeEventListener('visibilitychange', handleVisibility);
      reducedMotion.removeEventListener('change', handleMotionPreference);
      hlsRef.current?.destroy();
      hlsRef.current = null;
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, []);

  return (
    <div aria-hidden="true" className="lumer-ambient-background" data-mode={mode}>
      <Image
        alt=""
        className="lumer-ambient-image"
        height={1055}
        priority
        sizes="(max-width: 1280px) 1050px, 1160px"
        src="/vortex.png"
        width={1490}
      />
      <video
        autoPlay
        loop
        muted
        playsInline
        preload="none"
        ref={videoRef}
        tabIndex={-1}
      />
    </div>
  );
}
