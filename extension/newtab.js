import { getTargetUrl } from './config.js';

// replace 而非 href:中间重定向页不入历史,返回键回到打开新标签页前的页面。
getTargetUrl().then((url) => location.replace(url));
