import { useEffect, useRef, useState, useCallback } from 'react';
import { DARK_THEME, THEME } from 'mind-elixir';
import type { MindElixirInstance } from 'mind-elixir';
import type { PreviewProps } from '../types';
import { createTopicMarkdown } from './topicMarkdown';
import {
  outlineToMindElixirData,
  mindElixirDataToOutline,
  readRuntimeMapStyle,
  resolveCanvasPalette,
  PRESET_STYLES,
  MONO_PALETTE,
  CANVAS_PALETTES,
  type MmapNodeStyle,
  type MmapMapStyle,
  type MmapDirection,
} from './outlineConverter';
import { resolveBasePath } from '@/utils/pathResolver';
import { useAppearanceStore } from '@/store/appearanceStore';

const FALLBACK_SRC = '- Root';

// ponytail: mind-elixir's default Catppuccin Latte palette (10 colors).
// Used to restore the multi-color rainbow look when the user toggles rainbow
// back ON after turning it OFF. Hardcoded because mind-elixir mutates
// `inst.theme.palette` in place at runtime — there's no API to read the
// "original" default after a mutation.
const RAINBOW_PALETTE = [
  '#dd7878', '#ea76cb', '#8839ef', '#e64553', '#fe640b',
  '#df8e1d', '#40a02b', '#209fb5', '#1e66f5', '#7287fd',
];

// Default text style panel values (used when the field is unset on the node).
const DEFAULT_FONT_FAMILY = 'Microsoft YaHei';
const DEFAULT_FONT_SIZE = '14';
const DEFAULT_BORDER_WIDTH = '1';
const DEFAULT_FIXED_WIDTH = '120';

function toSafeSrc(content: string | undefined): string {
  const trimmed = content?.trim();
  return trimmed || FALLBACK_SRC;
}

// ponytail: read the inline style off the Topic DOM element after
// mind-elixir's `ve` has applied `nodeObj.style` keys via `e.style[o]=n[o]`.
// `nodeObj.style` is the source of truth — we read from it, not from the
// DOM, so we don't get fooled by stray inline styles left over from a
// previous reshapeNode that wasn't followed by a `cssText=''` clear.
function readNodeStyle(node: { style?: MmapNodeStyle } | undefined): MmapNodeStyle {
  return { ...(node?.style ?? {}) };
}

// ponytail: mind-elixir's NodeObj TS type omits `fontStyle`, but the runtime
// applier honors any CSS key. Cast through `unknown` so we can set italic
// without fighting the type. See outlineConverter.ts `MmapNodeStyle` notes.
function setNodeStyleOnObj(node: unknown, style: MmapNodeStyle | undefined): void {
  (node as { style?: MmapNodeStyle }).style = style;
}

export default function MindMapCanvas({ content, onChange, filePath, vaultRoot }: PreviewProps) {
  const elRef = useRef<HTMLDivElement>(null);
  const instRef = useRef<MindElixirInstance | null>(null);
  const lastEmittedRef = useRef<string | null>(null);
  // Exposed so the styling panel can trigger a writeback after a style edit
  // (mind-elixir fires `operation` for reshapeNode but NOT for direct
  // theme.palette mutations like the rainbow toggle).
  const syncOutRef = useRef<(() => void) | null>(null);
  // ponytail: canvas-level runtime-only mapStyle (palette preset name,
  // background color, sibling alignment, topic spacing). rainbow/direction/
  // compact live in `inst` (read via getData at syncOut). State drives the
  // panel re-render; ref mirrors state so syncOut (captured at mount) reads
  // the latest without re-binding the operation listener.
  const [canvasStyle, setCanvasStyle] = useState<MmapMapStyle>({});
  const canvasStyleRef = useRef<MmapMapStyle>({});
  const [showCanvasPanel, setShowCanvasPanel] = useState(false);
  const [showNodePanelHint, setShowNodePanelHint] = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [notePopover, setNotePopover] = useState<{ text: string; x: number; y: number } | null>(null);
  // Track the currently-selected node's id + a tick to force a re-read of
  // the node's style after each style mutation (we don't store the style
  // object itself because reshapeNode replaces `nodeObj.style` with a new
  // reference and we'd be reading a stale snapshot).
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [, forceStyleReread] = useState(0);

  // ponytail: resolve the app theme ('light'|'dark'|'system') to a concrete
  // isDark boolean. mind-elixir's constructor auto-detects OS dark mode via
  // `prefers-color-scheme`, but it ignores the app's explicit `data-theme`
  // override (a user can set theme='light' while OS is dark). We re-sync on
  // every resolved-theme flip via `changeTheme` below. Lazy useState init so
  // the constructor gets the right theme on first mount (no flash).
  const themeSetting = useAppearanceStore((state) => state.theme);
  const [isDark, setIsDark] = useState<boolean>(() => {
    const s = useAppearanceStore.getState().theme;
    if (s === 'dark') return true;
    if (s === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    if (themeSetting !== 'system') {
      setIsDark(themeSetting === 'dark');
      return;
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setIsDark(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [themeSetting]);

  // ponytail: apply the resolved dark/light theme to the canvas. mind-elixir
  // ships both THEME (Latte light) and DARK_THEME — we swap between them.
  // `changeTheme(theme, false)` updates cssVar on container.style (node
  // colors flip via CSS cascade — no refresh needed); `linkDiv()` redraws
  // SVG branch lines with the new palette. We also preserve the user's
  // rainbow-OFF state: changeTheme replaces `inst.theme` (and thus palette),
  // so if palette was the single-color MONO before, re-apply it after.
  // Ceiling: the canvas bg / node fills use mind-elixir's own dark palette,
  // not the app's exact `--bg`/`--panel` tokens — close enough for MVP; if
  // visual mismatch bothers anyone, swap DARK_THEME for a custom Theme
  // whose cssVar values reference `var(--bg)` etc. (container is under
  // `<html data-theme>`, so app CSS vars are reachable).
  const applyThemeToInst = useCallback((dark: boolean) => {
    const inst = instRef.current;
    if (!inst) return;
    const wasMono = (inst.theme.palette?.length ?? 10) <= 1;
    inst.changeTheme(dark ? DARK_THEME : THEME, false);
    if (wasMono) {
      inst.theme.palette = MONO_PALETTE;
    }
    inst.linkDiv();
  }, []);

  // ponytail: apply canvas-level runtime-only mapStyle (palette preset,
  // background color, sibling alignment, topic spacing) to the mind-elixir
  // instance. Called after init + after every theme swap (changeTheme resets
  // every cssVar on container.style, so `--bgcolor`/`--node-gap-y` overrides
  // must be re-applied). Does NOT touch rainbow/direction/compact — those
  // live in `inst` and round-trip via MindElixirData.
  //
  // Ceilings:
  //  - `palette` overrides `theme.palette` directly (same path as the
  //    rainbow toggle). Picking a preset implies rainbow ON (multi-color);
  //    if rainbow is OFF (mono), this is a no-op so mono wins.
  //  - `background` sets `--bgcolor` on container.style — mind-elixir reads
  //    it for the SVG map-canvas fill. Survives until the next changeTheme.
  //  - `alignment` mutates `inst.alignment` (read by mind-elixir's centering
  //    fn on every toCenter). Requires `refresh()` + `toCenter()` to apply.
  //  - `topicSpacing` sets `--node-gap-y` + `--main-gap-y`. Overridden by
  //    `compact: true` (mind-elixir hardcodes the gaps in compact mode), so
  //    the canvas panel disables this control when compact is on.
  const applyCanvasMapStyle = useCallback((ms: MmapMapStyle | undefined) => {
    const inst = instRef.current;
    if (!inst) return;
    const isMono = (inst.theme.palette?.length ?? 10) <= 1;
    if (ms?.palette && !isMono) {
      const colors = resolveCanvasPalette(ms.palette);
      if (colors) inst.theme.palette = colors;
    }
    if (ms?.background) {
      inst.container.style.setProperty('--bgcolor', ms.background);
    } else {
      inst.container.style.removeProperty('--bgcolor');
    }
    if (ms?.alignment) {
      // Cast: `alignment` is on MindElixirInstance via Required<Options>;
      // mutator pattern is the only way — no setter API.
      (inst as { alignment: 'root' | 'nodes' }).alignment = ms.alignment;
    }
    if (ms?.topicSpacing !== undefined && !inst.compact) {
      const px = `${ms.topicSpacing}px`;
      inst.container.style.setProperty('--node-gap-y', px);
      inst.container.style.setProperty('--main-gap-y', px);
    }
    inst.layout();
    inst.linkDiv();
    inst.toCenter();
  }, []);

  // ponytail: event delegation over the canvas instead of per-img onclick.
  // mind-elixir renders topic HTML via innerHTML, so React can't bind onClick
  // on those <img> nodes. One listener on the container catches them all;
  // upgrade to a portal-based lightbox lib only if zoom/pan is needed.
  // Also tracks the currently-selected node (mind-elixir's selectNode fires
  // no event on existing-node click — only selectNewNode for newly-created
  // nodes — so we read `inst.currentNode` after each click).
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      // Update selection state regardless of click target (node click,
      // background click, image click). `inst.currentNode` reflects the
      // post-click selection state.
      const inst = instRef.current;
      if (inst) {
        // Use rAF so mind-elixir's click handler (which calls selectNode
        // synchronously) has run before we read `currentNode`. Click is
        // dispatched after pointerdown/up completes; mind-elixir's
        // selectNode is called from its pointerup handler in the same tick.
        requestAnimationFrame(() => {
          const cur = inst.currentNode as
            | { nodeObj?: { id?: string } }
            | null
            | undefined;
          setSelectedNodeId(cur?.nodeObj?.id ?? null);
        });
      }
      const target = (e.target as HTMLElement | null)?.closest('img');
      if (!target) return;
      const src = target.getAttribute('src');
      if (!src) return;
      e.preventDefault();
      setPreviewSrc(src);
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, []);

  // ponytail: native `title` tooltip doesn't fire reliably in the Tauri webview,
  // so a delegated `mouseover`/`mouseout` pair drives a single React-rendered
  // popover. `mouseover`/`mouseout` bubble (unlike `mouseenter`/`mouseleave`),
  // so one listener on the container covers every note icon — including ones
  // mind-elixir re-renders via innerHTML after each canvas edit.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const onOver = (e: MouseEvent) => {
      const target = (e.target as HTMLElement | null)?.closest('.mmap-note-icon');
      if (!target) return;
      const raw = target.getAttribute('data-note');
      if (raw == null) return;
      const rect = target.getBoundingClientRect();
      setNotePopover({ text: raw, x: rect.left, y: rect.bottom + 6 });
    };
    const onOut = (e: MouseEvent) => {
      const related = e.relatedTarget as HTMLElement | null;
      // Only hide when leaving the icon entirely (not when moving between the
      // icon's own children — closest() still resolves to the icon there).
      if (related && related.closest('.mmap-note-icon')) return;
      setNotePopover(null);
    };
    el.addEventListener('mouseover', onOver);
    el.addEventListener('mouseout', onOut);
    return () => {
      el.removeEventListener('mouseover', onOver);
      el.removeEventListener('mouseout', onOut);
    };
  }, []);

  // Hide the popover on click-elsewhere inside the canvas (e.g. selecting a
  // different node). Independent of the lightbox click handler above.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const onClick = () => setNotePopover(null);
    el.addEventListener('click', onClick, { capture: true });
    return () => el.removeEventListener('click', onClick, { capture: true });
  }, []);

  useEffect(() => {
    if (!previewSrc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewSrc(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewSrc]);

  useEffect(() => {
    let disposed = false;

    (async () => {
      const [{ default: MindElixir }, resolvedVaultRoot] = await Promise.all([
        import('mind-elixir'),
        resolveBasePath(vaultRoot),
        // @ts-expect-error — CSS module without type declaration
        import('mind-elixir/style'),
      ]);
      if (disposed || !elRef.current) return;

      const el = elRef.current;
      const inst = new MindElixir({
        el,
        editable: true,
        allowUndo: true,
        // ponytail: pass the resolved theme at construction so the first
        // paint matches the app — avoids a light→dark flash before the
        // isDark effect runs.
        theme: isDark ? DARK_THEME : THEME,
        markdown: createTopicMarkdown({ filePath, vaultRoot: resolvedVaultRoot }) as (
          text: string,
          obj: unknown,
        ) => string,
      });

      const syncOut = () => {
        if (!onChange) return;
        // ponytail: own serializer — mind-elixir's plaintextConverter drops
        // the `note` field, so canvas edits would silently delete notes if
        // we used it. mindElixirDataToOutline walks the tree and emits
        // `> ` continuation lines for any node carrying a note.
        // Pass canvasStyleRef so runtime-only fields (palette/background/
        // alignment/topicSpacing) round-trip alongside data-derived ones.
        const md = mindElixirDataToOutline(inst.getData(), canvasStyleRef.current);
        lastEmittedRef.current = md;
        onChange(md);
      };
      syncOutRef.current = syncOut;
      // ponytail: re-serialize on every operation. Full snapshot, no incremental
      // patch — fine for MVP; if large maps stutter, diff+patch by node id.
      inst.bus.addListener('operation', syncOut);

      // ponytail: mind-elixir's beginEdit (Pt in MindElixir.js) places
      // #input-box at the topic element's top-left (`top: offsetTop`), but
      // the branch line connects to the topic's vertical center
      // (`e + o/2` in `at`/`dt`). For text-only nodes the gap is half a
      // line — invisible. For nodes with an image, the topic box is
      // image+8px+text tall, so the edit box floats above the branch line
      // by ~half the image height. Shift it down to vertically center on
      // the topic box so it always aligns with the connector.
      //
      // Deferred to the next animation frame: mind-elixir fires
      // `operation: beginEdit` synchronously right after appending
      // `#input-box` and setting its cssText, but its `Qe(t)` text-selection
      // call and the contentEditable focus can trigger a follow-up layout
      // pass in the same tick. Reading offsetHeight and patching `top`
      // inside the same synchronous listener ran before that layout settled,
      // so the shift was computed against a stale height and the edit box
      // ended up off-center — a visible gap remained between the caret and
      // the branch line. rAF defers the patch until after the browser has
      // committed the input box's final layout for this frame.
      // Upgrade: patch mind-elixir itself if other edit-box quirks appear.
      inst.bus.addListener(
        'operation',
        (op: { name: string; obj?: { id?: string } }) => {
          if (op.name !== 'beginEdit' || !op.obj?.id) return;
          const nodeId = op.obj.id;
          requestAnimationFrame(() => {
            const tpc = el.querySelector<HTMLElement>(
              `me-tpc[data-nodeid="me${nodeId}"]`,
            );
            const inputBox = el.querySelector<HTMLElement>('#input-box');
            if (!tpc || !inputBox) return;
            // Align input box vertical CENTER with tpc vertical CENTER.
            // mind-elixir sets `inputBox.style.top` to tpc's offsetTop
            // within `.map-canvas me-nodes` (the positioned ancestor of
            // #input-box), so we read that as the base and add half the
            // height delta. Using `inputBox.style.top` (not `tpc.offsetTop`)
            // because tpc's offsetParent is `me-parent`, not `me-nodes` —
            // a different reference frame than the input box's.
            const baseTop = parseFloat(inputBox.style.top || '0');
            const targetTop =
              baseTop + (tpc.offsetHeight - inputBox.offsetHeight) / 2;
            if (targetTop === baseTop) return;
            inputBox.style.top = `${targetTop}px`;
          });
        },
      );

      const data = outlineToMindElixirData(toSafeSrc(content));
      inst.init(data);
      // ponytail: re-apply dark/light + rainbow-OFF preservation. `init`
      // calls `changeTheme(data.theme || this.theme, false)` — when rainbow
      // is OFF, `data.theme` is the mono theme (light cssVar), which would
      // reset the canvas to light even in dark mode. This call restores the
      // resolved dark/light cssVar and re-applies the mono palette if needed.
      applyThemeToInst(isDark);
      // ponytail: read runtime-only canvas-level mapStyle (palette/background/
      // alignment/topicSpacing) from the source meta and apply them post-init
      // + post-theme-swap (changeTheme resets all cssVars). direction/compact
      // are already in `data` and applied by init.
      const runtimeMs = readRuntimeMapStyle(toSafeSrc(content));
      canvasStyleRef.current = runtimeMs;
      setCanvasStyle(runtimeMs);
      applyCanvasMapStyle(runtimeMs);
      instRef.current = inst;
    })();

    return () => {
      disposed = true;
      instRef.current?.destroy();
      instRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External source change → re-init unless it matches the string we just
  // emitted (which would be the feedback from our own onChange writeback).
  useEffect(() => {
    if (!instRef.current || content === lastEmittedRef.current) return;
    // ponytail: full re-init on external edit. Loses cursor/zoom/scroll state
    // on every keystroke in the source pane — acceptable for MVP; upgrade to
    // id-based diff+patch when it annoies.
    instRef.current.init(outlineToMindElixirData(toSafeSrc(content)));
    // Re-apply dark/light + rainbow-OFF (init reset theme to data.theme or
    // this.theme — see mount-effect comment for the mono-theme bug).
    applyThemeToInst(isDark);
    // Re-apply canvas-level mapStyle (changeTheme reset all cssVars).
    const runtimeMs = readRuntimeMapStyle(toSafeSrc(content));
    canvasStyleRef.current = runtimeMs;
    setCanvasStyle(runtimeMs);
    applyCanvasMapStyle(runtimeMs);
    setSelectedNodeId(null);
  }, [content, isDark, applyThemeToInst, applyCanvasMapStyle]);

  // ponytail: runtime theme flip — when the user toggles light/dark (or OS
  // preference changes while on 'system'), swap the canvas theme. Skips the
  // first run (mount effect already applied the initial theme).
  const didFirstRunRef = useRef(false);
  useEffect(() => {
    if (!didFirstRunRef.current) {
      didFirstRunRef.current = true;
      return;
    }
    applyThemeToInst(isDark);
    // changeTheme reset every cssVar — re-apply canvas-level overrides.
    applyCanvasMapStyle(canvasStyleRef.current);
  }, [isDark, applyThemeToInst, applyCanvasMapStyle]);

  // ponytail: apply a full style object (REPLACE, not merge) to the
  // currently-selected node. Path: read `inst.currentNode` (the Topic DOM
  // element) → mutate `nodeObj.style` on the data model → clear the topic
  // element's inline `style.cssText` so mind-elixir's `ve` re-applies only
  // the new keys (otherwise stale keys from a previous style linger on the
  // DOM, since `ve` only SETS keys present in `nodeObj.style`, never
  // clears) → call `reshapeNode` to re-render the topic + fire `operation`
  // (which our listener picks up to write back the source).
  // For reset: pass `undefined` — clears `nodeObj.style` AND `cssText`,
  // then reshapeNode with `{}` (no patch) re-renders the topic bare.
  const applyStyleToSelected = useCallback(
    (newStyle: MmapNodeStyle | undefined) => {
      const inst = instRef.current;
      const tpc = inst?.currentNode as
        | (HTMLElement & { nodeObj?: { id?: string; style?: MmapNodeStyle } })
        | null
        | undefined;
      if (!inst || !tpc || !tpc.nodeObj) return;
      setNodeStyleOnObj(tpc.nodeObj, newStyle);
      // Clear inline styles so `ve`'s `e.style[o]=n[o]` loop re-applies only
      // the new keys (prevents stale color/background leaking from a prior
      // preset). `ve` itself only SETS keys — it never clears, so we must
      // wipe the slate manually.
      tpc.style.cssText = '';
      // Cast: reshapeNode's TS signature wants `Partial<NodeObj>` with the
      // official style shape; ours adds `fontStyle`. Runtime is permissive.
      inst.reshapeNode(
        tpc as never,
        (newStyle ? { style: newStyle } : {}) as never,
      );
      forceStyleReread((n) => n + 1);
    },
    [],
  );

  // Patch a single style field on the selected node (merge with current).
  const patchStyleField = useCallback(
    (patch: MmapNodeStyle) => {
      const inst = instRef.current;
      const tpc = inst?.currentNode as
        | (HTMLElement & { nodeObj?: { id?: string; style?: MmapNodeStyle } })
        | null
        | undefined;
      if (!inst || !tpc || !tpc.nodeObj) return;
      const cur = readNodeStyle(tpc.nodeObj);
      // Toggle semantics for fontWeight / fontStyle / textDecoration: if
      // the new value matches the current, treat as a toggle-OFF (drop the
      // key). Otherwise set. Lets the panel's B/I/strikethrough buttons
      // behave as toggles without separate on/off wiring.
      const merged: MmapNodeStyle = { ...cur };
      for (const [k, v] of Object.entries(patch)) {
        const key = k as keyof MmapNodeStyle;
        if (
          (key === 'fontWeight' || key === 'fontStyle' || key === 'textDecoration') &&
          v === cur[key]
        ) {
          delete merged[key];
        } else {
          merged[key] = v as never;
        }
      }
      applyStyleToSelected(merged);
    },
    [applyStyleToSelected],
  );

  // ponytail: rainbow toggle — swap `inst.theme.palette` between the
  // default multi-color Latte palette and a single muted gray, then call
  // `linkDiv()` to re-draw the branches. `operation` doesn't fire for
  // theme mutations, so we trigger `syncOutRef.current?.()` manually to
  // write back the `mapStyle: {rainbow:bool}` directive. When toggling
  // rainbow OFF, drop any palette preset from canvasStyleRef — mono wins.
  const setRainbow = useCallback((on: boolean) => {
    const inst = instRef.current;
    if (!inst) return;
    inst.theme.palette = on ? RAINBOW_PALETTE : MONO_PALETTE;
    if (!on && canvasStyleRef.current.palette) {
      const next = { ...canvasStyleRef.current, palette: undefined };
      delete next.palette;
      canvasStyleRef.current = next;
      setCanvasStyle(next);
    }
    inst.linkDiv();
    syncOutRef.current?.();
  }, []);

  // ponytail: canvas-level direction mutator. mind-elixir exposes
  // `initLeft/initRight/initSide` (0/1/2) — each fires `changeDirection`
  // (NOT `operation`), so we trigger syncOut manually. No UP/DOWN —
  // ceiling documented in outlineConverter.ts (`MmapDirection`).
  const setDirection = useCallback((d: MmapDirection) => {
    const inst = instRef.current;
    if (!inst) return;
    if (d === 0) inst.initLeft();
    else if (d === 1) inst.initRight();
    else inst.initSide();
    syncOutRef.current?.();
  }, []);

  // ponytail: palette preset mutator — swap `inst.theme.palette` to the
  // preset's color array + redraw branches. Picking a preset implies
  // rainbow ON (multi-color), so we also clear any `rainbow:false` from
  // canvasStyleRef. No-op if rainbow is currently OFF — caller should
  // disable the control instead.
  const setPalettePreset = useCallback((name: string | undefined) => {
    const inst = instRef.current;
    if (!inst) return;
    const isMono = (inst.theme.palette?.length ?? 10) <= 1;
    if (isMono) return;
    const colors = name ? resolveCanvasPalette(name) : undefined;
    inst.theme.palette = colors ?? RAINBOW_PALETTE;
    const next = { ...canvasStyleRef.current };
    if (name) next.palette = name;
    else delete next.palette;
    canvasStyleRef.current = next;
    setCanvasStyle(next);
    inst.linkDiv();
    syncOutRef.current?.();
  }, []);

  // ponytail: canvas background mutator — set/remove `--bgcolor` on
  // container.style. No layout/redraw needed (SVG fill reads the var live).
  const setCanvasBackground = useCallback((bg: string | undefined) => {
    const inst = instRef.current;
    if (!inst) return;
    if (bg) inst.container.style.setProperty('--bgcolor', bg);
    else inst.container.style.removeProperty('--bgcolor');
    const next = { ...canvasStyleRef.current };
    if (bg) next.background = bg;
    else delete next.background;
    canvasStyleRef.current = next;
    setCanvasStyle(next);
    syncOutRef.current?.();
  }, []);

  // ponytail: sibling alignment mutator — 'root' (default, aligns to root)
  // vs 'nodes' (centers the whole tree). `inst.alignment` is read by
  // mind-elixir's centering fn on every toCenter(); mutating it then
  // refresh+toCenter applies. Default 'root' omitted from canvasStyle.
  const setAlignment = useCallback((mode: 'root' | 'nodes') => {
    const inst = instRef.current;
    if (!inst) return;
    (inst as { alignment: 'root' | 'nodes' }).alignment = mode;
    inst.refresh();
    inst.toCenter();
    const next = { ...canvasStyleRef.current };
    if (mode === 'nodes') next.alignment = mode;
    else delete next.alignment;
    canvasStyleRef.current = next;
    setCanvasStyle(next);
    syncOutRef.current?.();
  }, []);

  // ponytail: topic-spacing mutator — sets `--node-gap-y` + `--main-gap-y`.
  // No-op when `compact: true` (mind-elixir hardcodes gaps in compact mode,
  // overriding any container.style value). The control is disabled in the
  // panel when compact is on, but guard anyway.
  const setTopicSpacing = useCallback((px: number | undefined) => {
    const inst = instRef.current;
    if (!inst || inst.compact) return;
    if (px !== undefined) {
      const val = `${px}px`;
      inst.container.style.setProperty('--node-gap-y', val);
      inst.container.style.setProperty('--main-gap-y', val);
    } else {
      inst.container.style.removeProperty('--node-gap-y');
      inst.container.style.removeProperty('--main-gap-y');
    }
    const next = { ...canvasStyleRef.current };
    if (px !== undefined) next.topicSpacing = px;
    else delete next.topicSpacing;
    canvasStyleRef.current = next;
    setCanvasStyle(next);
    inst.layout();
    inst.linkDiv();
    syncOutRef.current?.();
  }, []);

  // Read the currently-selected node's style for panel display. Re-reads
  // on every render so we always show the latest state (forceStyleReread
  // bumps a dummy state counter to trigger a re-render after a style
  // mutation in case the panel was already visible).
  const selectedTpc = instRef.current?.currentNode as
    | (HTMLElement & { nodeObj?: { id?: string; style?: MmapNodeStyle } })
    | null
    | undefined;
  const selectedStyle: MmapNodeStyle =
    selectedTpc?.nodeObj?.id === selectedNodeId
      ? readNodeStyle(selectedTpc.nodeObj)
      : {};

  // Read rainbow state from `inst.theme.palette` length.
  const rainbowOn =
    (instRef.current?.theme.palette?.length ?? RAINBOW_PALETTE.length) > 1;

  // Read the live direction/compact from `inst` (the canvas mutates these
  // via initLeft/Right/Side and changeCompact — they're not in canvasStyleRef).
  const liveDirection = (instRef.current?.direction ?? 1) as MmapDirection;
  const liveCompact = instRef.current?.compact ?? false;

  return (
    <>
      <div ref={elRef} className="w-full h-full overflow-hidden" />
      {/* ponytail: vertical config toolbar pinned to right edge of canvas.
          Consolidates all config entry points (canvas style + node style)
          into one icon strip — replaces the old floating "画布" text button.
          A SIBLING of elRef (the mind-elixir mount target), NOT a descendant —
          so mind-elixir's own pointer/click listeners on its container never
          see clicks on the buttons. The onPointerDown stopPropagation is
          belt-and-braces in case a future refactor nests the toolbar inside
          the canvas. Do NOT add onClickCapture with stopPropagation here —
          React 18 attaches onClick via a root-level bubble delegate; a
          capture-phase stopPropagation on the target kills the native event
          before it can bubble back to the root, so onClick never fires. */}
      <div
        className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col gap-1 z-[800]"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className={`h-8 w-8 rounded border border-brd bg-panel text-t1 hover:bg-hov shadow-sm flex items-center justify-center ${showCanvasPanel ? 'border-acc text-acc' : ''}`}
          onClick={() => setShowCanvasPanel((v) => !v)}
          title="画布样式"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
            <path d="M8 1.5C4.4 1.5 1.5 4.4 1.5 8s2.9 6.5 6.5 6.5c.6 0 1-.4 1-1 0-.3-.1-.5-.3-.7-.2-.2-.3-.4-.3-.7 0-.6.4-1 1-1h1.2c1.6 0 2.9-1.3 2.9-2.9 0-3.6-2.9-6.2-6.5-6.2z" />
            <circle cx="4.5" cy="6" r=".8" fill="currentColor" stroke="none" />
            <circle cx="6.5" cy="3.5" r=".8" fill="currentColor" stroke="none" />
            <circle cx="10" cy="3.5" r=".8" fill="currentColor" stroke="none" />
            <circle cx="12" cy="6" r=".8" fill="currentColor" stroke="none" />
          </svg>
        </button>
        <button
          type="button"
          className={`h-8 w-8 rounded border border-brd bg-panel text-t1 hover:bg-hov shadow-sm flex items-center justify-center ${selectedNodeId ? 'border-acc text-acc' : ''}`}
          onClick={() => {
            // ponytail: StylingPanel auto-shows on node select. This button is
            // a manual trigger: with a selection it's a no-op (panel already
            // visible, button just reflects active state); without one, flash
            // a hint to select a node first. Auto-hides after 2s.
            if (!selectedNodeId) {
              setShowNodePanelHint(true);
              window.setTimeout(() => setShowNodePanelHint(false), 2000);
            }
          }}
          title="节点样式"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round">
            <path d="M11.5 1.5l3 3-8 8-3.5.5.5-3.5z" />
            <path d="M3 13c-1 0-1.5 1-1.5 2 1 0 2-.5 2-1.5" />
          </svg>
        </button>
        {showNodePanelHint && (
          <div className="absolute right-full top-1/2 -translate-y-1/2 mr-1 whitespace-nowrap rounded bg-surf border border-brd text-t1 text-[11px] px-2 py-1 shadow-lg pointer-events-none">
            请先选中一个节点
          </div>
        )}
      </div>
      {showCanvasPanel && (
        <CanvasStylePanel
          mapStyle={canvasStyle}
          direction={liveDirection}
          compact={liveCompact}
          rainbowOn={rainbowOn}
          onDirection={setDirection}
          onPalette={setPalettePreset}
          onBackground={setCanvasBackground}
          onAlignment={setAlignment}
          onTopicSpacing={setTopicSpacing}
          onClose={() => setShowCanvasPanel(false)}
        />
      )}
      {previewSrc && (
        <div
          className="fixed inset-0 z-[1000] bg-black/80 flex items-center justify-center p-6 cursor-zoom-out"
          onClick={() => setPreviewSrc(null)}
        >
          <img
            src={previewSrc}
            alt=""
            className="max-w-[90vw] max-h-[90vh] object-contain select-none"
            draggable={false}
          />
        </div>
      )}
      {notePopover && (
        <div
          className="fixed z-[1001] max-w-[320px] rounded bg-surf border border-brd text-t1 text-xs px-2.5 py-1.5 shadow-lg whitespace-pre-wrap pointer-events-none"
          style={{ left: notePopover.x, top: notePopover.y }}
        >
          {notePopover.text}
        </div>
      )}
      {selectedNodeId && (
        <StylingPanel
          style={selectedStyle}
          rainbowOn={rainbowOn}
          onPatch={patchStyleField}
          onReplace={applyStyleToSelected}
          onReset={() => applyStyleToSelected(undefined)}
          onRainbowToggle={() => setRainbow(!rainbowOn)}
        />
      )}
    </>
  );
}

// ponytail: the styling panel is a self-contained presentational component
// with no store coupling — receives the current style + callbacks. Native
// HTML inputs only (color picker, number input, checkboxes) — no UI library
// pulled in. Per the file-type styling spec, inline styles use CSS vars
// (`--panel`, `--surf`, `--brd`, `--hov`, `--acc`, `--t1`/`--t2`/`--t3`)
// so light/dark themes adapt automatically.
//
// Ceiling: 连线线宽 (line width) and 编号 (numbering) controls are NOT
// implemented — mind-elixir hardcodes main/sub branch stroke widths (3/2
// in MindElixir.js) and has no built-in per-node or map-level numbering
// API. Re-implementing either means overriding `generateMainBranch` /
// `generateSubBranch` (line width) or post-processing the topic text via
// the `markdown:` callback (numbering — pollutes the source topic text).
// Add when a real need lands; the panel's `lineWidth`/`numbering` rows
// are placeholders that document the gap, not working controls.
interface StylingPanelProps {
  style: MmapNodeStyle;
  rainbowOn: boolean;
  onPatch: (patch: MmapNodeStyle) => void;
  onReplace: (style: MmapNodeStyle) => void;
  onReset: () => void;
  onRainbowToggle: () => void;
}

function StylingPanel({
  style,
  rainbowOn,
  onPatch,
  onReplace,
  onReset,
  onRainbowToggle,
}: StylingPanelProps) {
  const labelCls = 'text-t3 text-[11px] font-medium w-[44px] shrink-0';
  const rowCls = 'flex items-center gap-1.5';
  const inputCls =
    'bg-surf2 border border-brd rounded px-1 py-0.5 text-[11px] text-t1 outline-none focus:border-acc';
  const btnCls =
    'h-[20px] min-w-[20px] px-1 rounded border border-brd bg-surf2 text-[11px] text-t1 hover:bg-hov';
  const btnActiveCls = 'border-acc bg-accdim text-acc';

  const isBold = style.fontWeight === 'bold';
  const isItalic = style.fontStyle === 'italic';
  // ponytail: no standalone strikethrough toggle button in the text row —
  // the 删除 preset applies strikethrough. A T/strike button can be wired
  // later by reading `style.textDecoration === 'line-through'` and calling
  // `onPatch({ textDecoration: 'line-through' })`.

  // parse the existing `border: "${w}px solid ${c}"` shorthand so the
  // border-width + border-color inputs show the current values when
  // re-opening the panel on an already-styled node.
  const borderMatch = style.border
    ? style.border.match(/^(\d+)px\s+solid\s+(.+)$/)
    : null;
  const borderWidth = borderMatch?.[1] ?? DEFAULT_BORDER_WIDTH;
  const borderColor = borderMatch?.[2] ?? '#9ca3af';

  const applyBorder = (width: string, color: string) => {
    onPatch({ border: `${width || '1'}px solid ${color || '#9ca3af'}` });
  };

  return (
    <div
      className="absolute top-1/2 right-12 -translate-y-1/2 z-[900] w-[220px] max-h-[calc(100%-24px)] overflow-auto rounded-lg border border-brd bg-panel shadow-lg text-t1"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-2.5 py-2 border-b border-brd text-[11px] font-semibold text-t2">
        画布样式 / 主题样式
      </div>

      <div className="px-2.5 py-2 flex flex-col gap-1.5 border-b border-brd">
        <div className={rowCls}>
          <span className={labelCls}>字体</span>
          <select
            className={`${inputCls} flex-1`}
            value={style.fontFamily ?? DEFAULT_FONT_FAMILY}
            onChange={(e) => onPatch({ fontFamily: e.target.value })}
          >
            <option value="Microsoft YaHei">微软雅黑</option>
            <option value="PingFang SC">苹方</option>
            <option value="SimSun">宋体</option>
            <option value="SimHei">黑体</option>
            <option value="Helvetica">Helvetica</option>
            <option value="Arial">Arial</option>
            <option value="monospace">monospace</option>
          </select>
        </div>
        <div className={rowCls}>
          <span className={labelCls}>字号</span>
          <input
            type="number"
            min={8}
            max={48}
            className={`${inputCls} w-[52px]`}
            value={style.fontSize ?? DEFAULT_FONT_SIZE}
            onChange={(e) =>
              onPatch({ fontSize: `${e.target.value || '14'}px` })
            }
          />
          <button
            type="button"
            className={`${btnCls} font-bold ${isBold ? btnActiveCls : ''}`}
            onClick={() => onPatch({ fontWeight: 'bold' })}
            title="加粗"
          >
            B
          </button>
          <button
            type="button"
            className={`${btnCls} italic ${isItalic ? btnActiveCls : ''}`}
            onClick={() => onPatch({ fontStyle: 'italic' })}
            title="斜体"
          >
            I
          </button>
          <input
            type="color"
            className="w-[20px] h-[20px] p-0 border border-brd rounded bg-surf2 cursor-pointer"
            value={style.color ?? '#18181b'}
            onChange={(e) => onPatch({ color: e.target.value })}
            title="文本颜色"
          />
        </div>
      </div>

      <div className="px-2.5 py-2 flex flex-col gap-1.5 border-b border-brd">
        <div className={rowCls}>
          <span className={labelCls}>填充</span>
          <input
            type="color"
            className="w-[20px] h-[20px] p-0 border border-brd rounded bg-surf2 cursor-pointer"
            value={style.background ?? '#ffffff'}
            onChange={(e) => onPatch({ background: e.target.value })}
          />
        </div>
        <div className={rowCls}>
          <span className={labelCls}>边框</span>
          <input
            type="color"
            className="w-[20px] h-[20px] p-0 border border-brd rounded bg-surf2 cursor-pointer"
            value={borderColor}
            onChange={(e) => applyBorder(borderWidth, e.target.value)}
          />
          <input
            type="number"
            min={0}
            max={20}
            className={`${inputCls} w-[44px]`}
            value={borderWidth}
            onChange={(e) => applyBorder(e.target.value, borderColor)}
          />
          <span className="text-t3 text-[10px]">px</span>
        </div>
        <div className={rowCls}>
          <span className={labelCls}>固定宽</span>
          <input
            type="number"
            min={40}
            max={600}
            className={`${inputCls} w-[52px]`}
            value={
              style.width ? style.width.replace(/px$/, '') : DEFAULT_FIXED_WIDTH
            }
            onChange={(e) =>
              onPatch({ width: `${e.target.value || '120'}px` })
            }
          />
          <span className="text-t3 text-[10px]">px</span>
        </div>
      </div>

      <div className="px-2.5 py-2 flex flex-col gap-1.5 border-b border-brd">
        <div className={rowCls}>
          <span className={labelCls}>连线</span>
          {/* ponytail: line-width control deferred — mind-elixir hardcodes
              main/sub branch stroke widths (3/2 in MindElixir.js). Re-add
              when overriding generateMainBranch becomes worth it. */}
          <span className="text-t3 text-[10px]">3px</span>
          <span className="text-t3 text-[11px] ml-auto">彩虹分支</span>
          <button
            type="button"
            className={`${btnCls} ${rainbowOn ? btnActiveCls : ''}`}
            onClick={onRainbowToggle}
            title="切换彩虹分支着色"
          >
            {rainbowOn ? 'ON' : 'OFF'}
          </button>
        </div>
        <div className={rowCls}>
          <span className={labelCls}>编号</span>
          {/* ponytail: per-node/map numbering deferred — mind-elixir has no
              built-in numbering API. The `markdown:` callback can prepend
              `${i+1}. ` but that pollutes the topic text and breaks
              round-trip. Add when a real need lands. */}
          <span className="text-t3 text-[10px]">无 / 有 (未实现)</span>
        </div>
      </div>

      <div className="px-2.5 py-2 flex flex-col gap-1.5 border-b border-brd">
        <div className="text-t3 text-[11px] font-medium">预置主题风格</div>
        <div className="grid grid-cols-3 gap-1">
          {Object.entries(PRESET_STYLES).map(([key, preset]) => (
            <button
              key={key}
              type="button"
              className="h-[26px] rounded border border-brd text-[11px] hover:bg-hov"
              style={{
                background: preset.style.background ?? 'transparent',
                color: preset.style.color ?? 'var(--t1)',
                textDecoration: preset.style.textDecoration,
                fontWeight: preset.style.fontWeight as 'bold' | undefined,
              }}
              onClick={() => onReplace({ ...preset.style })}
              title={preset.label}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-2.5 py-2">
        <button
          type="button"
          className={`${btnCls} w-full h-[24px]`}
          onClick={onReset}
          title="清除选中节点的所有样式"
        >
          重置样式
        </button>
      </div>
    </div>
  );
}

// ponytail: CanvasStylePanel — canvas-level "画布样式" panel, distinct from
// the per-node StylingPanel. Receives the runtime-only mapStyle fields
// (palette/background/alignment/topicSpacing) + the live direction/compact
// state read from `inst` + callbacks. Native HTML inputs only.
//
// Ceilings (rendered as disabled controls with tooltips, NOT stubbed):
//  - 骨架 (skeleton/layout type): single option "基础思维导图" — mind-elixir
//    has only one layout algorithm; no fishbone/tree layout. Disabled dropdown.
//  - 创建风格 (create style): single option "自定义风格" — XMind concept;
//    mind-elixir has no per-node "create style" preset. Disabled dropdown.
//  - 方向 up/down: mind-elixir only supports left/right/side. Dropdown lists
//    only the three; up/down omitted (not rendered as disabled to avoid
//    implying a feature that doesn't exist).
//  - 隐藏中心主题 (hide center topic): mind-elixir's `me-root` wraps the
//    entire tree — hiding it hides everything. No way to hide just the root
//    topic without breaking layout. Disabled checkbox.
//  - 分支自由布局 (free branch layout): mind-elixir's layout is force-driven
//    via `layout()`; nodes can be drag-repositioned but snap back on refresh.
//    No "free layout" mode. Disabled checkbox.
//  - 水印 (watermark): mind-elixir has no watermark API. Omitted entirely
//    (not even rendered as a disabled control — would be pure theater).
interface CanvasStylePanelProps {
  mapStyle: MmapMapStyle;
  direction: MmapDirection;
  compact: boolean;
  rainbowOn: boolean;
  onDirection: (d: MmapDirection) => void;
  onPalette: (name: string | undefined) => void;
  onBackground: (bg: string | undefined) => void;
  onAlignment: (mode: 'root' | 'nodes') => void;
  onTopicSpacing: (px: number | undefined) => void;
  onClose: () => void;
}

function CanvasStylePanel({
  mapStyle,
  direction,
  compact,
  rainbowOn,
  onDirection,
  onPalette,
  onBackground,
  onAlignment,
  onTopicSpacing,
  onClose,
}: CanvasStylePanelProps) {
  const labelCls = 'text-t3 text-[11px] font-medium w-[52px] shrink-0';
  const rowCls = 'flex items-center gap-1.5';
  const inputCls =
    'bg-surf2 border border-brd rounded px-1 py-0.5 text-[11px] text-t1 outline-none focus:border-acc disabled:opacity-50 disabled:cursor-not-allowed';
  const checkboxCls = 'w-[13px] h-[13px] accent-[var(--acc)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';

  // palette is grayed out when rainbow is OFF (mono wins).
  const paletteDisabled = !rainbowOn;
  // topic spacing is grayed out when compact is ON (compact hardcodes gaps).
  const spacingDisabled = compact;

  return (
    <div
      className="absolute top-1/2 right-12 -translate-y-1/2 z-[850] w-[230px] max-h-[calc(100%-24px)] overflow-auto rounded-lg border border-brd bg-panel shadow-lg text-t1"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-2.5 py-2 border-b border-brd text-[11px] font-semibold text-t2 flex items-center justify-between">
        <span>画布样式</span>
        <button
          type="button"
          className="text-t3 hover:text-t1 text-[14px] leading-none"
          onClick={onClose}
          title="关闭"
        >
          ×
        </button>
      </div>

      <div className="px-2.5 py-2 flex flex-col gap-1.5 border-b border-brd">
        <div className="text-t3 text-[11px] font-medium">主题样式</div>
        <div className={rowCls} title="骨架类型 — mind-elixir 仅支持基础思维导图">
          <span className={labelCls}>骨架</span>
          <select className={`${inputCls} flex-1`} value="basic" disabled>
            <option value="basic">基础思维导图</option>
          </select>
        </div>
        <div className={rowCls}>
          <span className={labelCls}>方向</span>
          <select
            className={`${inputCls} flex-1`}
            value={String(direction)}
            onChange={(e) => onDirection(Number(e.target.value) as MmapDirection)}
          >
            <option value="1">向右</option>
            <option value="0">向左</option>
            <option value="2">双侧</option>
          </select>
        </div>
        <div className={rowCls} title={paletteDisabled ? '请先开启彩虹分支' : undefined}>
          <span className={labelCls}>配色</span>
          <select
            className={`${inputCls} flex-1`}
            value={mapStyle.palette ?? ''}
            disabled={paletteDisabled}
            onChange={(e) => onPalette(e.target.value || undefined)}
          >
            <option value="">默认</option>
            {Object.entries(CANVAS_PALETTES).map(([key, p]) => (
              <option key={key} value={key}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className={rowCls} title="创建风格 — XMind 概念，mind-elixir 不支持">
          <span className={labelCls}>创建风格</span>
          <select className={`${inputCls} flex-1`} value="custom" disabled>
            <option value="custom">自定义风格</option>
          </select>
        </div>
      </div>

      <div className="px-2.5 py-2 flex flex-col gap-1.5 border-b border-brd">
        <div className={rowCls}>
          <span className={labelCls}>背景</span>
          <input
            type="color"
            className="w-[20px] h-[20px] p-0 border border-brd rounded bg-surf2 cursor-pointer"
            value={mapStyle.background ?? '#f6f6f6'}
            onChange={(e) => onBackground(e.target.value)}
          />
          {mapStyle.background && (
            <button
              type="button"
              className="text-t3 text-[10px] hover:text-t1 ml-auto"
              onClick={() => onBackground(undefined)}
              title="清除背景色"
            >
              清除
            </button>
          )}
        </div>
      </div>

      <div className="px-2.5 py-2 flex flex-col gap-1.5 border-b border-brd">
        <div className="text-t3 text-[11px] font-medium">布局</div>
        <label className={`${rowCls} cursor-pointer`} title="同级节点居中对齐">
          <input
            type="checkbox"
            className={checkboxCls}
            checked={mapStyle.alignment === 'nodes'}
            onChange={(e) => onAlignment(e.target.checked ? 'nodes' : 'root')}
          />
          <span className="text-[11px] text-t1">同级主题对齐</span>
        </label>
        <label className={`${rowCls} cursor-not-allowed`} title="隐藏中心主题 — mind-elixir 不支持（隐藏根节点会隐藏整棵树）">
          <input type="checkbox" className={checkboxCls} disabled />
          <span className="text-[11px] text-t3">隐藏中心主题</span>
          <span className="text-t3 text-[10px] ml-auto">未实现</span>
        </label>
        <label className={`${rowCls} cursor-not-allowed`} title="分支自由布局 — mind-elixir 不支持（节点拖拽后刷新会复位）">
          <input type="checkbox" className={checkboxCls} disabled />
          <span className="text-[11px] text-t3">分支自由布局</span>
          <span className="text-t3 text-[10px] ml-auto">未实现</span>
        </label>
        <div className={rowCls} title={spacingDisabled ? '紧凑模式下间距被锁定' : undefined}>
          <span className={labelCls}>主题间距</span>
          <input
            type="number"
            min={2}
            max={80}
            className={`${inputCls} w-[52px]`}
            value={mapStyle.topicSpacing ?? 10}
            disabled={spacingDisabled}
            onChange={(e) => {
              const v = e.target.value === '' ? undefined : Number(e.target.value);
              onTopicSpacing(v);
            }}
          />
          <span className="text-t3 text-[10px]">px</span>
        </div>
      </div>
    </div>
  );
}
