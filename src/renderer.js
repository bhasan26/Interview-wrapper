const placement = document.querySelector('#placement');
const toggleShortcut = document.querySelector('#toggle-shortcut');
const aiShortcut = document.querySelector('#ai-shortcut');
const aiPanel = document.querySelector('#ai-panel');

function formatAccelerator(accelerator) {
  return accelerator.replace('CommandOrControl', navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl');
}

function renderState(state) {
  if (!state) {
    return;
  }

  aiPanel.hidden = !state.aiPanelVisible;
  toggleShortcut.textContent = formatAccelerator(state.shortcuts.toggleOverlay);
  aiShortcut.textContent = formatAccelerator(state.shortcuts.triggerAiPanel);
  placement.textContent = state.window.placement === 'corner'
    ? `Capture-protected corner overlay: ${state.window.corner}.`
    : 'Capture-protected fullscreen overlay is running.';
}

window.interviewOverlay.getState().then(renderState);
window.interviewOverlay.onStateChange(renderState);
