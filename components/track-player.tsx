"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type TrackPlayerProps = {
  label: string;
  url: string;
};

const BAR_COUNT = 56;

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");

  return `${minutes}:${remainingSeconds}`;
}

function buildWaveformData(channelData: Float32Array) {
  const blockSize = Math.max(1, Math.floor(channelData.length / BAR_COUNT));
  const bars: number[] = [];

  for (let barIndex = 0; barIndex < BAR_COUNT; barIndex += 1) {
    const start = barIndex * blockSize;
    const end = Math.min(channelData.length, start + blockSize);
    let peak = 0;

    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
      const amplitude = Math.abs(channelData[sampleIndex] ?? 0);
      if (amplitude > peak) {
        peak = amplitude;
      }
    }

    bars.push(Math.max(0.12, Math.min(1, peak)));
  }

  return bars;
}

export function TrackPlayer({ label, url }: TrackPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const waveformRef = useRef<HTMLDivElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [waveform, setWaveform] = useState<number[]>([]);

  useEffect(() => {
    const audio = new Audio(url);
    audio.preload = "metadata";
    audioRef.current = audio;

    const onLoadedMetadata = () => setDuration(audio.duration || 0);
    const onEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };
    const onPause = () => setIsPlaying(false);

    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("pause", onPause);

    return () => {
      if (animationFrameRef.current) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      audio.pause();
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("pause", onPause);
      audioRef.current = null;
    };
  }, [url]);

  useEffect(() => {
    let cancelled = false;

    async function loadWaveform() {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          return;
        }

        const arrayBuffer = await response.arrayBuffer();
        const AudioContextClass = window.AudioContext || (window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        }).webkitAudioContext;

        if (!AudioContextClass) {
          return;
        }

        const audioContext = new AudioContextClass();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
        const waveformData = buildWaveformData(audioBuffer.getChannelData(0));
        await audioContext.close();

        if (!cancelled) {
          setWaveform(waveformData);
        }
      } catch {
        return;
      }
    }

    void loadWaveform();

    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    if (!isPlaying) {
      if (animationFrameRef.current) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    const tick = () => {
      const audio = audioRef.current;
      if (!audio) {
        return;
      }
      setCurrentTime(audio.currentTime);
      animationFrameRef.current = window.requestAnimationFrame(tick);
    };

    animationFrameRef.current = window.requestAnimationFrame(tick);

    return () => {
      if (animationFrameRef.current) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isPlaying]);

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (isPlaying) {
      audio.pause();
      audio.currentTime = 0;
      setCurrentTime(0);
      setIsPlaying(false);
      return;
    }

    await audio.play();
    setIsPlaying(true);
  }

  function handleWaveformClick(event: React.MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    const waveformElement = waveformRef.current;

    if (!audio || !waveformElement || duration <= 0) {
      return;
    }

    const bounds = waveformElement.getBoundingClientRect();
    const relativeX = event.clientX - bounds.left;
    const ratio = Math.min(1, Math.max(0, relativeX / bounds.width));
    const nextTime = ratio * duration;

    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  }

  const progress = duration > 0 ? currentTime / duration : 0;
  const bars = useMemo(
    () =>
      waveform.length
        ? waveform
        : Array.from({ length: BAR_COUNT }, (_, index) => 0.18 + ((index % 5) * 0.05)),
    [waveform],
  );

  return (
    <div className="track-player">
      <button
        className="stem-play-toggle"
        type="button"
        aria-label={isPlaying ? `Stop ${label}` : `Play ${label}`}
        onClick={() => void togglePlayback()}
      >
        <span className={isPlaying ? "pause-glyph" : "play-glyph"} aria-hidden="true" />
      </button>

      <div className="track-player-wave">
        <div
          ref={waveformRef}
          className="waveform"
          aria-label={`${label} waveform`}
          onClick={handleWaveformClick}
        >
          {bars.map((bar, index) => {
            const barProgressThreshold = (index + 1) / bars.length;
            const isActive = progress >= barProgressThreshold;

            return (
              <span
                key={`${label}-${index}`}
                className={isActive ? "waveform-bar active" : "waveform-bar"}
                style={{ height: `${Math.round(bar * 100)}%` }}
              />
            );
          })}
        </div>
        <div className="stem-player-meta">
          <span className="small muted">{formatTime(currentTime)}</span>
          <span className="small muted">{formatTime(duration)}</span>
        </div>
      </div>
    </div>
  );
}
