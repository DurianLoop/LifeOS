(() => {
  const toggle = document.getElementById('whiteNoiseToggle');
  const kindSelect = document.getElementById('whiteNoiseKind');
  const volumeInput = document.getElementById('whiteNoiseVolume');
  const volumeText = document.getElementById('whiteNoiseVolumeText');
  const status = document.getElementById('whiteNoiseStatus');
  if (!toggle || !kindSelect || !volumeInput || !volumeText || !status) return;

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const storageKey = 'lifeos.whiteNoise';
  const names = {
    rain: '雨声', fire: '篝火', city: '城市', country: '乡村', ocean: '海浪',
    forest: '森林', stream: '溪流', storm: '雷雨', train: '列车', night: '夏夜'
  };
  const kinds = new Set(Object.keys(names));
  const buffers = new Map();
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch (_) {}
  let kind = kinds.has(saved.kind) ? saved.kind : 'rain';
  let volume = Number.isFinite(Number(saved.volume)) ? Math.min(100, Math.max(0, Number(saved.volume))) : 25;
  let context = null;
  let master = null;
  let active = null;
  let playing = false;
  let busy = false;
  let playbackRequest = 0;
  let suspendTimer = null;
  let errorMessage = '';

  kindSelect.value = kind;
  volumeInput.value = String(volume);

  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify({ kind, volume })); } catch (_) {}
  }

  function render() {
    toggle.textContent = playing ? '暂停' : '播放';
    toggle.setAttribute('aria-pressed', String(playing));
    toggle.disabled = busy || !AudioContextClass;
    volumeText.value = `${volume}%`;
    status.textContent = errorMessage || (!AudioContextClass ? '当前浏览器不支持声音播放。' : playing ? `${names[kind]}正在播放，关闭设置后也会继续。` : '本地播放，刷新后暂停。');
  }

  function makeEvents(scene, channel) {
    const events = [];
    if (scene === 'country' || scene === 'forest' || scene === 'stream') {
      let start = 0.7 + channel * 0.45;
      while (start < 14) {
        const bird = scene !== 'stream';
        events.push({
          start,
          duration: bird ? 0.16 + Math.random() * 0.16 : 0.07 + Math.random() * 0.08,
          frequency: bird ? 1450 + Math.random() * 1350 : 380 + Math.random() * 520,
          sweep: bird ? 500 + Math.random() * 1200 : -650 - Math.random() * 600,
          amplitude: bird ? 0.16 : 0.1
        });
        start += bird ? 1.15 + Math.random() * 2.25 : 0.35 + Math.random() * 0.75;
      }
    } else if (scene === 'city') {
      events.push(
        { start: 3.6 + channel * 0.1, duration: 0.38, frequency: 255, sweep: -35, amplitude: 0.06 },
        { start: 10.5 + channel * 0.15, duration: 0.25, frequency: 310, sweep: 25, amplitude: 0.04 }
      );
    }
    return events;
  }

  function makeBuffer(selectedKind) {
    if (buffers.has(selectedKind)) return buffers.get(selectedKind);
    const sampleRate = context.sampleRate;
    const frames = Math.floor(sampleRate * 14);
    const buffer = context.createBuffer(2, frames, sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const samples = buffer.getChannelData(channel);
      const events = makeEvents(selectedKind, channel);
      let eventIndex = 0;
      let low = 0;
      let mid = 0;
      let transient = 0;
      let sumSquares = 0;
      let peak = 0;
      for (let i = 0; i < frames; i += 1) {
        const t = i / sampleRate;
        const random = Math.random() * 2 - 1;
        low = low * 0.997 + random * 0.003;
        mid = mid * 0.89 + random * 0.11;
        const soft = mid - low;
        const airy = random - mid;
        while (eventIndex < events.length && t >= events[eventIndex].start + events[eventIndex].duration) eventIndex += 1;
        let tone = 0;
        const event = events[eventIndex];
        if (event && t >= event.start) {
          const age = t - event.start;
          const envelope = Math.sin(Math.PI * age / event.duration) ** 2;
          tone = Math.sin(2 * Math.PI * (event.frequency * age + event.sweep * age * age / 2)) * envelope * event.amplitude;
        }
        let sample = 0;
        switch (selectedKind) {
          case 'rain':
            if (Math.random() < 17 / sampleRate) transient += (Math.random() * 2 - 1) * 0.75;
            transient *= 0.965;
            sample = soft * 0.56 + airy * 0.18 + transient * 0.38;
            break;
          case 'fire':
            if (Math.random() < 8 / sampleRate) transient += (Math.random() * 2 - 1) * 0.9;
            transient *= 0.982;
            sample = soft * 0.14 + low * 0.3 + transient * 0.55;
            break;
          case 'city': {
            const traffic = (1 + Math.sin(t * 0.8 + channel)) / 2;
            sample = low * (0.8 + traffic * 1.6) + soft * 0.1 + Math.sin(2 * Math.PI * 78 * t) * 0.035 * traffic + tone;
            break;
          }
          case 'country':
            sample = soft * (0.15 + 0.12 * Math.sin(t * 0.6 + channel)) + low * 0.25 + tone;
            break;
          case 'ocean': {
            const surf = 0.22 + 0.78 * ((1 + Math.sin(2 * Math.PI * t / 5.8 + channel * 0.4)) / 2) ** 2;
            sample = (soft * 0.42 + airy * 0.2) * surf + low * 0.55;
            break;
          }
          case 'forest': {
            const wind = 0.4 + 0.4 * Math.sin(t * 0.75 + channel);
            sample = soft * wind * 0.35 + airy * wind * 0.06 + tone;
            break;
          }
          case 'stream':
            sample = soft * 0.46 + airy * 0.21 + tone;
            break;
          case 'storm': {
            const age = t > 9.9 ? t - 9.9 : t - 3.9;
            const thunder = age > 0 ? (1 - Math.exp(-age * 8)) * Math.exp(-age * 1.2) : 0;
            sample = soft * 0.48 + airy * 0.16 + thunder * (low * 5 + Math.sin(2 * Math.PI * 53 * t) * 0.16);
            break;
          }
          case 'train': {
            const clack = Math.exp(-(t % 0.52) * 65);
            sample = low * 1.55 + soft * 0.13 + Math.sin(2 * Math.PI * 82 * t) * 0.05 + clack * (random * 0.38 + 0.08);
            break;
          }
          case 'night': {
            const pulse = Math.max(0, Math.sin(2 * Math.PI * 12 * t));
            const chorus = 0.45 + 0.4 * Math.sin(2 * Math.PI * t / 3.2 + channel);
            sample = soft * 0.1 + Math.sin(2 * Math.PI * (3350 + channel * 430) * t) * pulse * chorus * 0.075;
            break;
          }
        }
        samples[i] = sample;
        sumSquares += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
      }
      const rms = Math.sqrt(sumSquares / frames);
      const scale = Math.min(0.9 / (peak || 1), 0.17 / (rms || 1));
      const fadeFrames = Math.min(512, Math.floor(frames / 4));
      for (let i = 0; i < frames; i += 1) {
        const fade = Math.min(1, i / fadeFrames, (frames - 1 - i) / fadeFrames);
        samples[i] *= scale * Math.max(0, fade);
      }
    }
    buffers.set(selectedKind, buffer);
    if (buffers.size > 2) buffers.delete(buffers.keys().next().value);
    return buffer;
  }

  function ensureContext() {
    if (context) return;
    context = new AudioContextClass();
    master = context.createGain();
    master.gain.value = 0;
    master.connect(context.destination);
  }

  function switchSound() {
    const buffer = makeBuffer(kind);
    const now = context.currentTime;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = buffer;
    source.loop = true;
    source.onended = () => { source.disconnect(); gain.disconnect(); };
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + 0.18);
    source.connect(gain);
    gain.connect(master);
    source.start();
    if (active) {
      active.gain.gain.cancelScheduledValues(now);
      active.gain.gain.setValueAtTime(active.gain.gain.value, now);
      active.gain.gain.linearRampToValueAtTime(0, now + 0.18);
      active.source.stop(now + 0.2);
    }
    active = { source, gain, kind };
  }

  async function play() {
    if (busy) return;
    const request = ++playbackRequest;
    busy = true;
    errorMessage = '';
    render();
    if (suspendTimer) clearTimeout(suspendTimer);
    try {
      ensureContext();
      const resumedContext = context;
      await resumedContext.resume();
      if (request !== playbackRequest || context !== resumedContext) return;
      if (!active || active.kind !== kind) switchSound();
      const now = context.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(volume / 100 * 0.35, now + 0.15);
      playing = true;
    } catch (_) {
      if (request !== playbackRequest) return;
      errorMessage = '无法播放声音，请检查浏览器的音频权限。';
      playing = false;
    } finally {
      if (request === playbackRequest) {
        busy = false;
        render();
      }
    }
  }

  function pause() {
    playing = false;
    if (context) {
      const now = context.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(0, now + 0.12);
      suspendTimer = setTimeout(() => {
        if (!playing && context?.state === 'running') context.suspend().catch(() => {});
      }, 160);
    }
    render();
  }

  toggle.addEventListener('click', () => { if (playing) pause(); else play(); });
  kindSelect.addEventListener('change', () => {
    kind = kinds.has(kindSelect.value) ? kindSelect.value : 'rain';
    errorMessage = '';
    save();
    if (playing) {
      try { switchSound(); } catch (_) {
        kind = active.kind;
        kindSelect.value = kind;
        save();
        errorMessage = '切换声音失败，当前声音仍在播放，请重试。';
      }
    }
    render();
  });
  volumeInput.addEventListener('input', () => {
    volume = Math.min(100, Math.max(0, Number(volumeInput.value) || 0));
    save();
    if (playing && context) {
      const now = context.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.setTargetAtTime(volume / 100 * 0.35, now, 0.025);
    }
    render();
  });
  window.addEventListener('pagehide', () => {
    playbackRequest += 1;
    busy = false;
    if (suspendTimer) clearTimeout(suspendTimer);
    if (context) context.close().catch(() => {});
    context = null;
    master = null;
    active = null;
    buffers.clear();
    playing = false;
    errorMessage = '';
    render();
  });
  render();
})();
