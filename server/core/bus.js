// In-process event bus. Everything that changes emits here; the SSE stream forwards it to every open window.
import { EventEmitter } from 'node:events';

export const bus = new EventEmitter();
bus.setMaxListeners(200);

export function emit(type, payload = {}) {
  bus.emit('event', { type, payload, at: Date.now() });
}
