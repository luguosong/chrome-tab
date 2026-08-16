import { DEFAULT_TARGET_URL, getTargetUrl, validateTargetUrl } from './config.js';

const form = document.querySelector('form');
const input = document.querySelector('#target-url');
const status = document.querySelector('#status');

getTargetUrl().then((url) => {
  input.value = url;
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const url = validateTargetUrl(input.value);
  status.classList.remove('error');
  if (!url) {
    status.classList.add('error');
    status.textContent = `仅支持 http/https 的完整 URL,如 ${DEFAULT_TARGET_URL}`;
    return;
  }
  await chrome.storage.local.set({ targetUrl: url });
  input.value = url;
  status.textContent = '已保存,下一个新标签页生效';
});
