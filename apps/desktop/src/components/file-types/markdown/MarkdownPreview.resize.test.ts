import { describe, expect, it } from 'vitest';
import { getMaxMediaWidth, getResizedMediaWidth, stripImageSize } from './mediaResize';

describe('getResizedMediaWidth', () => {
  it('does not grow media that already fills its container', () => {
    expect(getResizedMediaWidth(500, 100, 500)).toBe(500);
  });

  it('clamps growth to the container width', () => {
    expect(getResizedMediaWidth(450, 100, 500)).toBe(500);
  });

  it('allows shrinking below the container width', () => {
    expect(getResizedMediaWidth(500, -100, 500)).toBe(400);
  });
});

describe('getMaxMediaWidth', () => {
  it('uses the visible Markdown preview width when a paragraph overflows it', () => {
    expect(getMaxMediaWidth(900, 500)).toBe(500);
  });

  it('uses the narrowest ancestor when the preview is clipped by an outer pane', () => {
    expect(getMaxMediaWidth(900, 740, 500, 1440)).toBe(500);
  });
});

describe('stripImageSize', () => {
  it('strips a width-only =Wx suffix (drag-resize writeback format)', () => {
    expect(stripImageSize('![shot](./assets/images/shot.png =166x)'))
      .toBe('![shot](./assets/images/shot.png)');
  });

  it('strips a width+height =WxH suffix', () => {
    expect(stripImageSize('![shot](pic.png =166x300)'))
      .toBe('![shot](pic.png)');
  });

  it('strips a height-only =xH suffix', () => {
    expect(stripImageSize('![shot](pic.png =x300)'))
      .toBe('![shot](pic.png)');
  });

  it('leaves a normal image without a size suffix unchanged', () => {
    expect(stripImageSize('![shot](./assets/images/shot.png)'))
      .toBe('![shot](./assets/images/shot.png)');
  });

  it('leaves a URL that contains =166x without a leading space unchanged', () => {
    expect(stripImageSize('![shot](http://x.com/a=166x)'))
      .toBe('![shot](http://x.com/a=166x)');
  });

  it('strips size suffixes from multiple images across the whole body', () => {
    const md = '![a](a.png =100x)\n\ntext\n![b](b.png =200x150)';
    expect(stripImageSize(md)).toBe('![a](a.png)\n\ntext\n![b](b.png)');
  });

  it('does not touch prose that merely contains =166x', () => {
    expect(stripImageSize('some text =166x here')).toBe('some text =166x here');
  });
});
