"use client";

import {
  ChevronLeft,
  ChevronRight,
  CirclePlay,
  Pause,
  Presentation,
  Repeat,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";

import styles from "../chalkboard.module.css";

export type PlaybackSpeed = 0.75 | 1 | 1.25 | 1.5 | 2;

export interface PlaybackControlsProps {
  isPlaying: boolean;
  busy: boolean;
  playbackLocked: boolean;
  canPrevious: boolean;
  canNext: boolean;
  volume: number;
  muted: boolean;
  speed: PlaybackSpeed;
  autoPlay: boolean;
  chalkboardOpen: boolean;
  chalkboardHasContent: boolean;
  lockMessage?: string;
  onToggleMute: () => void;
  onVolumeChange: (value: number) => void;
  onCycleSpeed: () => void;
  onPrevious: () => void;
  onPlayPause: () => void;
  onNext: () => void;
  onToggleAutoPlay: () => void;
  onToggleChalkboard: () => void;
}

function VolumeIcon({ muted, volume }: { muted: boolean; volume: number }) {
  if (muted || volume === 0) return <VolumeX size={15} />;
  return volume < 0.5 ? <Volume1 size={15} /> : <Volume2 size={15} />;
}

export function PlaybackControls({
  isPlaying,
  busy,
  playbackLocked,
  canPrevious,
  canNext,
  volume,
  muted,
  speed,
  autoPlay,
  chalkboardOpen,
  chalkboardHasContent,
  lockMessage,
  onToggleMute,
  onVolumeChange,
  onCycleSpeed,
  onPrevious,
  onPlayPause,
  onNext,
  onToggleAutoPlay,
  onToggleChalkboard,
}: PlaybackControlsProps) {
  return (
    <div className={styles.playbackControlGroup}>
    <div className={styles.playbackControls} aria-label="课堂播放控制" aria-describedby={lockMessage ? "playback-lock-message" : undefined}>
      <div className={styles.volumeControl}>
        <button
          className={styles.controlButton}
          type="button"
          onClick={onToggleMute}
          aria-label={muted ? "打开声音" : "静音"}
          title={muted ? "打开声音" : "静音"}
        >
          <VolumeIcon muted={muted} volume={volume} />
        </button>
        <label className={styles.volumeSlider}>
          <span className={styles.volumeValue}>{Math.round((muted ? 0 : volume) * 100)}</span>
          <span className={styles.srOnly}>音量</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={muted ? 0 : volume}
            onChange={(event) => onVolumeChange(Number(event.target.value))}
            aria-label="音量"
            aria-valuetext={`${Math.round((muted ? 0 : volume) * 100)}%`}
          />
        </label>
      </div>
      <button
        className={`${styles.controlButton} ${speed !== 1 ? styles.controlButtonActive : ""}`}
        type="button"
        onClick={onCycleSpeed}
        aria-label={`播放速度 ${speed} 倍`}
        title="播放速度"
      >
        <span className={styles.speedLabel}>{speed}x</span>
      </button>
      <span className={styles.controlDivider} aria-hidden="true" />
      <button className={styles.controlButton} type="button" onClick={onPrevious} disabled={busy || !canPrevious} aria-label="上一页" title="上一页">
        <ChevronLeft size={17} />
      </button>
      <button className={styles.playControl} type="button" onClick={onPlayPause} disabled={busy || playbackLocked} aria-label={isPlaying ? "暂停" : "播放"} title={isPlaying ? "暂停" : "播放"}>
        {isPlaying ? <Pause size={16} /> : <CirclePlay size={17} />}
      </button>
      <button className={styles.controlButton} type="button" onClick={onNext} disabled={busy || !canNext} aria-label="下一页" title="下一页">
        <ChevronRight size={17} />
      </button>
      <span className={styles.controlDivider} aria-hidden="true" />
      <button className={`${styles.controlButton} ${autoPlay ? styles.controlButtonActive : ""}`} type="button" onClick={onToggleAutoPlay} aria-pressed={autoPlay} aria-label={autoPlay ? "关闭自动播放" : "打开自动播放"} title={autoPlay ? "关闭自动播放" : "打开自动播放"}>
        <Repeat size={15} />
      </button>
      <button
        className={`${styles.controlButton} ${chalkboardOpen ? styles.controlButtonActive : ""}`}
        type="button"
        onClick={onToggleChalkboard}
        aria-pressed={chalkboardOpen}
        aria-label={chalkboardOpen ? "收起实时黑板" : "打开实时黑板"}
        title={chalkboardOpen
          ? "收起实时黑板"
          : chalkboardHasContent ? "打开实时黑板（已有板书）" : "打开实时黑板"}
      >
        <span className={styles.chalkboardControlIcon} data-has-content={chalkboardHasContent || undefined} aria-hidden="true">
          <Presentation size={15} />
        </span>
      </button>
    </div>
    {lockMessage ? <p id="playback-lock-message" className={styles.playbackLockMessage}>{lockMessage}</p> : null}
    </div>
  );
}
