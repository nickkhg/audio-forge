// ============================================================
//  Audio Forge — Frontend Logic
//  Communicates with Tauri backend for FFmpeg operations
// ============================================================

const { invoke } = window.__TAURI__.core;
const { open, save } = window.__TAURI__.dialog;
const { getCurrentWebviewWindow } = window.__TAURI__.webviewWindow;

// ---- State ----
let currentFile = null;
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

// Option elements
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
  // Check FFmpeg
  try {
    const version = await invoke('check_ffmpeg');
    ffmpegStatus.classList.add('ok');
    ffmpegStatus.querySelector('.status-text').textContent = version.split(' ').slice(0, 3).join(' ');
  } catch (e) {
    ffmpegStatus.classList.add('error');
    ffmpegStatus.querySelector('.status-text').textContent = 'FFmpeg not found';
  }

  // Apply default preset
  applyPreset('wav-mono');

  setupEventListeners();
}

function setupEventListeners() {
  // File selection — single click handler using Tauri dialog
  dropZone.addEventListener('click', async () => {
    if (currentFile) return;
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: 'Audio Files',
          extensions: ['wav', 'mp3', 'flac', 'ogg', 'aac', 'm4a', 'opus', 'wma', 'aiff', 'aif', 'wv', 'ape']
        }]
      });
      if (selected) handleFileSelect(selected);
    } catch (_) {
      // User cancelled
    }
  });

  // Native drag-and-drop via Tauri
  const appWindow = getCurrentWebviewWindow();
  appWindow.onDragDropEvent((event) => {
    if (event.payload.type === 'over') {
      dropZone.classList.add('drag-over');
    } else if (event.payload.type === 'leave') {
      dropZone.classList.remove('drag-over');
    } else if (event.payload.type === 'drop') {
      dropZone.classList.remove('drag-over');
      const paths = event.payload.paths;
      if (paths && paths.length > 0 && !currentFile) {
        handleFileSelect(paths[0]);
      }
    }
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

  // Options toggle
  optionsToggle.addEventListener('click', toggleOptions);

  // Format change: show/hide bit depth vs bitrate
  optFormat.addEventListener('change', () => {
    updateFormatOptions();
    markCustom();
  });

  // Mark custom on any option change
  [optChannels, optSampleRate, optBitDepth, optBitrate, optNormalize, optTrimSilence, optFadeIn, optFadeOut].forEach(el => {
    el.addEventListener('change', markCustom);
  });

  // Volume display
  optVolume.addEventListener('input', () => {
    volumeDisplay.textContent = optVolume.value + '%';
    markCustom();
  });

  // Convert
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

  optFormat.value     = p.format;
  optChannels.value   = p.channels;
  optSampleRate.value = p.sampleRate;
  optBitDepth.value   = p.bitDepth;
  optBitrate.value    = p.bitrate;
  optVolume.value     = p.volume;
  optNormalize.checked  = p.normalize;
  optTrimSilence.checked= p.trimSilence;
  optFadeIn.value     = p.fadeIn;
  optFadeOut.value    = p.fadeOut;
  volumeDisplay.textContent = p.volume + '%';
  updateFormatOptions();
}

function updateFormatOptions() {
  const fmt = optFormat.value;
  const isLossy = LOSSY_FORMATS.has(fmt);
  bitDepthGroup.classList.toggle('hidden', isLossy);
  bitrateGroup.classList.toggle('hidden', !isLossy);
}

function markCustom() {
  // Check if current options match any preset
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
    fadeIn:       parseFloat(optFadeIn.value) || 0,
    fadeOut:      parseFloat(optFadeOut.value) || 0,
  };
}

async function handleFileSelect(path) {
  if (!path) return;

  currentFile = path;
  dropContent.classList.add('hidden');
  fileInfo.classList.remove('hidden');
  dropZone.style.cursor = 'default';

  // Show loading state
  $('#fileName').textContent = path.split(/[/\\]/).pop();
  $('#fileFormat').textContent = 'Analyzing…';

  try {
    audioInfo = await invoke('probe_audio', { path });

    $('#fileName').textContent   = audioInfo.filename;
    $('#fileFormat').textContent  = audioInfo.codec;
    $('#metaDuration').textContent   = audioInfo.duration;
    $('#metaSampleRate').textContent = formatSampleRate(audioInfo.sample_rate);
    $('#metaChannels').textContent   = audioInfo.channels;
    $('#metaBitDepth').textContent   = audioInfo.bit_depth;
    $('#metaBitrate').textContent    = audioInfo.bitrate;
    $('#metaSize').textContent       = audioInfo.file_size;

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
}

async function handleConvert() {
  if (!currentFile) return;

  const opts = getCurrentOptions();
  const ext = FORMAT_EXTENSIONS[opts.format] || opts.format;

  // Ask for save location
  let outputPath;
  try {
    outputPath = await save({
      defaultPath: replaceExtension(currentFile, ext),
      filters: [{
        name: `${opts.format.toUpperCase()} Audio`,
        extensions: [ext]
      }]
    });
    if (!outputPath) return;
  } catch (_) {
    return;
  }

  // Ensure correct extension
  if (!outputPath.toLowerCase().endsWith('.' + ext)) {
    outputPath += '.' + ext;
  }

  // Show progress
  convertBtn.disabled = true;
  progressWrap.classList.remove('hidden');
  progressFill.className = 'progress-fill indeterminate';
  progressText.textContent = 'Converting…';
  progressText.className = 'progress-text';

  try {
    const result = await invoke('convert_audio', {
      options: {
        input_path:   currentFile,
        output_path:  outputPath,
        format:       opts.format,
        sample_rate:  opts.sampleRate ? parseInt(opts.sampleRate) : null,
        channels:     opts.channels ? parseInt(opts.channels) : null,
        bit_depth:    opts.bitDepth ? parseInt(opts.bitDepth) : null,
        bitrate:      opts.bitrate || null,
        volume:       opts.volume !== 100 ? opts.volume / 100 : null,
        normalize:    opts.normalize,
        trim_silence: opts.trimSilence,
        fade_in:      opts.fadeIn > 0 ? opts.fadeIn : null,
        fade_out:     opts.fadeOut > 0 ? opts.fadeOut : null,
      }
    });

    progressFill.className = 'progress-fill';
    progressFill.style.width = '100%';
    progressText.textContent = 'Done — saved to ' + result.split(/[/\\]/).pop();
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

// ---- Boot ----
if (window.__TAURI__) {
  init();
} else {
  console.log('Running in browser mode (no Tauri backend)');
  document.addEventListener('DOMContentLoaded', () => {
    ffmpegStatus.classList.add('ok');
    ffmpegStatus.querySelector('.status-text').textContent = 'Browser preview mode';
    applyPreset('wav-mono');

    // Browser mode: use native file input instead of Tauri dialog
    dropZone.addEventListener('click', () => {
      if (!currentFile) fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      currentFile = file.name;
      dropContent.classList.add('hidden');
      fileInfo.classList.remove('hidden');
      dropZone.style.cursor = 'default';
      $('#fileName').textContent = file.name;
      $('#fileFormat').textContent = file.type || 'audio';
      $('#metaSize').textContent = formatFileSize(file.size);
      ['metaDuration','metaSampleRate','metaChannels','metaBitDepth','metaBitrate'].forEach(
        id => $('#' + id).textContent = '—'
      );
      convertBtn.disabled = false;
    });

    // Still wire up non-file-related listeners
    clearFileBtn.addEventListener('click', (e) => { e.stopPropagation(); clearFile(); });
    document.querySelectorAll('.preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = btn.dataset.preset;
        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (preset !== 'custom') applyPreset(preset);
      });
    });
    optionsToggle.addEventListener('click', toggleOptions);
    optFormat.addEventListener('change', updateFormatOptions);
    optVolume.addEventListener('input', () => { volumeDisplay.textContent = optVolume.value + '%'; });
  });
}

function formatFileSize(bytes) {
  if (bytes > 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes > 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}
