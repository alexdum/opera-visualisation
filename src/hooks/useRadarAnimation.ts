import { useCallback, useEffect, useState } from "react";

interface UseRadarAnimationProps {
  frameCount: number;
  currentTimeIndex: number;
  setCurrentTimeIndex: (idx: number | ((prev: number) => number)) => void;
  canAdvance: boolean;
}

export function useRadarAnimation({
  frameCount,
  currentTimeIndex,
  setCurrentTimeIndex,
  canAdvance,
}: UseRadarAnimationProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(true);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") setIsPlaying(false);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = (event: MediaQueryListEvent) => {
      if (event.matches) setIsPlaying(false);
    };
    if (mediaQuery.matches) setIsPlaying(false);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  // Schedule the next frame only after MapLibre has finished (or explicitly
  // degraded) the current frame. This prevents fast playback outrunning tiles.
  useEffect(() => {
    if (!isPlaying || !canAdvance || frameCount === 0) return;
    const timer = window.setTimeout(() => {
      if (currentTimeIndex >= frameCount - 1) {
        if (loop) setCurrentTimeIndex(0);
        else setIsPlaying(false);
      } else {
        setCurrentTimeIndex(currentTimeIndex + 1);
      }
    }, 800 / speed);
    return () => window.clearTimeout(timer);
  }, [canAdvance, currentTimeIndex, frameCount, isPlaying, loop, setCurrentTimeIndex, speed]);

  const stepForward = useCallback(() => {
    setIsPlaying(false);
    if (frameCount === 0) return;
    setCurrentTimeIndex((previous) => (previous >= frameCount - 1 ? 0 : previous + 1));
  }, [frameCount, setCurrentTimeIndex]);

  const stepBackward = useCallback(() => {
    setIsPlaying(false);
    if (frameCount === 0) return;
    setCurrentTimeIndex((previous) => (previous <= 0 ? frameCount - 1 : previous - 1));
  }, [frameCount, setCurrentTimeIndex]);

  return {
    isPlaying,
    setIsPlaying,
    speed,
    setSpeed,
    loop,
    setLoop,
    stepForward,
    stepBackward,
  };
}
