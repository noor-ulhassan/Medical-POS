'use strict';

/*
 * Design tokens live in src/renderer/src/index.css as CSS variables
 * (light + dark). Tailwind maps them to utilities so components never
 * hard-code colours and the dark theme is a single attribute switch.
 */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [`${__dirname}/src/renderer/index.html`, `${__dirname}/src/renderer/src/**/*.{js,jsx}`].map((p) => p.replace(/\\/g, '/')),
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        paper: token('paper'),
        surface: token('surface'),
        sunken: token('sunken'),
        foil: { DEFAULT: token('foil'), strong: token('foil-strong') },
        ink: { DEFAULT: token('ink'), 2: token('ink-2'), 3: token('ink-3') },
        teal: { DEFAULT: token('teal'), hover: token('teal-hover'), soft: token('teal-soft'), ink: token('teal-ink'), on: token('teal-on') },
        amber: { DEFAULT: token('amber'), soft: token('amber-soft'), ink: token('amber-ink') },
        red: { DEFAULT: token('red'), hover: token('red-hover'), soft: token('red-soft'), ink: token('red-ink'), on: token('red-on') }
      },
      fontFamily: {
        sans: ['"Atkinson Hyperlegible Next"', '"Segoe UI"', 'system-ui', 'sans-serif']
      },
      fontSize: {
        // Modular scale around a 14px UI base.
        xs: ['12px', '16px'],
        sm: ['13px', '18px'],
        base: ['14px', '20px'],
        md: ['16px', '22px'],
        lg: ['19px', '26px'],
        xl: ['24px', '30px'],
        '2xl': ['32px', '38px'],
        '3xl': ['44px', '48px']
      },
      borderRadius: {
        control: '6px',
        panel: '10px',
        dialog: '14px'
      },
      boxShadow: {
        dialog: '0 24px 64px -12px rgb(var(--shadow) / 0.35), 0 0 0 1px rgb(var(--foil) / 1)',
        pop: '0 8px 24px -6px rgb(var(--shadow) / 0.25)'
      },
      keyframes: {
        'dialog-in': { from: { opacity: '0', transform: 'translateY(8px) scale(0.98)' }, to: { opacity: '1', transform: 'none' } },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'toast-in': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'none' } },
        shake: { '10%,90%': { transform: 'translateX(-1px)' }, '20%,80%': { transform: 'translateX(2px)' }, '30%,50%,70%': { transform: 'translateX(-4px)' }, '40%,60%': { transform: 'translateX(4px)' } }
      },
      animation: {
        'dialog-in': 'dialog-in 160ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        'fade-in': 'fade-in 120ms ease-out',
        'toast-in': 'toast-in 180ms ease-out',
        shake: 'shake 360ms ease-in-out'
      }
    }
  },
  plugins: [require('@tailwindcss/container-queries')]
};
