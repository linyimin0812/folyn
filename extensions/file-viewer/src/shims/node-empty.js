/**
 * Browser shim for Node built-ins pulled in by some renderer deps
 * (@ljheee/xmind-parser, ag-psd). Those Node-only code paths aren't reached
 * in the browser (the renderer consumes the File/ArrayBuffer, not fs), but the
 * top-level imports must resolve for the bundle to build. Each export throws
 * only if actually called.
 */
function unavailable(name) {
  return () => {
    throw new Error(`[file-viewer] node built-in "${name}" is not available in the browser`);
  };
}

export const promisify = unavailable('promisify');
export const inherits = () => {};
export const format = unavailable('format');
export const inspect = unavailable('inspect');
export const isArray = Array.isArray;
export const deprecate = (fn) => fn;

export function EventEmitter() {}
EventEmitter.prototype.on = () => {};
EventEmitter.prototype.emit = () => {};
EventEmitter.prototype.removeListener = () => {};
EventEmitter.prototype.once = () => {};

export const Readable = unavailable('stream.Readable');
export const Writable = unavailable('stream.Writable');
export const Transform = unavailable('stream.Transform');
export const PassThrough = unavailable('stream.PassThrough');

export const join = (...parts) => parts.filter(Boolean).join('/');
export const resolve = (...parts) => parts.filter(Boolean).join('/');
export const dirname = (p) => p.split('/').slice(0, -1).join('/');
export const basename = (p) => p.split('/').pop() ?? '';
export const extname = (p) => {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i) : '';
};
export const sep = '/';

export const inflateSync = unavailable('zlib.inflateSync');
export const deflateSync = unavailable('zlib.deflateSync');
export const inflateRawSync = unavailable('zlib.inflateRawSync');
export const gunzipSync = unavailable('zlib.gunzipSync');

export default {};
