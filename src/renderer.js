const responsePanel = document.querySelector('#response-panel');
const dragHandle = document.querySelector('#drag-handle');
const statusIndicator = document.querySelector('#status-indicator');
const questionText = document.querySelector('#question-text');
const answerContent = document.querySelector('#answer-content');

const sampleAnswer = `Press \`Ctrl+Shift+Space\` to record 10 seconds of system audio and transcribe the interviewer question.

If system audio is unavailable, type the question manually in the Question field.`;

let panelOffset = { x: 0, y: 0 };
let dragStart;
let recording = false;

function renderState(state) {
  if (!state) {
    return;
  }

  setPanelVisible(state.aiPanelVisible);
  setStatus(state.status || 'Ready');

  if (state.question && questionText.value !== state.question) {
    questionText.value = state.question;
  }

  renderMarkdown(state.answer || sampleAnswer);
}

function setPanelVisible(visible) {
  responsePanel.hidden = false;

  requestAnimationFrame(() => {
    responsePanel.classList.toggle('is-visible', visible);
    responsePanel.setAttribute('aria-hidden', String(!visible));

    if (!visible) {
      window.setTimeout(() => {
        if (!responsePanel.classList.contains('is-visible')) {
          responsePanel.hidden = true;
        }
      }, 220);
    }
  });

  window.interviewOverlay.setPanelInteractive(visible);
}

function setStatus(status) {
  const normalized = ['Listening…', 'Transcribing…', 'Thinking…', 'Ready'].includes(status) ? status : 'Ready';
  statusIndicator.textContent = normalized;
  statusIndicator.className = 'status-indicator';

  if (normalized === 'Listening…') {
    statusIndicator.classList.add('status-listening');
  } else if (normalized === 'Transcribing…') {
    statusIndicator.classList.add('status-transcribing');
  } else if (normalized === 'Thinking…') {
    statusIndicator.classList.add('status-thinking');
  } else {
    statusIndicator.classList.add('status-ready');
  }
}

function renderMarkdown(markdown) {
  answerContent.innerHTML = markdownToHtml(markdown);
}

function markdownToHtml(markdown) {
  const lines = markdown.split(/\r?\n/);
  const html = [];
  let inCodeBlock = false;
  let codeLines = [];
  let listType = null;

  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
        codeLines = [];
        inCodeBlock = false;
      } else {
        closeList();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
      continue;
    }

    const unordered = trimmed.match(/^[-*]\s+(.+)/);
    const ordered = trimmed.match(/^\d+\.\s+(.+)/);

    if (unordered || ordered) {
      const nextType = unordered ? 'ul' : 'ol';
      if (listType !== nextType) {
        closeList();
        html.push(`<${nextType}>`);
        listType = nextType;
      }
      html.push(`<li>${inlineMarkdown((unordered || ordered)[1])}</li>`);
      continue;
    }

    closeList();

    if (trimmed.startsWith('### ')) {
      html.push(`<h3>${inlineMarkdown(trimmed.slice(4))}</h3>`);
    } else if (trimmed.startsWith('## ')) {
      html.push(`<h3>${inlineMarkdown(trimmed.slice(3))}</h3>`);
    } else if (trimmed.startsWith('# ')) {
      html.push(`<h3>${inlineMarkdown(trimmed.slice(2))}</h3>`);
    } else if (trimmed.startsWith('> ')) {
      html.push(`<blockquote>${inlineMarkdown(trimmed.slice(2))}</blockquote>`);
    } else {
      html.push(`<p>${inlineMarkdown(trimmed)}</p>`);
    }
  }

  if (inCodeBlock) {
    html.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
  }

  closeList();
  return html.join('');
}

function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

async function startSystemAudioCapture(details = {}) {
  if (recording) {
    return;
  }

  recording = true;
  setPanelVisible(true);
  setStatus('Listening…');

  try {
    const source = await window.interviewOverlay.getSystemAudioSource();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: source.id
        }
      },
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: source.id,
          maxWidth: 1,
          maxHeight: 1,
          maxFrameRate: 1
        }
      }
    });

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      stopTracks(stream);
      throw new Error(getPlatformAudioHelp(details.platform));
    }

    const audioOnlyStream = new MediaStream(audioTracks);
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';
    const recorder = new MediaRecorder(audioOnlyStream, { mimeType });
    const chunks = [];

    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    });

    recorder.addEventListener('stop', async () => {
      stopTracks(stream);
      setStatus('Transcribing…');

      try {
        const blob = new Blob(chunks, { type: mimeType });
        const audioBuffer = await blob.arrayBuffer();
        const result = await window.interviewOverlay.transcribeAudio({
          audioBuffer,
          mimeType
        });

        if (result?.text && questionText.value !== result.text) {
          questionText.value = result.text;
        }
      } catch (error) {
        window.interviewOverlay.reportAudioCaptureFailure(error.message);
      } finally {
        recording = false;
      }
    });

    recorder.start();
    window.setTimeout(() => {
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
    }, (details.recordingSeconds || 10) * 1000);
  } catch (error) {
    recording = false;
    window.interviewOverlay.reportAudioCaptureFailure(error.message);
  }
}

function stopTracks(stream) {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function getPlatformAudioHelp(platform) {
  if (platform === 'darwin') {
    return 'No system audio track found. Install BlackHole and route the interviewer audio through it, or use a ScreenCaptureKit-capable capture path.';
  }

  if (platform === 'win32') {
    return 'No system audio track found. Enable a playback device that supports WASAPI loopback.';
  }

  return 'No system audio track found from desktop capture.';
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function startDrag(event) {
  if (event.button !== 0) {
    return;
  }

  responsePanel.classList.add('is-dragging');
  dragStart = {
    pointerId: event.pointerId,
    mouseX: event.clientX,
    mouseY: event.clientY,
    panelX: panelOffset.x,
    panelY: panelOffset.y
  };

  dragHandle.setPointerCapture(event.pointerId);
}

function updateDrag(event) {
  if (!dragStart || event.pointerId !== dragStart.pointerId) {
    return;
  }

  panelOffset = constrainPanelOffset({
    x: dragStart.panelX + event.clientX - dragStart.mouseX,
    y: dragStart.panelY + event.clientY - dragStart.mouseY
  });

  responsePanel.style.setProperty('--panel-x', `${panelOffset.x}px`);
  responsePanel.style.setProperty('--panel-y', `${panelOffset.y}px`);
}

function stopDrag(event) {
  if (!dragStart || event.pointerId !== dragStart.pointerId) {
    return;
  }

  responsePanel.classList.remove('is-dragging');
  dragHandle.releasePointerCapture(event.pointerId);
  dragStart = undefined;
}

function constrainPanelOffset(nextOffset) {
  const rect = responsePanel.getBoundingClientRect();
  const margin = 10;
  const minX = margin - rect.left + panelOffset.x;
  const maxX = window.innerWidth - margin - rect.right + panelOffset.x;
  const minY = margin - rect.top + panelOffset.y;
  const maxY = window.innerHeight - margin - rect.bottom + panelOffset.y;

  return {
    x: Math.min(Math.max(nextOffset.x, minX), maxX),
    y: Math.min(Math.max(nextOffset.y, minY), maxY)
  };
}

questionText.addEventListener('input', () => window.interviewOverlay.updateQuestion(questionText.value));

dragHandle.addEventListener('pointerdown', startDrag);
dragHandle.addEventListener('pointermove', updateDrag);
dragHandle.addEventListener('pointerup', stopDrag);
dragHandle.addEventListener('pointercancel', stopDrag);
responsePanel.addEventListener('mouseenter', () => window.interviewOverlay.setPanelInteractive(true));

window.interviewOverlay.getState().then(renderState);
window.interviewOverlay.onStateChange(renderState);
window.interviewOverlay.onAudioCaptureStart(startSystemAudioCapture);
