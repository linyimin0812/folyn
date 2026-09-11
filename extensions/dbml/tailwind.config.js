/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{js,ts,jsx,tsx}', './src/dbml-preview.html'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        ui: ['var(--font-ui)', 'sans-serif'],
        mono: ['DM Mono', 'monospace'],
      },
      colors: {
        acc: 'var(--acc)', acc2: 'var(--acc2)',
        panel: 'var(--panel)', surf: 'var(--surf)', surf2: 'var(--surf2)',
        brd: 'var(--brd)', brd2: 'var(--brd2)', bg: 'var(--bg)',
        hov: 'var(--hov)', act: 'var(--act)',
        t1: 'var(--t1)', t2: 'var(--t2)', t3: 'var(--t3)', t4: 'var(--t4)',
        green: 'var(--green)', amber: 'var(--amber)', red: 'var(--red)',
        cyan: 'var(--cyan)', purple: 'var(--purple)',
        card: 'var(--card)', inp: 'var(--inp)',
        accdim: 'var(--accdim)', accglow: 'var(--accglow)',
      },
    },
  },
  plugins: [],
};
