"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";

type StemPlayerProps = {
  iconSrc: string;
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

export function StemPlayer({ iconSrc, label, url }: StemPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const waveformRef = useRef<HTMLDivElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [waveform, setWaveform] = useState<number[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const audio = new Audio(url);
    audio.preload = "metadata";
    audioRef.current = audio;

    const handleLoadedMetadata = () => {
      setDuration(audio.duration || 0);
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    const handlePause = () => {
      setIsPlaying(false);
    };

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("pause", handlePause);

    return () => {
      if (animationFrameRef.current) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }

      audio.pause();
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("pause", handlePause);
      audioRef.current = null;
    };
  }, [url]);

  useEffect(() => {
    let cancelled = false;

    async function loadWaveform() {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error("Failed to load audio");
        }

        const arrayBuffer = await response.arrayBuffer();
        const AudioContextClass = window.AudioContext || (window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        }).webkitAudioContext;

        if (!AudioContextClass) {
          throw new Error("AudioContext is not supported");
        }

        const audioContext = new AudioContextClass();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
        const waveformData = buildWaveformData(audioBuffer.getChannelData(0));
        await audioContext.close();

        if (!cancelled) {
          setWaveform(waveformData);
          setLoadState("ready");
        }
      } catch {
        if (!cancelled) {
          setLoadState("error");
        }
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
    <li className="stem-card">
      <div className="stem-player-icon">
        <Image src={iconSrc} alt={label} width={42} height={42} className="stem-icon" />
      </div>

      <button
        className="stem-play-toggle"
        type="button"
        aria-label={isPlaying ? `Stop ${label}` : `Play ${label}`}
        onClick={() => void togglePlayback()}
      >
        <span className={isPlaying ? "pause-glyph" : "play-glyph"} aria-hidden="true" />
      </button>

      <div className="stem-player-wave">
        <div
          ref={waveformRef}
          className="waveform"
          aria-label={`${label} waveform`}
          onClick={handleWaveformClick}
          role="slider"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(currentTime)}
          aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
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

      <div className="stem-player-actions">
        <a className="link-button" href={url} target="_blank" rel="noreferrer">
          Download
        </a>
        {loadState === "loading" ? <span className="small muted">Loading waveform</span> : null}
      </div>
    </li>
  );
}
