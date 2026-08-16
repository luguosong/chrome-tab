// node --test extension/ 即可运行,无任何依赖。
// 只测纯函数 validateTargetUrl;getTargetUrl 依赖 chrome.storage,由验收标准手工覆盖。
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TARGET_URL, validateTargetUrl } from './config.js';

test('出厂默认值自身必须合法(否则回退逻辑失去意义)', () => {
  assert.ok(validateTargetUrl(DEFAULT_TARGET_URL));
});

test('接受 http/https 完整 URL,并做 URL 归一化', () => {
  assert.equal(validateTargetUrl('http://localhost:5173'), 'http://localhost:5173/');
  assert.equal(validateTargetUrl('https://newtab.example.com'), 'https://newtab.example.com/');
  assert.equal(validateTargetUrl('https://newtab.example.com/path?q=1'), 'https://newtab.example.com/path?q=1');
  assert.equal(validateTargetUrl(' http://192.168.1.5:8080 '), 'http://192.168.1.5:8080/');
});

test('拒绝非 http/https scheme', () => {
  assert.equal(validateTargetUrl('javascript:alert(1)'), null);
  assert.equal(validateTargetUrl('chrome://settings'), null);
  assert.equal(validateTargetUrl('ftp://example.com'), null);
});

test('拒绝缺 scheme 或无主机名的输入', () => {
  assert.equal(validateTargetUrl('localhost:5173'), null); // "localhost" 被解析为协议名
  assert.equal(validateTargetUrl('not a url'), null);
  assert.equal(validateTargetUrl('https://'), null);
  assert.equal(validateTargetUrl(''), null);
  assert.equal(validateTargetUrl(null), null);
});
