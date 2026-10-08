import { initUniverse } from './universe.js';
import { initPageMotion } from './motion.js';
import { initNavigation } from './navigation.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const status = $('#site-status');
const motionButton = $('#motion-toggle');
const petButton = $('#pet-button');
const petImage = $('#pet-image');
const brandImage = $('#download-brand');
let brandVisible = false;
const petActions = [
  { name: '坐下', source: './assets/vivi-sit.gif' },
  { name: '跳跃', source: './assets/vivi-jump.gif' },
  { name: '放松', source: './assets/vivi-relax.gif' },
];
let petActionIndex = 0;
let motionManuallyPaused = false;
let pageActive = true;

function setText(selector, text) {
  const element = $(selector);
  if (element) element.textContent = text;
}
function announce(text) {
  if (status) status.textContent = text;
}

// These are the product's original action assets, with no generated dialogue.
function syncPet() {
  if (!petImage) return;
  const action = petActions[petActionIndex];
  const animated = pageActive && !document.hidden && !reducedMotion.matches && document.body.dataset.motion !== 'paused';
  const source = animated ? action.source : './assets/vivi-preview.png';
  if (petImage.getAttribute('src') !== source) petImage.src = source;
  petImage.alt = animated ? `ViVi · ${action.name}，产品原始动作动画` : 'ViVi 静态预览';
  setText('#pet-action-label', `ViVi · ${action.name}`);
  petButton?.setAttribute('aria-label', `切换 ViVi 动作，当前选择：${action.name}`);
}

function syncBrandMark() {
  if (!brandImage) return;
  const animated = brandVisible && pageActive && !document.hidden && !reducedMotion.matches && document.body.dataset.motion !== 'paused';
  const source = animated ? brandImage.dataset.animatedSrc : brandImage.dataset.staticSrc;
  if (brandImage.getAttribute('src') !== source) brandImage.src = source;
}

function syncAnimatedAssets() {
  syncPet();
  syncBrandMark();
}

// Start the GIF only when its section is visible. HTML remains static without JS.
if (brandImage) {
  if ('IntersectionObserver' in window) {
    const brandObserver = new IntersectionObserver(([entry]) => {
      brandVisible = entry.isIntersecting;
      syncBrandMark();
    });
    brandObserver.observe(brandImage);
  } else {
    brandVisible = true;
  }
}
petButton?.addEventListener('click', () => {
  petActionIndex = (petActionIndex + 1) % petActions.length;
  syncPet();
  announce(`ViVi · ${petActions[petActionIndex].name}${document.body.dataset.motion === 'paused' ? '。动效已暂停，当前显示静态预览。' : ''}`);
});

function syncMotion() {
  const paused = motionManuallyPaused || reducedMotion.matches;
  document.body.dataset.motion = paused ? 'paused' : 'playing';
  motionButton?.setAttribute('aria-pressed', String(paused));
  if (motionButton) motionButton.textContent = reducedMotion.matches ? '已遵循减少动效设置' : paused ? '开启动效' : '暂停动效';
  syncAnimatedAssets();
}
motionButton?.addEventListener('click', () => {
  if (reducedMotion.matches) {
    announce('页面正在遵循系统的减少动态效果设置。');
    return;
  }
  motionManuallyPaused = !motionManuallyPaused;
  syncMotion();
});
reducedMotion.addEventListener('change', syncMotion);
syncMotion();

// Progressive enhancement: navigation and downloads also work without JS.
try { initPageMotion(); } catch { document.body.classList.remove('js-ready', 'motion-ready'); }
try { initUniverse(); } catch { /* Decorative artwork must not prevent reading the page. */ }

const hero = $('.hero');
const papers = $('.orbital-papers');
hero?.addEventListener('pointermove', (event) => {
  if (!papers || document.body.dataset.motion === 'paused' || event.pointerType === 'touch') return;
  const bounds = hero.getBoundingClientRect();
  papers.style.setProperty('--px', `${((event.clientX - bounds.left) / bounds.width - .5) * 13}px`);
  papers.style.setProperty('--py', `${((event.clientY - bounds.top) / bounds.height - .5) * 11}px`);
}, { passive: true });
hero?.addEventListener('pointerleave', () => {
  papers?.style.setProperty('--px', '0px');
  papers?.style.setProperty('--py', '0px');
});

initNavigation();

// Both players share one user-initiated, same-origin audio element.
let forestAudio;
let audioPending = false;
const soundToggle = $('#sound-toggle');
const forestButton = $('#forest-preview');
function syncAudio(playing) {
  soundToggle?.setAttribute('aria-pressed', String(playing));
  soundToggle?.setAttribute('aria-label', playing ? '暂停森林环境音' : '播放森林环境音');
  forestButton?.setAttribute('aria-pressed', String(playing));
  setText('#sound-label', playing ? '森林声场' : '声音关闭');
  setText('.forest-preview .mono', playing ? 'PAUSE' : 'LISTEN');
}
async function toggleAudio() {
  if (audioPending || document.hidden || !pageActive) return;
  if (!forestAudio) {
    forestAudio = new Audio(new URL('./assets/forest.ogg', import.meta.url).href);
    forestAudio.loop = true;
    forestAudio.volume = .35;
    forestAudio.preload = 'none';
    forestAudio.addEventListener('pause', () => syncAudio(false));
    forestAudio.addEventListener('playing', () => syncAudio(true));
    forestAudio.addEventListener('error', () => {
      syncAudio(false);
      setText('#sound-label', '声音未载入 · 点击重试');
      announce('森林录音暂时无法加载，请点击重试。');
    });
  }
  if (!forestAudio.paused) {
    forestAudio.pause();
    return;
  }
  audioPending = true;
  try {
    await forestAudio.play();
    if (document.hidden || !pageActive) {
      forestAudio.pause();
      return;
    }
    announce('森林环境音已播放。再次点击可以暂停。');
  } catch {
    syncAudio(false);
    if (!document.hidden && pageActive) {
      setText('#sound-label', '声音未载入 · 点击重试');
      announce('声音未能播放，请再次点击播放按钮重试。');
    }
  } finally { audioPending = false; }
}
soundToggle?.addEventListener('click', toggleAudio);
forestButton?.addEventListener('click', toggleAudio);

// Switch between documented product behavior; this page does not draw journal data.
const memoryModes = {
  page: {
    label: '一页旧日', index: '01 / 03', title: '重逢，是再读一次原文。',
    description: '从本地已经写下的日记或周记中，抽取一篇原文。',
    excerpt: '旧页来自你保存在本机的日记或周记。抽到的内容保留原文，让已经写下的生活重新回到眼前。',
    tag: '来源：本地日记 / 周记原文',
  },
  echo: {
    label: '一段回声', index: '02 / 03', title: '隔着时间，词句再次相遇。',
    description: '寻找两篇相隔较远、共享词句的日记，同时呈现共同词句。',
    excerpt: '回声将时间相隔较远的两篇日记放在一起，并显示它们共享的词句。连接来自原文的词句匹配，不是 AI 对情绪的理解。',
    tag: '来源：两篇日记 / 共同词句',
  },
  thread: {
    label: '一条线索', index: '03 / 03', title: '沿着线索，再回到那一页。',
    description: '从本地来源卡片进入原文；没有可用卡片时，回退到旧页。',
    excerpt: '线索来自本地的「留白之间」「心中回响」「初次落笔」「故事归来」等来源卡片，并附上对应原文。没有可用卡片时，使用旧页模式。',
    tag: '来源：本地卡片 / 对应原文',
  },
};
const modeButtons = $$('[data-mode]');
function renderMemoryMode(mode) {
  const content = memoryModes[mode];
  if (!content) return;
  modeButtons.forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  setText('#memory-type', content.label);
  setText('#memory-index', content.index);
  setText('#memory-title', content.title);
  setText('#memory-excerpt', content.excerpt);
  setText('#memory-tag', content.tag);
  setText('#mode-description', content.description);
}
modeButtons.forEach((button) => button.addEventListener('click', () => renderMemoryMode(button.dataset.mode)));
renderMemoryMode('page');

// The lightbox displays original application captures, never simulated submissions.
const screens = {
  workspace: {
    source: './assets/screens/workspace.png', title: '查看 LifeOS 工作区界面',
    description: '作者提供的真实应用原图，展示 LifeOS 工作区。',
  },
  memory: {
    source: './assets/screens/memory.jpg', title: '记忆抽签机',
    description: 'v0.5.2 的实际初始界面，展示旧页、回声、线索三种抽签方式。',
  },
  bottles: {
    source: './assets/screens/bottles.jpg', title: '查看漂流瓶写信界面',
    description: 'v0.5.2 的真实空白写信页截图，当前尚未填写内容。',
  },
  companion: {
    source: './assets/screens/companion.png', title: '灵犀 · 桌面伙伴',
    description: 'v0.5.2 的实际灵犀界面，展示 ViVi、已安装伙伴与宠物库。',
  },
};
const screenDialog = $('#screen-dialog');
const screenImage = $('#screen-image');
const screenOriginal = $('#screen-original');
let currentScreen = null;
$$('[data-screen]').forEach((button) => button.addEventListener('click', () => {
  const screen = screens[button.dataset.screen];
  if (!screen || !screenDialog || !screenImage) return;
  currentScreen = screen;
  const source = new URL(screen.source, import.meta.url).href;
  setText('#screen-title', screen.title);
  setText('#screen-description', screen.description);
  screenImage.hidden = false;
  screenImage.alt = `${screen.title}：${screen.description}`;
  screenImage.src = source;
  if (screenOriginal) {
    screenOriginal.href = source;
    screenOriginal.target = '_blank';
    screenOriginal.rel = 'noopener noreferrer';
  }
  if (typeof screenDialog.showModal === 'function') {
    if (!screenDialog.open) screenDialog.showModal();
  } else {
    window.open(source, '_blank', 'noopener,noreferrer');
  }
}));
screenImage?.addEventListener('error', () => {
  screenImage.hidden = true;
  setText('#screen-description', `${currentScreen?.description || ''} 图片暂时未能载入，可以点击「打开原图」重试。`);
});
screenImage?.addEventListener('load', () => {
  screenImage.hidden = false;
  if (currentScreen) setText('#screen-description', currentScreen.description);
});
$$('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => button.closest('dialog')?.close()));
$$('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => {
  const box = dialog.getBoundingClientRect();
  const outside = event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
  if (event.target === dialog && outside) dialog.close();
}));
// Native <dialog> supplies Escape dismissal, focus containment and focus restoration.

document.addEventListener('visibilitychange', () => {
  syncAnimatedAssets();
  if (document.hidden) forestAudio?.pause();
});
window.addEventListener('pagehide', () => {
  pageActive = false;
  syncAnimatedAssets();
  forestAudio?.pause();
});
window.addEventListener('pageshow', () => {
  pageActive = true;
  syncAnimatedAssets();
});
