import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
    <div className="img-paste-overlay fixed inset-0 z-[200] bg-black/45 flex items-center justify-center animate-[fadeIn_.15s]" onKeyDown={handleKeyDown}>
      <div className="img-paste-dialog bg-panel border border-brd2 rounded-xl shadow-[0_16px_48px_rgba(0,0,0,.2)] w-[520px] max-w-[92vw] animate-[slideUp_.2s] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between py-3.5 px-[18px] border-b border-brd font-semibold text-sm">
          <span>{t('editor:imagePaste.title')}</span>
          <button className="bg-none border-none text-t3 cursor-pointer text-sm py-0.5 px-1.5 rounded hover:bg-surf2 hover:text-t1" onClick={onCancel}>✕</button>
        </div>

        {/* Preview */}
        <div className="pt-4 px-[18px] pb-2 flex justify-center">
          <img src={previewUrl} alt="preview" className="max-h-[200px] max-w-full object-contain rounded-md border border-brd bg-surf" />
        </div>

        {/* Upload target selector */}
        <div className="py-1.5 px-[18px]">
          <label className="block text-xs text-t3 mb-1 font-medium">{t('editor:imagePaste.uploadMethod')}</label>
          <select
            className="settings-select w-full cursor-pointer"
            value={selectedTarget}
            onChange={(e) => setSelectedTarget(e.target.value as UploadTarget)}
          >
            {strategies.map((strategy) => {
              const label = t(strategy.labelKey);
              const suffix = strategy.enabled ? '' : ` (${t('editor:imagePaste.comingSoon')})`;
              return (
                <option key={strategy.name} value={strategy.name} disabled={!strategy.enabled}>
                  {strategy.icon} {label}{suffix}
                </option>
              );
            })}
          </select>
        </div>

        {/* File name */}
        <div className="py-1.5 px-[18px]">
          <label className="block text-xs text-t3 mb-1 font-medium">{t('editor:imagePaste.fileName')}</label>
          <input
            ref={nameInputRef}
            type="text"
            className="img-paste-input w-full py-[7px] px-2.5 border border-brd2 rounded-md bg-surf text-t1 text-[13px] outline-none focus:border-acc focus:shadow-[0_0_0_2px_var(--accdim)]"
            value={fileName}
            onCompositionStart={() => { isComposingRef.current = true; }}
            onCompositionEnd={(event) => {
              isComposingRef.current = false;
              setFileName(event.currentTarget.value.replace(/[^\w一-鿿㐀-䶿豈-﫿-]/g, ''));
            }}
            onChange={(event) => {
              if (isComposingRef.current) {
                setFileName(event.target.value);
              } else {
                setFileName(event.target.value.replace(/[^\w一-鿿㐀-䶿豈-﫿-]/g, ''));
              }
            }}
            placeholder={t('editor:imagePaste.fileNamePlaceholder')}
            autoCapitalize="off"
          />
        </div>

        {/* Local-server specific fields */}
        {selectedTarget === 'local' && (
          <>
            <div className="py-1.5 px-[18px]">
              <label className="block text-xs text-t3 mb-1 font-medium">{t('editor:imagePaste.directory')}</label>
              <input
                type="text"
                className="img-paste-input w-full py-[7px] px-2.5 border border-brd2 rounded-md bg-surf text-t1 text-[13px] outline-none focus:border-acc focus:shadow-[0_0_0_2px_var(--accdim)]"
                value={directory}
                onChange={(event) => setDirectory(event.target.value)}
                placeholder={t('editor:imagePaste.directoryPlaceholder')}
                autoCapitalize="off"
              />
              {vaultRoot && (
                <div className="text-[11px] text-t3 mt-1 pl-0.5 font-mono break-all">
                  {t('editor:imagePaste.vaultHint', { root: vaultRoot })}
                </div>
              )}
            </div>

            <div className="py-1.5 px-[18px]">
              <label className="block text-xs text-t3 mb-1 font-medium">{t('editor:imagePaste.format')}</label>
              <div className="flex gap-0 border border-brd2 rounded-md overflow-hidden">
                {(['png', 'jpeg', 'webp'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    className={`flex-1 py-1.5 px-3.5 border-none text-xs font-medium cursor-pointer transition-all duration-150 border-r border-r-brd2 last:border-r-0 ${format === fmt ? 'bg-acc text-white font-semibold' : 'bg-surf text-t2 hover:bg-hov hover:text-t1'}`}
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
        <div className="py-1.5 px-[18px]">
          <label className="block text-xs text-t3 mb-1 font-medium">{t('editor:imagePaste.size')}</label>
          <div className="img-paste-size-row flex items-center gap-2">
            <div className="flex items-center gap-1 flex-1">
              <span className="text-xs text-t3 font-medium shrink-0">{t('editor:imagePaste.width')}</span>
              <input
                type="number"
                className="img-paste-input img-paste-size-input w-20 flex-1 text-center py-[7px] px-2.5 border border-brd2 rounded-md bg-surf text-t1 text-[13px] outline-none focus:border-acc focus:shadow-[0_0_0_2px_var(--accdim)] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                value={width}
                min={1}
                onChange={(event) => {
                  const value = event.target.value === '' ? '' : parseInt(event.target.value, 10);
                  handleWidthChange(value);
                }}
                placeholder={t('editor:imagePaste.widthPlaceholder')}
              />
              <span className="text-[11px] text-t3 shrink-0">px</span>
            </div>
            <button
              className={`bg-none border border-brd2 rounded-md w-8 h-8 flex items-center justify-center cursor-pointer text-sm shrink-0 transition-all duration-150 hover:border-acc hover:bg-hov ${lockAspectRatio ? 'border-acc bg-accdim' : ''}`}
              onClick={() => {
                const nextLocked = !lockAspectRatio;
                setLockAspectRatio(nextLocked);
                if (nextLocked && typeof width === 'number' && typeof height === 'number' && height > 0) {
                  aspectRatio.current = width / height;
                }
              }}
              title={lockAspectRatio ? t('editor:imagePaste.unlockRatio') : t('editor:imagePaste.lockRatio')}
            >
              {lockAspectRatio ? '🔗' : '🔓'}
            </button>
            <div className="flex items-center gap-1 flex-1">
              <span className="text-xs text-t3 font-medium shrink-0">{t('editor:imagePaste.height')}</span>
              <input
                type="number"
                className="img-paste-input img-paste-size-input w-20 flex-1 text-center py-[7px] px-2.5 border border-brd2 rounded-md bg-surf text-t1 text-[13px] outline-none focus:border-acc focus:shadow-[0_0_0_2px_var(--accdim)] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                value={height}
                min={1}
                onChange={(event) => {
                  const value = event.target.value === '' ? '' : parseInt(event.target.value, 10);
                  handleHeightChange(value);
                }}
                placeholder={t('editor:imagePaste.heightPlaceholder')}
              />
              <span className="text-[11px] text-t3 shrink-0">px</span>
            </div>
            <button className="bg-none border border-brd2 rounded-md w-8 h-8 flex items-center justify-center cursor-pointer text-base shrink-0 text-t2 transition-all duration-150 hover:border-acc hover:bg-hov hover:text-acc" onClick={resetToOriginalSize} title={t('editor:imagePaste.resetSize')}>
              ↺
            </button>
          </div>
          {originalWidth > 0 && (
            <div className="text-[11px] text-t3 mt-1 pl-0.5">
              {t('editor:imagePaste.originalSize', { w: originalWidth, h: originalHeight })}
            </div>
          )}
        </div>

        {/* Path preview */}
        <div className="mx-[18px] my-2 py-2 px-3 bg-surf rounded-md text-xs text-t3 font-mono border border-dashed border-brd2 break-all">
          {t('editor:imagePaste.pathPreview', { path: fullPath })}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 py-3 px-[18px] border-t border-brd mt-2">
          <button className="py-[7px] px-[18px] rounded-md text-[13px] font-medium cursor-pointer border-none bg-surf2 text-t2 hover:bg-brd" onClick={onCancel}>{t('editor:imagePaste.cancel')}</button>
          <button className="py-[7px] px-[18px] rounded-md text-[13px] font-medium cursor-pointer border-none bg-acc text-white hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed" onClick={handleConfirm} disabled={!fileName.trim()}>
            {t('editor:imagePaste.upload')}
          </button>
        </div>
      </div>
    </div>
  );
}
