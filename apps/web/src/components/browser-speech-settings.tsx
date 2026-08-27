"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Laptop, Mic, Save, Volume2 } from "lucide-react";

import { settingsApi, type BrowserSpeechSettings as BrowserSpeechPreference } from "../api";
import styles from "./app-sidebar.module.css";

const fallbackSpeech: BrowserSpeechPreference = {
  adapter: "browser",
  language: "zh-CN",
  voiceUri: null,
  rate: 0.95,
  volume: 1,
};

export function BrowserSpeechSettings({ capability }: { capability: "tts" | "asr" }) {
  const [speech, setSpeech] = useState(fallbackSpeech);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [supported, setSupported] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const speechWindow = window as typeof window & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    setSupported(capability === "tts"
      ? "speechSynthesis" in window && "SpeechSynthesisUtterance" in window
      : Boolean(speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition));
    void settingsApi.capabilities()
      .then((settings) => { if (active) setSpeech(settings.speech); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "读取本机语音设置失败"); });
    if (capability !== "tts" || !("speechSynthesis" in window)) return () => { active = false; };
    const updateVoices = () => { if (active) setVoices(window.speechSynthesis.getVoices()); };
    updateVoices();
    window.speechSynthesis.addEventListener("voiceschanged", updateVoices);
    return () => {
      active = false;
      window.speechSynthesis.removeEventListener("voiceschanged", updateVoices);
    };
  }, [capability]);

  const orderedVoices = useMemo(() => [...voices].sort((left, right) => {
    const leftPreferred = left.lang.toLowerCase().startsWith("zh") ? 0 : 1;
    const rightPreferred = right.lang.toLowerCase().startsWith("zh") ? 0 : 1;
    return leftPreferred - rightPreferred || left.name.localeCompare(right.name, "zh-CN");
  }), [voices]);

  async function save() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const next = await settingsApi.saveCapabilities({ speech });
      setSpeech(next.speech);
      setMessage(capability === "tts" ? "本机语音偏好已保存" : "本机语音识别语言已保存");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存本机语音设置失败");
    } finally {
      setBusy(false);
    }
  }

  const Icon = capability === "tts" ? Laptop : Mic;
  const title = capability === "tts" ? "本机语音" : "本机语音识别";
  return <section aria-labelledby="browser-speech-title">
    <div className={styles.providerDetailHeader}>
      <div><span className={styles.providerDetailIcon}><Icon size={17} /></span><div><h3 id="browser-speech-title">{title}</h3><p>{capability === "tts" ? "由当前浏览器和操作系统朗读，不需要 API Key。" : "由当前浏览器识别语音，不需要 API Key，也不上传 Provider 凭据。"}</p></div></div>
      <span className={supported ? styles.settingsStatus : styles.settingsStatusIdle}><span />{supported ? "本机可用" : "当前浏览器不支持"}</span>
    </div>
    <div className={styles.mediaConfigGrid}>
      {capability === "tts" && <label className={styles.settingsField}><span>声音</span><select value={speech.voiceUri ?? ""} disabled={!supported} onChange={(event) => {
        const voice = voices.find((candidate) => candidate.voiceURI === event.target.value);
        setSpeech((current) => ({ ...current, voiceUri: voice?.voiceURI ?? null, language: voice?.lang || current.language }));
      }}><option value="">跟随浏览器默认</option>{orderedVoices.map((voice) => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} · {voice.lang}{voice.localService ? " · 本地" : ""}</option>)}</select></label>}
      <label className={styles.settingsField}><span>语言</span><input value={speech.language} disabled={!supported} onChange={(event) => setSpeech((current) => ({ ...current, language: event.target.value }))} placeholder="zh-CN" /></label>
      {capability === "tts" && <><label className={styles.settingsField}><span>语速 · {speech.rate.toFixed(2)}×</span><input type="range" min="0.5" max="2" step="0.05" value={speech.rate} disabled={!supported} onChange={(event) => setSpeech((current) => ({ ...current, rate: Number(event.target.value) }))} /></label>
      <label className={styles.settingsField}><span>音量 · {Math.round(speech.volume * 100)}%</span><input type="range" min="0" max="1" step="0.05" value={speech.volume} disabled={!supported} onChange={(event) => setSpeech((current) => ({ ...current, volume: Number(event.target.value) }))} /></label></>}
    </div>
    <div className={styles.settingsFooter}><span>{message && <span className={styles.settingsNoticeInline} role="status"><CheckCircle2 size={14} />{message}</span>}{error && <span className={styles.settingsErrorInline} role="alert">{error}</span>}</span><span className={styles.settingsActions}>{capability === "tts" && <button className={styles.secondaryButton} type="button" disabled={!supported} onClick={() => {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance("你好，我会用这个声音陪你上课。");
      utterance.lang = speech.language;
      utterance.rate = speech.rate;
      utterance.volume = speech.volume;
      utterance.voice = voices.find((voice) => voice.voiceURI === speech.voiceUri) ?? null;
      window.speechSynthesis.speak(utterance);
    }}><Volume2 size={14} />试听</button>}<button className={styles.saveButton} type="button" disabled={!supported || busy} onClick={() => void save()}><Save size={14} />{busy ? "保存中…" : capability === "tts" ? "保存本机语音" : "保存识别语言"}</button></span></div>
  </section>;
}
