(() => {
  'use strict';
  const toggle = document.getElementById('whiteNoiseToggle');
  const kindSelect = document.getElementById('whiteNoiseKind');
  const volumeInput = document.getElementById('whiteNoiseVolume');
  const volumeText = document.getElementById('whiteNoiseVolumeText');
  const status = document.getElementById('whiteNoiseStatus');
  if (!toggle || !kindSelect || !volumeInput || !volumeText || !status) return;

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const names = { rain: '雨声', fire: '篝火', ocean: '海浪', forest: '森林鸟鸣', stream: '溪流', night: '夏夜虫鸣' };
  const storageKey = 'lifeos.whiteNoise';
  const buffers = new Map();
  const voices = new Set();
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch (_) {}
  let kind = Object.hasOwn(names, saved.kind) ? saved.kind : 'rain';
  let volume = Number.isFinite(Number(saved.volume)) ? Math.min(100, Math.max(0, Number(saved.volume))) : 25;
  let context = null;
  let master = null;
  let active = null;
  let requestedPlaying = false;
  let loading = false;
  let playbackRequest = 0;
  let suspendTimer = null;
  let pendingFetch = null;
  let loadQueue = Promise.resolve();
  let errorMessage = '';

  kindSelect.value = kind;
  volumeInput.value = String(volume);

  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify({ kind, volume })); } catch (_) {}
  }

  function render() {
    toggle.textContent = requestedPlaying ? (active ? '暂停' : '取消') : '播放';
    toggle.setAttribute('aria-pressed', String(requestedPlaying));
    toggle.setAttribute('aria-busy', String(loading));
    toggle.disabled = !AudioContextClass;
    volumeText.value = `${volume}%`;
    status.textContent = errorMessage || (!AudioContextClass ? '当前浏览器不支持声音播放。'
      : loading ? `正在载入${names[kind]}…${active ? ` ${names[active.kind]}继续播放。` : ''}`
      : requestedPlaying && active ? `${names[active.kind]}正在播放，关闭设置后也会继续。`
      : '自然实录，本地播放；刷新后暂停。');
  }

  function ensureContext() {
    if (context) return;
    context = new AudioContextClass({ sampleRate: 32000 });
    master = context.createGain();
    master.gain.value = 0;
    master.connect(context.destination);
  }

  function ramp(parameter, value, duration, now) {
    if (parameter.cancelAndHoldAtTime) parameter.cancelAndHoldAtTime(now);
    else {
      const current = parameter.value;
      parameter.cancelScheduledValues(now);
      parameter.setValueAtTime(current, now);
    }
    parameter.linearRampToValueAtTime(value, now + duration);
  }

  function stopVoice(voice, fade = .45) {
    if (!voice || !context) return;
    const now = context.currentTime;
    ramp(voice.gain.gain, 0, fade, now);
    try { voice.source.stop(now + fade + .02); } catch (_) {}
  }

  function switchSound(buffer, selectedKind) {
    const now = context.currentTime;
    // A rapid third switch releases the oldest fading graph promptly.
    for (const voice of voices) if (voice !== active) stopVoice(voice, .03);
    const source = context.createBufferSource();
    const gain = context.createGain();
    const voice = { source, gain, kind: selectedKind };
    source.buffer = buffer;
    source.loop = true;
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      voices.delete(voice);
    };
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + .45);
    source.connect(gain);
    gain.connect(master);
    source.start();
    voices.add(voice);
    stopVoice(active);
    active = voice;
    ramp(master.gain, volume / 100, .18, now);
  }

  function stillCurrent(request, audioContext) {
    return request === playbackRequest && context === audioContext && requestedPlaying;
  }

  function loadBuffer(selectedKind, request, audioContext) {
    // Only one fetch/decode runs at a time. Superseded decodes are discarded;
    // their data never accumulates in the two-entry decoded-buffer cache.
    const job = loadQueue.catch(() => {}).then(async () => {
      if (!stillCurrent(request, audioContext)) return null;
      if (buffers.has(selectedKind)) {
        const buffer = buffers.get(selectedKind);
        buffers.delete(selectedKind);
        buffers.set(selectedKind, buffer);
        return buffer;
      }
      const controller = new AbortController();
      pendingFetch = controller;
      try {
        const response = await fetch(`/assets/audio/${selectedKind}.ogg?v=1`, { signal: controller.signal, cache: 'force-cache' });
        if (!response.ok) throw new Error('audio unavailable');
        const bytes = await response.arrayBuffer();
        if (!stillCurrent(request, audioContext)) return null;
        if (!bytes.byteLength || bytes.byteLength > 2 * 1024 * 1024) throw new Error('invalid audio size');
        const buffer = await audioContext.decodeAudioData(bytes);
        if (!stillCurrent(request, audioContext)) return null;
        if (!Number.isFinite(buffer.duration) || buffer.duration < 2 || buffer.duration > 65 || buffer.numberOfChannels > 2) {
          throw new Error('invalid recording');
        }
        buffers.set(selectedKind, buffer);
        while (buffers.size > 2) buffers.delete(buffers.keys().next().value);
        return buffer;
      } finally {
        if (pendingFetch === controller) pendingFetch = null;
      }
    });
    loadQueue = job;
    return job;
  }

  async function play() {
    const request = ++playbackRequest;
    const selectedKind = kind;
    requestedPlaying = true;
    loading = true;
    errorMessage = '';
    pendingFetch?.abort();
    if (suspendTimer) clearTimeout(suspendTimer);
    render();
    try {
      ensureContext();
      const audioContext = context;
      await audioContext.resume();
      if (!stillCurrent(request, audioContext)) {
        if (context === audioContext && !requestedPlaying) audioContext.suspend().catch(() => {});
        return;
      }
      const buffer = await loadBuffer(selectedKind, request, audioContext);
      if (!buffer || !stillCurrent(request, audioContext)) return;
      if (!active || active.kind !== selectedKind) switchSound(buffer, selectedKind);
      else ramp(master.gain, volume / 100, .18, context.currentTime);
    } catch (_) {
      if (request !== playbackRequest) return;
      if (active) {
        kind = active.kind;
        kindSelect.value = kind;
        save();
        errorMessage = '这段录音暂时无法载入，当前声音继续播放；可重新选择后重试。';
      } else {
        requestedPlaying = false;
        errorMessage = '录音暂时无法播放，请重试或选择另一种声音。';
        context?.suspend().catch(() => {});
      }
    } finally {
      if (request === playbackRequest) {
        loading = false;
        render();
      }
    }
  }

  function pause() {
    const request = ++playbackRequest;
    requestedPlaying = false;
    loading = false;
    errorMessage = '';
    pendingFetch?.abort();
    if (suspendTimer) clearTimeout(suspendTimer);
    if (context) {
      ramp(master.gain, 0, .16, context.currentTime);
      for (const voice of voices) stopVoice(voice, .16);
      active = null;
      suspendTimer = setTimeout(() => {
        if (request === playbackRequest && !requestedPlaying && context?.state === 'running') context.suspend().catch(() => {});
      }, 210);
    }
    render();
  }

  toggle.addEventListener('click', () => { if (requestedPlaying) pause(); else void play(); });
  kindSelect.addEventListener('change', () => {
    kind = Object.hasOwn(names, kindSelect.value) ? kindSelect.value : 'rain';
    kindSelect.value = kind;
    errorMessage = '';
    save();
    if (requestedPlaying) void play();
    render();
  });
  volumeInput.addEventListener('input', () => {
    volume = Math.min(100, Math.max(0, Number(volumeInput.value) || 0));
    save();
    if (requestedPlaying && context && master) ramp(master.gain, volume / 100, .08, context.currentTime);
    render();
  });
  window.addEventListener('pagehide', () => {
    playbackRequest += 1;
    pendingFetch?.abort();
    pendingFetch = null;
    if (suspendTimer) clearTimeout(suspendTimer);
    for (const voice of voices) {
      try { voice.source.stop(); } catch (_) {}
      voice.source.disconnect();
      voice.gain.disconnect();
    }
    voices.clear();
    if (context) context.close().catch(() => {});
    context = null;
    master = null;
    active = null;
    loadQueue = Promise.resolve();
    buffers.clear();
    requestedPlaying = false;
    loading = false;
    errorMessage = '';
    render();
  });
  render();
})();
