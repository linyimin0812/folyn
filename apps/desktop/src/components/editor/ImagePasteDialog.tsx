import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getAllStrategies,
  generateDefaultFileName,
  type UploadTarget,
} from '@/utils/imageUploader';

export interface ImageSaveConfig {
  target: UploadTarget;
  fileName: string;
  format: 'png' | 'jpeg' | 'webp';
  directory: string;
  width?: number;
  height?: number;
}

interface ImagePasteDialogProps {
  visible: boolean;
  previewUrl: string;
  currentFilePath: string;
  vaultRoot: string;
  onConfirm: (config: ImageSaveConfig) => void;
  onCancel: () => void;
}

export function ImagePasteDialog({
  visible,
  previewUrl,
  currentFilePath,
  vaultRoot,
  onConfirm,
  onCancel,
}: ImagePasteDialogProps) {
  const strategies = getAllStrategies();
  const [selectedTarget, setSelectedTarget] = useState<UploadTarget>('local');
  const [fileName, setFileName] = useState('');
  const [directory, setDirectory] = useState('assets/images');
  const [format, setFormat] = useState<'png' | 'jpeg' | 'webp'>('png');
  const nameInputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);

  // Image size state
  const [originalWidth, setOriginalWidth] = useState(0);
  const [originalHeight, setOriginalHeight] = useState(0);
  const [width, setWidth] = useState<number | ''>('');
  const [height, setHeight] = useState<number | ''>('');
  const [lockAspectRatio, setLockAspectRatio] = useState(true);
  const aspectRatio = useRef(1);

  // Load original image dimensions when preview URL changes
  useEffect(() => {
    if (!previewUrl) return;
    const img = new Image();
    img.onload = () => {
      setOriginalWidth(img.naturalWidth);
      setOriginalHeight(img.naturalHeight);
      setWidth(img.naturalWidth);
      setHeight(img.naturalHeight);
      aspectRatio.current = img.naturalWidth / img.naturalHeight;
    };
    img.src = previewUrl;
  }, [previewUrl]);

  const handleWidthChange = useCallback((newWidth: number | '') => {
    setWidth(newWidth);
    if (lockAspectRatio && typeof newWidth === 'number' && newWidth > 0) {
      setHeight(Math.round(newWidth / aspectRatio.current));
    }
  }, [lockAspectRatio]);

  const handleHeightChange = useCallback((newHeight: number | '') => {
    setHeight(newHeight);
    if (lockAspectRatio && typeof newHeight === 'number' && newHeight > 0) {
      setWidth(Math.round(newHeight * aspectRatio.current));
    }
  }, [lockAspectRatio]);

  const resetToOriginalSize = useCallback(() => {
    setWidth(originalWidth);
    setHeight(originalHeight);
    aspectRatio.current = originalWidth / originalHeight;
  }, [originalWidth, originalHeight]);

  // Reset form when dialog opens
  useEffect(() => {
    if (visible) {
      setFileName(generateDefaultFileName());
      setFormat('png');
      setSelectedTarget('local');
      setLockAspectRatio(true);

      // Compute default directory relative to current file
      if (currentFilePath) {
        const lastSlash = currentFilePath.lastIndexOf('/');
        const currentDir = lastSlash >= 0 ? currentFilePath.substring(0, lastSlash) : '';
        setDirectory(currentDir ? `${currentDir}/assets/images` : 'assets/images');
      } else {
        setDirectory('assets/images');
      }

      // Focus name input after render
      setTimeout(() => nameInputRef.current?.select(), 50);
    }
  }, [visible, currentFilePath]);

  const fullPath = `${directory}/${fileName}.${format}`;

  const handleConfirm = useCallback(() => {
    if (!fileName.trim()) return;
    const finalWidth = typeof width === 'number' && width !== originalWidth ? width : undefined;
    const finalHeight = typeof height === 'number' && height !== originalHeight ? height : undefined;
    onConfirm({
      target: selectedTarget,
      fileName: fileName.trim(),
      format,
      directory,
      width: finalWidth,
      height: finalHeight,
    });
  }, [selectedTarget, fileName, format, directory, width, height, originalWidth, originalHeight, onConfirm]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleConfirm();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    },
    [handleConfirm, onCancel],
  );

  if (!visible) return null;

  return (
    <div className="img-paste-overlay" onKeyDown={handleKeyDown}>
      <div className="img-paste-dialog">
        {/* Header */}
        <div className="img-paste-header">
          <span>📷 粘贴图片</span>
          <button className="img-paste-close" onClick={onCancel}>✕</button>
        </div>

        {/* Preview */}
        <div className="img-paste-preview">
          <img src={previewUrl} alt="preview" />
        </div>

        {/* Upload target tabs */}
        <div className="img-paste-field">
          <label>上传方式</label>
          <div className="img-paste-tabs">
            {strategies.map((strategy) => (
              <button
                key={strategy.name}
                className={`img-paste-tab ${selectedTarget === strategy.name ? 'active' : ''} ${!strategy.enabled ? 'disabled' : ''}`}
                disabled={!strategy.enabled}
                onClick={() => strategy.enabled && setSelectedTarget(strategy.name)}
              >
                <span className="img-paste-tab-icon">{strategy.icon}</span>
                <span className="img-paste-tab-label">{strategy.label}</span>
                {!strategy.enabled && <span className="img-paste-tab-badge">敬请期待</span>}
              </button>
            ))}
          </div>
        </div>

        {/* File name */}
        <div className="img-paste-field">
          <label>图片名称</label>
          <input
            ref={nameInputRef}
            type="text"
            className="img-paste-input"
            value={fileName}
            onCompositionStart={() => { isComposingRef.current = true; }}
            onCompositionEnd={(event) => {
              isComposingRef.current = false;
              setFileName(event.currentTarget.value.replace(/[^\w\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff-]/g, ''));
            }}
            onChange={(event) => {
              if (isComposingRef.current) {
                setFileName(event.target.value);
              } else {
                setFileName(event.target.value.replace(/[^\w\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff-]/g, ''));
              }
            }}
            placeholder="输入图片名称"
            autoCapitalize="off"
          />
        </div>

        {/* Local-server specific fields */}
        {selectedTarget === 'local' && (
          <>
            <div className="img-paste-field">
              <label>保存目录</label>
              <input
                type="text"
                className="img-paste-input"
                value={directory}
                onChange={(event) => setDirectory(event.target.value)}
                placeholder="相对于 Vault 根目录的路径"
                autoCapitalize="off"
              />
              {vaultRoot && (
                <div className="img-paste-vault-hint">
                  🗄️ vault: {vaultRoot}
                </div>
              )}
            </div>

            <div className="img-paste-field">
              <label>图片格式</label>
              <div className="img-paste-format-group">
                {(['png', 'jpeg', 'webp'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    className={`img-paste-format-btn ${format === fmt ? 'active' : ''}`}
                    onClick={() => setFormat(fmt)}
                  >
                    {fmt.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Image size */}
        <div className="img-paste-field">
          <label>图片尺寸</label>
          <div className="img-paste-size-row">
            <div className="img-paste-size-input-group">
              <span className="img-paste-size-label">宽</span>
              <input
                type="number"
                className="img-paste-input img-paste-size-input"
                value={width}
                min={1}
                onChange={(event) => {
                  const value = event.target.value === '' ? '' : parseInt(event.target.value, 10);
                  handleWidthChange(value);
                }}
                placeholder="宽度"
              />
              <span className="img-paste-size-unit">px</span>
            </div>
            <button
              className={`img-paste-lock-btn ${lockAspectRatio ? 'locked' : ''}`}
              onClick={() => {
                const nextLocked = !lockAspectRatio;
                setLockAspectRatio(nextLocked);
                if (nextLocked && typeof width === 'number' && typeof height === 'number' && height > 0) {
                  aspectRatio.current = width / height;
                }
              }}
              title={lockAspectRatio ? '解锁比例' : '锁定比例'}
            >
              {lockAspectRatio ? '🔗' : '🔓'}
            </button>
            <div className="img-paste-size-input-group">
              <span className="img-paste-size-label">高</span>
              <input
                type="number"
                className="img-paste-input img-paste-size-input"
                value={height}
                min={1}
                onChange={(event) => {
                  const value = event.target.value === '' ? '' : parseInt(event.target.value, 10);
                  handleHeightChange(value);
                }}
                placeholder="高度"
              />
              <span className="img-paste-size-unit">px</span>
            </div>
            <button className="img-paste-reset-btn" onClick={resetToOriginalSize} title="恢复原始尺寸">
              ↺
            </button>
          </div>
          {originalWidth > 0 && (
            <div className="img-paste-size-hint">
              原始尺寸：{originalWidth} × {originalHeight} px
            </div>
          )}
        </div>

        {/* Path preview */}
        <div className="img-paste-path-preview">
          📄 {fullPath}
        </div>

        {/* Actions */}
        <div className="img-paste-actions">
          <button className="img-paste-btn cancel" onClick={onCancel}>取消</button>
          <button className="img-paste-btn confirm" onClick={handleConfirm} disabled={!fileName.trim()}>
            ✓ 上传
          </button>
        </div>
      </div>
    </div>
  );
}
