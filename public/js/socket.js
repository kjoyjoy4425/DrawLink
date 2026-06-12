// Shared Socket.io client instance
import { BACKEND_URL } from './config.js';

// 로컬(npm start)에서는 같은 서버에 연결하고,
// Vercel 등 외부 배포에서는 config.js의 BACKEND_URL(Render)에 연결한다.
const host = location.hostname;
const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '' || host === '[::1]';
const target = (!isLocal && BACKEND_URL) ? BACKEND_URL : undefined;

export const socket = window._socket || (window._socket = target ? io(target) : io());
