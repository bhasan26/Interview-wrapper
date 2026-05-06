const responsePanel = document.querySelector('#response-panel');
const dragHandle = document.querySelector('#drag-handle');
const statusIndicator = document.querySelector('#status-indicator');
const questionText = document.querySelector('#question-text');
const answerContent = document.querySelector('#answer-content');

const sampleAnswer = `Use this panel for short, glanceable answers.

- Keep responses concise.
- Use \`code\` formatting for technical terms.
- Longer answers scroll here without moving the question area.

\`\`\`js
function example() {
  return 'Markdown rendering is ready';
}
\`\`\``;

let panelOffset = { x: 0, y: 0 };
let dragStart;

function renderState(state) {
  if (!state) {
    return;
  }

  setPanelVisible(state.aiPanelVisible);
  setStatus(state.status || (state.aiPanelVisible ? 'Ready' : 'Ready'));

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
  const normalized = ['Listening…', 'Thinking…', 'Ready'].includes(status) ? status : 'Ready';
  statusIndicator.textContent = normalized;
  statusIndicator.className = 'status-indicator';

  if (normalized === 'Listening…') {
    statusIndicator.classList.add('status-listening');
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

dragHandle.addEventListener('pointerdown', startDrag);
dragHandle.addEventListener('pointermove', updateDrag);
dragHandle.addEventListener('pointerup', stopDrag);
dragHandle.addEventListener('pointercancel', stopDrag);
responsePanel.addEventListener('mouseenter', () => window.interviewOverlay.setPanelInteractive(true));
responsePanel.addEventListener('mouseleave', () => {
  if (!dragStart) {
    window.interviewOverlay.setPanelInteractive(false);
  }
});

window.interviewOverlay.getState().then(renderState);
window.interviewOverlay.onStateChange(renderState);
