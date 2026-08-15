import type { FileTypeHandler } from '../types';
import { OfficeFileViewer } from './OfficeFileViewer';
import { getFileTypeIcon } from '@/components/icons/FileIcon';

const handler: FileTypeHandler = {
  id: 'office',
  extensions: [
    // PDF / OFD
    'pdf', 'ofd',
    // Word
    'docx', 'doc', 'dot', 'docm', 'dotx', 'dotm', 'rtf', 'odt',
    // Excel
    'xlsx', 'xls', 'xlsm', 'xlsb', 'xltx', 'xlt', 'xltm', 'ods', 'fods', 'numbers',
    // PowerPoint
    'pptx', 'pptm', 'potx', 'potm', 'ppsx', 'ppsm', 'odp',
    // Archives
    'zip', 'zipx', '7z', 'rar', 'tar', 'gz', 'gzip', 'tgz',
    'bz2', 'bzip2', 'tbz', 'tbz2', 'xz', 'txz', 'lzma', 'zst',
    'cab', 'ar', 'cpio', 'iso', 'xar', 'lha', 'lzh',
    'jar', 'war', 'ear', 'apk', 'cbz', 'cbr',
    // Email
    'eml', 'msg', 'mbox',
    // EDA
    'olb', 'dra', 'gds', 'oas', 'oasis',
    // CAD
    'dwg', 'dxf', 'dwf', 'dwfx', 'xps',
    // Geo
    'geojson', 'kml', 'gpx', 'shp',
    // 3D
    'glb', 'gltf', 'obj', 'stl', 'ply', 'fbx', 'dae', '3ds', '3mf', 'amf',
    'usd', 'usda', 'usdc', 'usdz', 'kmz', 'pcd', 'wrl', 'vrml',
    'xyz', 'vtk', 'vtp', 'step', 'stp', 'iges', 'igs', 'ifc', '3dm',
    // Mindmap / drawing (read-only)
    'xmind',
    // ponytail: 'plantuml'/'puml' omitted — code handler shows source when the
    // plantuml plugin isn't installed; the plugin's extMap entry overrides it.
    // Ebooks
    'epub', 'umd',
    // Images (supplement)
    'tiff', 'tif', 'avif', 'heic', 'heif', 'jxl',
    // Audio
    'mp3', 'mpeg', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'flac', 'weba',
    'midi', 'mid',
    // Video
    'mp4', 'webm', 'm3u8',
    // Font / design / data
    'ttf', 'otf', 'woff', 'woff2', 'psd', 'ai', 'eps',
    'sqlite', 'wasm', 'parquet', 'avro', 'webarchive',
  ],
  icon: getFileTypeIcon('office'),
  supportedViewModes: ['preview'],
  needsFileContent: false,
  useCodeMirror: false,
  Preview: OfficeFileViewer,
};

export default handler;
