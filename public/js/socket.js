// Shared Socket.io client instance
import { BACKEND_URL } from './config.js';
export const socket = window._socket || (window._socket = BACKEND_URL ? io(BACKEND_URL) : io());
