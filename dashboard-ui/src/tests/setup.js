import '@testing-library/jest-dom';

// IntersectionObserver polyfill for framer-motion viewport features
if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = class {
    constructor() {}
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
