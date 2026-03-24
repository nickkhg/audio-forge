// ============================================================
//  Audio Forge — Frontend Logic
//  Works in both Tauri (desktop) and Web (browser) modes
// ============================================================

const IS_TAURI = !!window.__TAURI__;

// ---- Backend abstraction ----
const backend = IS_TAURI ? {
  async checkFfmpeg() {
    return window.__TAURI__.core.invoke('check_ffmpeg');
  },
  async probeAudio(fileOrPath) {
    return window.__TAURI__.core.invoke('probe_audio', { path: fileOrPath });
  },
  async convertAudio(fileOrPath, options) {
    const { open, save } = window.__TAURI__.dialog;
    const ext = FORMAT_EXTENSIONS[options.format] || options.format;
    const outputPath = await save({
      defaultPath: replaceExtension(fileOrPath, ext),
      filters: [{ name: `${options.format.toUpperCase()} Audio`, extensions: [ext] }]
    });
    if (!outputPath) return null;
    const finalPath = outputPath.toLowerCase().endsWith('.' + ext) ? outputPath : outputPath + '.' + ext;
    const result = await window.__TAURI__.core.invoke('convert_audio', {
      options: {
        input_path: fileOrPath,
        output_path: finalPath,
        format: options.format,
        sample_rate: options.sampleRate ? parseInt(options.sampleRate) : null,
        channels: options.channels ? parseInt(options.channels) : null,
        bit_depth: options.bitDepth ? parseInt(options.bitDepth) : null,
        bitrate: options.bitrate || null,
        volume: options.volume !== 100 ? options.volume / 100 : null,
        normalize: options.normalize,
        trim_silence: options.trimSilence,
        fade_in: options.fadeIn > 0 ? options.fadeIn : null,
        fade_out: options.fadeOut > 0 ? options.fadeOut : null,
      }
    });
    return { type: 'path', value: result.split(/[/\\]/).pop() };
  },
  async openFileDialog() {
    const { open } = window.__TAURI__.dialog;
    return open({
      multiple: false,
      filters: [{
        name: 'Audio Files',
        extensions: ['wav','mp3','flac','ogg','aac','m4a','opus','wma','aiff','aif','wv','ape']
      }]
    });
  },
  setupDragDrop(dropZone, onFile) {
    const { getCurrentWebviewWindow } = window.__TAURI__.webviewWindow;
    const appWindow = getCurrentWebviewWindow();
    appWindow.onDragDropEvent((event) => {
      if (event.payload.type === 'over') {
        dropZone.classList.add('drag-over');
      } else if (event.payload.type === 'leave') {
        dropZone.classList.remove('drag-over');
      } else if (event.payload.type === 'drop') {
        dropZone.classList.remove('drag-over');
        const paths = event.payload.paths;
        if (paths && paths.length > 0) onFile(paths[0]);
      }
    });
  }
} : {
  async checkFfmpeg() {
    const res = await fetch('/api/health');
    const data = await res.json();
    if (data.status === 'ok') return data.ffmpeg;
    throw new Error(data.error || 'FFmpeg not available');
  },
  async probeAudio(file) {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/probe', { method: 'POST', body: form });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async convertAudio(file, options) {
    const form = new FormData();
    form.append('file', file);
    form.append('options', JSON.stringify({
      format: options.format,
      sample_rate: options.sampleRate ? parseInt(options.sampleRate) : null,
      channels: options.channels ? parseInt(options.channels) : null,
      bit_depth: options.bitDepth ? parseInt(options.bitDepth) : null,
      bitrate: options.bitrate || null,
      volume: options.volume !== 100 ? options.volume / 100 : null,
      normalize: options.normalize,
      trim_silence: options.trimSilence,
      fade_in: options.fadeIn > 0 ? options.fadeIn : null,
      fade_out: options.fadeOut > 0 ? options.fadeOut : null,
    }));
    const res = await fetch('/api/convert', { method: 'POST', body: form });
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    const ext = FORMAT_EXTENSIONS[options.format] || options.format;
    const baseName = (typeof file === 'string' ? file : file.name).replace(/\.[^.]+$/, '');
    const fileName = baseName.split(/[/\\]/).pop() + '.' + ext;
    // Trigger browser download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    return { type: 'download', value: fileName };
  },
  async openFileDialog() {
    return new Promise((resolve) => {
      fileInput.click();
      fileInput.onchange = () => {
        const file = fileInput.files[0];
        resolve(file || null);
      };
    });
  },
  setupDragDrop(dropZone, onFile) {
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('drag-over');
    });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const file = e.dataTransfer.files[0];
      if (file) onFile(file);
    });
  }
};

// ---- State ----
let currentFile = null; // string (Tauri path) or File object (web)
let audioInfo = null;
let optionsOpen = false;

// ---- DOM refs ----
const $ = (sel) => document.querySelector(sel);
const dropZone     = $('#dropZone');
const dropContent  = $('#dropContent');
const fileInfo     = $('#fileInfo');
const fileInput    = $('#fileInput');
const clearFileBtn = $('#clearFile');
const convertBtn   = $('#convertBtn');
const progressWrap = $('#progressWrap');
const progressFill = $('#progressFill');
const progressText = $('#progressText');
const optionsToggle = $('#optionsToggle');
const optionsGrid   = $('#optionsGrid');
const ffmpegStatus  = $('#ffmpegStatus');

const optFormat     = $('#optFormat');
const optChannels   = $('#optChannels');
const optSampleRate = $('#optSampleRate');
const optBitDepth   = $('#optBitDepth');
const optBitrate    = $('#optBitrate');
const optVolume     = $('#optVolume');
const optNormalize  = $('#optNormalize');
const optTrimSilence= $('#optTrimSilence');
const optFadeIn     = $('#optFadeIn');
const optFadeOut    = $('#optFadeOut');
const volumeDisplay = $('#volumeDisplay');
const bitDepthGroup = $('#bitDepthGroup');
const bitrateGroup  = $('#bitrateGroup');

// ---- Presets ----
const PRESETS = {
  'wav-mono':   { format: 'wav', channels: '1', sampleRate: '44100', bitDepth: '16', bitrate: '', volume: 100, normalize: false, trimSilence: false, fadeIn: 0, fadeOut: 0 },
  'wav-stereo': { format: 'wav', channels: '2', sampleRate: '44100', bitDepth: '16', bitrate: '', volume: 100, normalize: false, trimSilence: false, fadeIn: 0, fadeOut: 0 },
  'mp3-320':    { format: 'mp3', channels: '',  sampleRate: '',      bitDepth: '',   bitrate: '320k', volume: 100, normalize: false, trimSilence: false, fadeIn: 0, fadeOut: 0 },
  'flac':       { format: 'flac', channels: '', sampleRate: '',      bitDepth: '',   bitrate: '', volume: 100, normalize: false, trimSilence: false, fadeIn: 0, fadeOut: 0 },
  'custom':     null,
};

const FORMAT_EXTENSIONS = {
  wav: 'wav', mp3: 'mp3', flac: 'flac', ogg: 'ogg', m4a: 'm4a', opus: 'opus',
};

const LOSSY_FORMATS = new Set(['mp3', 'ogg', 'm4a', 'opus']);

// ---- Init ----
async function init() {
  try {
    const version = await backend.checkFfmpeg();
    ffmpegStatus.classList.add('ok');
    ffmpegStatus.querySelector('.status-text').textContent = version.split(' ').slice(0, 3).join(' ');
  } catch (e) {
    ffmpegStatus.classList.add('error');
    ffmpegStatus.querySelector('.status-text').textContent = 'FFmpeg not found';
  }

  applyPreset('wav-mono');
  setupEventListeners();
}

function setupEventListeners() {
  // Click to open file
  dropZone.addEventListener('click', async () => {
    if (currentFile) return;
    const selected = await backend.openFileDialog();
    if (selected) handleFileSelect(selected);
  });

  // Drag and drop
  backend.setupDragDrop(dropZone, (fileOrPath) => {
    if (!currentFile) handleFileSelect(fileOrPath);
  });

  clearFileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    clearFile();
  });

  // Presets
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.preset;
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (preset === 'custom') {
        if (!optionsOpen) toggleOptions();
      } else {
        applyPreset(preset);
      }
    });
  });

  optionsToggle.addEventListener('click', toggleOptions);

  optFormat.addEventListener('change', () => {
    updateFormatOptions();
    markCustom();
  });

  [optChannels, optSampleRate, optBitDepth, optBitrate, optNormalize, optTrimSilence, optFadeIn, optFadeOut].forEach(el => {
    el.addEventListener('change', markCustom);
  });

  optVolume.addEventListener('input', () => {
    volumeDisplay.textContent = optVolume.value + '%';
    markCustom();
  });

  convertBtn.addEventListener('click', handleConvert);
}

function toggleOptions() {
  optionsOpen = !optionsOpen;
  optionsToggle.classList.toggle('open', optionsOpen);
  optionsGrid.classList.toggle('open', optionsOpen);
}

function applyPreset(name) {
  const p = PRESETS[name];
  if (!p) return;
  optFormat.value      = p.format;
  optChannels.value    = p.channels;
  optSampleRate.value  = p.sampleRate;
  optBitDepth.value    = p.bitDepth;
  optBitrate.value     = p.bitrate;
  optVolume.value      = p.volume;
  optNormalize.checked = p.normalize;
  optTrimSilence.checked = p.trimSilence;
  optFadeIn.value      = p.fadeIn;
  optFadeOut.value     = p.fadeOut;
  volumeDisplay.textContent = p.volume + '%';
  updateFormatOptions();
}

function updateFormatOptions() {
  const isLossy = LOSSY_FORMATS.has(optFormat.value);
  bitDepthGroup.classList.toggle('hidden', isLossy);
  bitrateGroup.classList.toggle('hidden', !isLossy);
}

function markCustom() {
  const current = getCurrentOptions();
  let matchedPreset = null;
  for (const [name, p] of Object.entries(PRESETS)) {
    if (!p) continue;
    if (p.format === current.format &&
        p.channels === (current.channels || '') &&
        p.sampleRate === (current.sampleRate || '') &&
        p.bitDepth === (current.bitDepth || '') &&
        p.bitrate === (current.bitrate || '') &&
        p.volume === current.volume &&
        p.normalize === current.normalize &&
        p.trimSilence === current.trimSilence) {
      matchedPreset = name;
      break;
    }
  }
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.preset === (matchedPreset || 'custom'));
  });
}

function getCurrentOptions() {
  return {
    format:      optFormat.value,
    channels:    optChannels.value,
    sampleRate:  optSampleRate.value,
    bitDepth:    optBitDepth.value,
    bitrate:     optBitrate.value,
    volume:      parseInt(optVolume.value),
    normalize:   optNormalize.checked,
    trimSilence: optTrimSilence.checked,
    fadeIn:      parseFloat(optFadeIn.value) || 0,
    fadeOut:     parseFloat(optFadeOut.value) || 0,
  };
}

function getDisplayName(fileOrPath) {
  if (typeof fileOrPath === 'string') return fileOrPath.split(/[/\\]/).pop();
  return fileOrPath.name;
}

async function handleFileSelect(fileOrPath) {
  if (!fileOrPath) return;

  currentFile = fileOrPath;
  dropContent.classList.add('hidden');
  fileInfo.classList.remove('hidden');
  dropZone.style.cursor = 'default';

  $('#fileName').textContent = getDisplayName(fileOrPath);
  $('#fileFormat').textContent = 'Analyzing…';

  try {
    audioInfo = await backend.probeAudio(fileOrPath);
    $('#fileName').textContent     = audioInfo.filename;
    $('#fileFormat').textContent    = audioInfo.codec;
    $('#metaDuration').textContent  = audioInfo.duration;
    $('#metaSampleRate').textContent= formatSampleRate(audioInfo.sample_rate);
    $('#metaChannels').textContent  = audioInfo.channels;
    $('#metaBitDepth').textContent  = audioInfo.bit_depth;
    $('#metaBitrate').textContent   = audioInfo.bitrate;
    $('#metaSize').textContent      = audioInfo.file_size;
    convertBtn.disabled = false;
  } catch (e) {
    $('#fileFormat').textContent = 'Error reading file';
    console.error(e);
  }
}

function formatSampleRate(sr) {
  const num = parseInt(sr);
  if (isNaN(num)) return sr;
  return num >= 1000 ? (num / 1000) + ' kHz' : num + ' Hz';
}

function clearFile() {
  currentFile = null;
  audioInfo = null;
  fileInput.value = '';
  dropContent.classList.remove('hidden');
  fileInfo.classList.add('hidden');
  dropZone.style.cursor = 'pointer';
  convertBtn.disabled = true;
  progressWrap.classList.add('hidden');
  progressFill.style.background = '';
}

async function handleConvert() {
  if (!currentFile) return;

  const opts = getCurrentOptions();

  convertBtn.disabled = true;
  progressWrap.classList.remove('hidden');
  progressFill.className = 'progress-fill indeterminate';
  progressFill.style.background = '';
  progressText.textContent = 'Converting…';
  progressText.className = 'progress-text';

  try {
    const result = await backend.convertAudio(currentFile, opts);
    if (!result) {
      // User cancelled save dialog
      progressWrap.classList.add('hidden');
      convertBtn.disabled = false;
      return;
    }
    progressFill.className = 'progress-fill';
    progressFill.style.width = '100%';
    const msg = result.type === 'download'
      ? 'Done — downloading ' + result.value
      : 'Done — saved to ' + result.value;
    progressText.textContent = msg;
    progressText.className = 'progress-text success';
  } catch (e) {
    progressFill.className = 'progress-fill';
    progressFill.style.width = '100%';
    progressFill.style.background = 'var(--error)';
    progressText.textContent = 'Error: ' + e;
    progressText.className = 'progress-text error';
  }

  convertBtn.disabled = false;
}

function replaceExtension(filePath, newExt) {
  const parts = filePath.split(/[/\\]/);
  const filename = parts.pop();
  const dotIndex = filename.lastIndexOf('.');
  const baseName = dotIndex > 0 ? filename.substring(0, dotIndex) : filename;
  parts.push(baseName + '.' + newExt);
  return parts.join('/');
}

function formatFileSize(bytes) {
  if (bytes > 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes > 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}

// ---- Boot ----
init();
