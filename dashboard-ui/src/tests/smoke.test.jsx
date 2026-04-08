import { describe, it, expect } from 'vitest';
import React from 'react';
import { render, screen } from '@testing-library/react';

// Mock minimal pour s'assurer que Vitest fonctionne
describe('UI Smoke Test', () => {
  it('should pass an environment check', () => {
    expect(true).toBe(true);
  });

  it('should render a dummy component without crashing', () => {
    const TestComp = () => <div id="test-root">WG-FUX Dashboard</div>;
    render(<TestComp />);
    expect(screen.getByText('WG-FUX Dashboard')).toBeInTheDocument();
  });
});
